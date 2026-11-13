/**
 * Capa del plan (docs/plan.md §2.4): guarda la foto de un mes con las **entradas** de las cinco hojas del
 * Excel y las correspondencias persistentes de categorías. No conoce `req` ni `res`; la ruta HTTP de la
 * importación vive en el módulo `imports`, que usa este servicio a través de `finance/index.ts`.
 *
 * Solo guarda entradas: ningún total, proyección ni estado calculado (plan.md §3.2). El cálculo del plan es
 * de la fase 3b.2 y se hará al leer.
 *
 * Pensado para ejecutarse dentro de una transacción del llamante (`withDb`): lo que escribe se confirma o
 * se deshace junto con el resto (la confirmación de la importación, ASVS 2.3.3).
 *
 * Códigos de error: 422 (`UNPROCESSABLE`) si lo extraído es incoherente (una referencia a una fila de Datos
 * que no existe, una entrada incompleta o una línea sin categoría). Con un archivo validado no debería
 * ocurrir; es la última defensa antes de que lo pare una restricción de la base de datos.
 */
import type { Kysely } from 'kysely';
import type { ExtractedAmount, ExtractedPlan } from '@backoffice/shared';
import type { Database } from '../../../db/schema.ts';
import { AppError } from '../../../http/errors.ts';
import type { Clock } from '../../../lib/clock.ts';
import type { YearMonth } from '../ledger/domain/dates.ts';
import { PlanRepository, type SnapshotRecord } from './plan.repository.ts';

export interface PlanServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Una foto del plan nueva. `plan` no puede traer líneas de Presupuesto sin categoría. */
export interface NewPlanSnapshot {
  /** Mes 1 del plan, `YYYY-MM`. */
  readonly month: YearMonth;
  /** Lote de importación del que sale (auditoría). */
  readonly importBatchId: string;
  /** SHA-256 del contenido extraído (32 bytes). */
  readonly contentHash: Buffer;
  readonly templateVersion: number;
  readonly plan: ExtractedPlan;
}

/** Resumen público de una foto. */
export interface PlanSnapshotSummary {
  readonly id: string;
  readonly importBatchId: string;
  readonly status: 'active' | 'superseded';
}

function incoherent(message: string): AppError {
  return new AppError('UNPROCESSABLE', 422, message);
}

function toSummary(record: SnapshotRecord | undefined): PlanSnapshotSummary | undefined {
  return record === undefined
    ? undefined
    : { id: record.id, importBatchId: record.importBatchId, status: record.status };
}

/** Valor obligatorio de una entrada ya validada: si falta, la extracción es incoherente. */
function need<T>(value: T | null, what: string): T {
  if (value === null) throw incoherent(`La entrada extraída no tiene ${what}`);
  return value;
}

export class PlanService {
  readonly #deps: PlanServiceDeps;
  readonly #repo: PlanRepository;

  constructor(deps: PlanServiceDeps) {
    this.#deps = deps;
    this.#repo = new PlanRepository(deps.db);
  }

