/**
 * Lectura del plan (`GET /plan/*`, fase 3b.2 PR 2, docs/plan.md §2.10 y §3.13).
 *
 * Lee las tablas `plan_*` de **una** foto, arma el `PlanSnapshot` y llama a `calculatePlan`: aquí no hay
 * ninguna fórmula propia (todos los cálculos están en `domain/`) ni SQL (el repositorio solo lee entradas).
 * Cada endpoint calculado hace una sola lectura de la foto y los cinco bloques salen del mismo cálculo;
 * `dashboard` devuelve exactamente lo que devuelven los otros cinco juntos.
 *
 * Qué foto: la **vigente (`active`) de ese mes**. Si no hay, 404, también en los endpoints calculados: la
 * regla de «la vigente más reciente anterior» es de la comparativa (§3.8) y no se aplica aquí. Solo
 * `/plan/snapshots/:id` sirve también fotos sustituidas.
 *
 * Mes en curso: se calcula en Europe/Madrid a partir del `Clock` inyectado (nunca con la zona del servidor).
 *
 * Códigos de error: 404 (no hay foto), 422 (el rango de `/plan/snapshots` supera
 * {@link MAX_PLAN_SNAPSHOT_MONTHS} meses) y 500 si el cálculo de una foto falla (no debería ocurrir: una
 * foto que pasó el importador y las restricciones de la base de datos es coherente). En ese caso el error
 * lleva solo el identificador de la foto: el `RangeError` original cita conceptos del Excel y no se
 * propaga, para que ni la respuesta ni el log lleven datos de la foto.
 */
import type { Kysely } from 'kysely';
import {
  MAX_PLAN_SNAPSHOT_MONTHS,
  type Cents,
  type PlanBudgetResponse,
  type PlanChecksResponse,
  type PlanDashboardResponse,
  type PlanGoalsResponse,
  type PlanProjectionResponse,
  type PlanScenariosResponse,
  type PlanSnapshotResponse,
  type PlanSnapshotsResponse,
  type PlanSnapshotSummaryResponse,
} from '@backoffice/shared';
import type { Database } from '../../../db/schema.ts';
import { AppError } from '../../../http/errors.ts';
import type { Clock } from '../../../lib/clock.ts';
import { localYearMonth } from '../../../lib/local-time.ts';
import { monthsBetween, previousMonth, type YearMonth } from '../ledger/domain/dates.ts';
import { calculatePlan, type PlanCalculation, type PlanSnapshot } from './domain/index.ts';
import { addMonths, HORIZON_MONTHS } from './domain/months.ts';
import { PlanRepository, type SnapshotEntries, type SnapshotHeader } from './plan.repository.ts';

/** Zona en la que se decide qué mes natural es el «en curso» (la de toda la app). */
export const PLAN_TIME_ZONE = 'Europe/Madrid';

/** Flujo real del libro por mes (`ReportsService.realFlow`), inyectado para no acoplar el plan a su repositorio. */
export type RealFlowReader = (from: YearMonth, to: YearMonth) => Promise<Map<YearMonth, Cents>>;

export interface PlanQueryServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly realFlow: RealFlowReader;
}

/**
 * El cálculo de una foto falló. Mensaje fijo y sin `cause`: solo el identificador (un UUID) de la foto, nada
 * de su contenido. Lo recoge el gestor central de errores: 500 genérico y registro en el log.
 */
export class PlanCalculationError extends Error {
  constructor(snapshotId: string) {
    super(`No se pudo calcular el plan de la foto ${snapshotId}`);
    this.name = 'PlanCalculationError';
  }
}

/** `YYYY-MM-01` → `YYYY-MM`. */
const monthOf = (firstDay: string): YearMonth => firstDay.slice(0, 7);

function toSummary(header: SnapshotHeader): PlanSnapshotSummaryResponse {
  return {
    id: header.id,
    month: monthOf(header.month),
    status: header.status,
    importBatchId: header.importBatchId,
    templateVersion: header.templateVersion,
    createdAt: header.createdAt.toISOString(),
    supersededAt: header.supersededAt?.toISOString() ?? null,
  };
}

function toSnapshotResponse(
  header: SnapshotHeader,
  entries: SnapshotEntries,
): PlanSnapshotResponse {
  return {
    ...toSummary(header),
    items: entries.items.map((item) => ({ ...item })),
    budgetLines: entries.budgetLines.map((line) => ({ ...line })),
    events: entries.events.map((event) => ({ ...event })),
    goals: entries.goals.map((goal) => ({ ...goal })),
    scenarios: entries.scenarios.map((scenario) => ({
      ...scenario,
      items: scenario.items.map((entry) => ({ ...entry })),
    })),
  };
}

/** La foto leída → la entrada de los cálculos (solo lo que usan, con la forma de `domain/types.ts`). */
function toPlanSnapshot(month: YearMonth, entries: SnapshotEntries): PlanSnapshot {
  return {
    month,
    items: entries.items.map((item) => ({
      id: item.id,
      recordType: item.recordType,
      concept: item.concept,
      unit: item.unit,
      amountCents: item.amountCents,
      quantityHundredths: item.quantityHundredths,
      status: item.status,
    })),
    budgetLines: entries.budgetLines.map((line) => ({
      id: line.id,
      concept: line.concept,
      costType: line.costType,
      essential: line.essential,
      planItemId: line.planItemId,
    })),
    events: entries.events.map((event) => ({
      id: event.id,
      concept: event.concept,
      amountItemId: event.amountItemId,
      multiplierItemId: event.multiplierItemId,
      amountCents: event.amountCents,
      status: event.status,
      expectedDate: event.expectedDate,
      includeInProjection: event.includeInProjection,
    })),
    goals: entries.goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      goalKind: goal.goalKind,
      targetItemId: goal.targetItemId,
      targetCents: goal.targetCents,
      currentItemId: goal.currentItemId,
      currentCents: goal.currentCents,
      contributionItemId: goal.contributionItemId,
      contributionCents: goal.contributionCents,
    })),
    scenarios: entries.scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      items: scenario.items.map((entry) => ({ ...entry })),
    })),
  };
}

/** Un cálculo ya hecho, con lo que hace falta para dar forma a cualquiera de las respuestas. */
interface Calculated {
  readonly header: {
    readonly snapshotId: string;
    readonly month: YearMonth;
    readonly currentMonth: YearMonth;
  };
  readonly entries: SnapshotEntries;
  readonly calc: PlanCalculation;
}

export class PlanQueryService {
  readonly #repo: PlanRepository;
  readonly #clock: Clock;
  readonly #realFlow: RealFlowReader;

  constructor(deps: PlanQueryServiceDeps) {
    this.#repo = new PlanRepository(deps.db);
    this.#clock = deps.clock;
    this.#realFlow = deps.realFlow;
  }

  // --- fotos: entradas -----------------------------------------------------------------------------

  /** Historial de fotos (vigentes y sustituidas) de los meses de `from` a `to`, la más reciente primero. */
  async listSnapshots(from: YearMonth, to: YearMonth): Promise<PlanSnapshotsResponse> {
    if (monthsBetween(from, to).length > MAX_PLAN_SNAPSHOT_MONTHS) {
      const message = `El rango admite como máximo ${String(MAX_PLAN_SNAPSHOT_MONTHS)} meses`;
      throw new AppError('UNPROCESSABLE', 422, message, [{ path: 'from', message }]);
    }
    const headers = await this.#repo.listSnapshotHeaders(`${from}-01`, `${to}-01`);
    return { items: headers.map(toSummary) };
  }