  /** Una copia de este servicio que opera sobre `db` (normalmente una transacción del llamante). */
  withDb(db: Kysely<Database>): PlanService {
    return new PlanService({ ...this.#deps, db });
  }

  /** Serializa las operaciones sobre un mes hasta el final de la transacción en curso. */
  lockMonth(month: YearMonth): Promise<void> {
    return this.#repo.lockMonth(`${month}-01`);
  }

  /** La foto que salió de un lote de importación. */
  async findByBatch(batchId: string): Promise<PlanSnapshotSummary | undefined> {
    return toSummary(await this.#repo.findSnapshotByBatch(batchId));
  }

  /** La foto de ese mes con ese contenido (vigente o ya sustituida), para la idempotencia. */
  async findByContent(
    month: YearMonth,
    contentHash: Buffer,
  ): Promise<PlanSnapshotSummary | undefined> {
    return toSummary(await this.#repo.findSnapshotByContent(`${month}-01`, contentHash));
  }

  /**
   * Crea la foto vigente del mes: la que hubiera pasa a `superseded` (el historial se conserva) y se
   * guardan las filas de las cinco hojas. Sin transacción propia: el llamante la abre y toma antes el
   * bloqueo del mes (`lockMonth`); el índice único parcial «una `active` por mes» es la red de seguridad.
   *
   * @returns el identificador de la foto nueva.
   */
  async createSnapshot(input: NewPlanSnapshot): Promise<string> {
    const first = `${input.month}-01`;
    const now = this.#deps.clock.now();
    const { plan } = input;
    await this.#repo.supersedeActive(first, now);
    const snapshotId = await this.#repo.insertSnapshot({
      month: first,
      import_batch_id: input.importBatchId,
      content_hash: input.contentHash,
      template_version: input.templateVersion,
      status: 'active',
      created_at: now,
    });

    const itemIds = await this.#repo.insertItems(
      plan.items.map((item) => ({
        snapshot_id: snapshotId,
        source_row: item.sourceRow,
        record_type: need(item.recordType, 'tipo de registro'),
        group_label: item.groupLabel,
        concept: item.concept,
        unit: need(item.unit, 'unidad'),
        amount_cents: item.amountCents,
        quantity_hundredths: item.quantityHundredths,
        nature: need(item.nature, 'naturaleza'),
        status: need(item.status, 'estado'),
        source_note: item.sourceNote,
        note: item.note,
      })),
    );
    const itemId = (row: number | null, what: string): string | null => {
      if (row === null) return null;
      const id = itemIds.get(row);
      if (id === undefined)
        throw incoherent(`${what} apunta a la fila ${String(row)} de Datos, que no existe`);
      return id;
    };
    const requiredItemId = (row: number | null, what: string): string =>
      need(itemId(row, what), what);
    /** Una meta guarda cada importe como referencia o como literal (nunca las dos cosas). */
    const amount = (
      value: ExtractedAmount | null,
      what: string,
    ): { item: string | null; cents: number | null } => {
      if (value === null) return { item: null, cents: null };
      return value.kind === 'literal'
        ? { item: null, cents: value.cents }
        : { item: requiredItemId(value.row, what), cents: null };
    };

    await this.#repo.insertBudgetLines(
      plan.budgetLines.map((line) => ({
        snapshot_id: snapshotId,
        source_row: line.sourceRow,
        category_id: need(line.categoryId, `la categoría «${line.categoryLabel}»`),
        category_label: line.categoryLabel,
        concept: line.concept,
        cost_type: need(line.costType, 'tipo de coste'),
        essential: need(line.essential, 'si es esencial'),
        plan_item_id: requiredItemId(line.itemRow, 'El importe mensual de una línea'),
      })),
    );

    await this.#repo.insertEvents(
      plan.events.map((event) => ({
        snapshot_id: snapshotId,
        source_row: event.sourceRow,
        concept: event.concept,
        note: event.note,
        nature_label: event.natureLabel,
        amount_item_id: itemId(event.amountItemRow, 'El importe de un evento'),
        multiplier_item_id: itemId(event.multiplierItemRow, 'El plazo de un evento'),
        amount_cents: event.amountCents,
        status: need(event.status, 'estado'),
        expected_date: event.expectedDate,
        include_in_projection: need(event.includeInProjection, 'si se incluye en la proyección'),
      })),
    );

    await this.#repo.insertGoals(
      plan.goals.map((goal) => {
        const target = amount(goal.target, 'El objetivo de una meta');
        const current = amount(goal.current, 'El importe actual de una meta');
        const contribution = amount(goal.contribution, 'La aportación de una meta');
        return {
          snapshot_id: snapshotId,
          source_row: goal.sourceRow,
          name: goal.name,
          criterion: goal.criterion,
          goal_kind: need(goal.goalKind, 'tipo de meta'),
          target_item_id: target.item,
          target_cents: target.cents,
          current_item_id: current.item,
          current_cents: current.cents,
          contribution_item_id: contribution.item,
          contribution_cents: contribution.cents,
        };
      }),
    );

    const scenarioIds = await this.#repo.insertScenarios(
      plan.scenarios.map((scenario) => ({
        snapshot_id: snapshotId,
        source_row: scenario.sourceRow,
        name: scenario.name,
      })),
    );
    await this.#repo.insertScenarioItems(
      plan.scenarios.flatMap((scenario) => {
        const scenarioId = need(scenarioIds.get(scenario.sourceRow) ?? null, 'identificador');
        const rows = (list: readonly number[], role: 'extra_monthly' | 'one_off') =>
          // Un conjunto: la misma fila dos veces en una lista no suma dos veces (y la clave lo impide).
          [...new Set(list)].map((row) => ({
            scenario_id: scenarioId,
            snapshot_id: snapshotId,
            plan_item_id: requiredItemId(row, 'Un escenario'),
            role,
          }));
        return [
          ...rows(scenario.extraMonthlyRows, 'extra_monthly'),
          ...rows(scenario.oneOffRows, 'one_off'),
        ];
      }),
    );
    return snapshotId;
  }

  // --- correspondencias de categorías ---------------------------------------------------------------

  /** Nombre de categoría de Presupuesto normalizado → categoría de gasto elegida antes. */
  listCategoryMappings(): Promise<Map<string, string>> {
    return this.#repo.listCategoryMappings();
  }

  /**
   * Guarda las correspondencias elegidas por el usuario (nombre normalizado → categoría de gasto), para
   * reutilizarlas en las importaciones de otros meses. Idempotente. Que la categoría sea de gasto lo exige
   * la clave ajena compuesta de la base de datos.
   */
  async saveCategoryMappings(mappings: Readonly<Record<string, string>>): Promise<void> {
    const entries = Object.entries(mappings).map(([name, categoryId]) => ({ name, categoryId }));
    await this.#repo.upsertCategoryMappings(entries, this.#deps.clock.now());
  }
}