  /** Las entradas de una foto por su identificador, también si ya está sustituida. */
  async getSnapshot(id: string): Promise<PlanSnapshotResponse> {
    const header = await this.#repo.findSnapshotHeader(id);
    if (header === undefined) throw notFound();
    return toSnapshotResponse(header, await this.#repo.loadEntries(header.id));
  }

  /** Las entradas de la foto vigente de un mes. */
  async getMonth(month: YearMonth): Promise<PlanSnapshotResponse> {
    const header = await this.#activeHeader(month);
    return toSnapshotResponse(header, await this.#repo.loadEntries(header.id));
  }

  // --- resultados calculados -------------------------------------------------------------------------

  async budget(month: YearMonth): Promise<PlanBudgetResponse> {
    const { header, entries, calc } = await this.#calculate(month);
    return { ...header, budget: budgetBlock(calc, entries) };
  }

  async projection(month: YearMonth): Promise<PlanProjectionResponse> {
    const { header, calc } = await this.#calculate(month);
    return { ...header, projection: projectionBlock(calc) };
  }

  async goals(month: YearMonth): Promise<PlanGoalsResponse> {
    const { header, calc } = await this.#calculate(month);
    return { ...header, goals: goalsBlock(calc) };
  }

  async scenarios(month: YearMonth): Promise<PlanScenariosResponse> {
    const { header, calc } = await this.#calculate(month);
    return { ...header, scenarios: scenariosBlock(calc) };
  }

  async checks(month: YearMonth): Promise<PlanChecksResponse> {
    const { header, calc } = await this.#calculate(month);
    return { ...header, checks: checksBlock(calc) };
  }

  /** Lo mismo que los cinco anteriores juntos, del mismo cálculo. */
  async dashboard(month: YearMonth): Promise<PlanDashboardResponse> {
    const { header, entries, calc } = await this.#calculate(month);
    return {
      ...header,
      budget: budgetBlock(calc, entries),
      projection: projectionBlock(calc),
      goals: goalsBlock(calc),
      scenarios: scenariosBlock(calc),
      checks: checksBlock(calc),
    };
  }

  // --- internos ------------------------------------------------------------------------------------

  async #activeHeader(month: YearMonth): Promise<SnapshotHeader> {
    const header = await this.#repo.findActiveSnapshotHeader(`${month}-01`);
    if (header === undefined) throw notFound();
    return header;
  }

  /**
   * Lee la foto vigente del mes (una vez), el flujo real de sus meses pasados y calcula. Un `RangeError`
   * del cálculo se convierte en {@link PlanCalculationError}.
   */
  async #calculate(month: YearMonth): Promise<Calculated> {
    const header = await this.#activeHeader(month);
    const currentMonth = localYearMonth(PLAN_TIME_ZONE, this.#clock.now());
    const [entries, realFlowByMonth] = await Promise.all([
      this.#repo.loadEntries(header.id),
      this.#realFlowOfPastMonths(month, currentMonth),
    ]);
    try {
      const calc = calculatePlan(toPlanSnapshot(month, entries), { currentMonth, realFlowByMonth });
      return { header: { snapshotId: header.id, month, currentMonth }, entries, calc };
    } catch (error) {
      if (error instanceof RangeError) throw new PlanCalculationError(header.id);
      throw error;
    }
  }

  /**
   * Flujo real (ingresos − gastos confirmados) de los meses del horizonte **anteriores** al mes en curso.
   * Un mes sin movimientos confirmados no entra en el mapa. Sin meses pasados no se consulta el libro.
   */
  async #realFlowOfPastMonths(
    firstMonth: YearMonth,
    currentMonth: YearMonth,
  ): Promise<Map<YearMonth, Cents>> {
    const lastPast = previousMonth(currentMonth);
    const horizonEnd = addMonths(firstMonth, HORIZON_MONTHS - 1);
    if (lastPast === null || lastPast < firstMonth) return new Map();
    return this.#realFlow(firstMonth, lastPast < horizonEnd ? lastPast : horizonEnd);
  }
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'No hay un plan para ese mes');
}

// --- bloques de respuesta (los comparten los endpoints sueltos y el dashboard) ------------------------------

function budgetBlock(
  calc: PlanCalculation,
  entries: SnapshotEntries,
): PlanBudgetResponse['budget'] {
  const lines = new Map(entries.budgetLines.map((line) => [line.id, line]));
  const statuses = new Map(entries.items.map((item) => [item.id, item.status]));
  return {
    ...calc.budget,
    lines: calc.budget.lines.map((result) => {
      const line = lines.get(result.lineId);
      const status = line === undefined ? undefined : statuses.get(line.planItemId);
      if (line === undefined || status === undefined) {
        // Imposible con las claves ajenas de la base de datos; antes un fallo que un dato inventado.
        throw new RangeError('Línea de Presupuesto sin su fila de Datos');
      }
      return {
        lineId: line.id,
        categoryId: line.categoryId,
        categoryLabel: line.categoryLabel,
        concept: line.concept,
        costType: line.costType,
        essential: line.essential,
        status,
        monthlyCents: result.monthlyCents,
        included: result.included,
        annualCents: result.annualCents,
        incomeShare: result.incomeShare,
      };
    }),
  };
}

const projectionBlock = (calc: PlanCalculation): PlanProjectionResponse['projection'] =>
  calc.projection.map((row) => ({ ...row }));

const goalsBlock = (calc: PlanCalculation): PlanGoalsResponse['goals'] => ({
  items: calc.goals.goals.map((goal) => ({ ...goal })),
  capacity: { ...calc.goals.capacity },
});

const scenariosBlock = (calc: PlanCalculation): PlanScenariosResponse['scenarios'] =>
  calc.scenarios.map((scenario) => ({ ...scenario }));

const checksBlock = (calc: PlanCalculation): PlanChecksResponse['checks'] => ({
  overall: calc.checks.overall,
  items: calc.checks.checks.map((entry) => ({ ...entry, subjects: [...entry.subjects] })),
});
