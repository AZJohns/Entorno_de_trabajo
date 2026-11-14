/**
 * Acceso a las tablas de la capa del plan (`plan_*`, migración 0010). Solo consultas: ninguna decisión de
 * negocio. Recibe un `Kysely` o una transacción para que el servicio (o el módulo de importaciones) pueda
 * agrupar operaciones en una sola.
 *
 * Los importes se escriben como números enteros de céntimos. Al leerlos, `pg` los entrega como cadena
 * (`bigint`) y aquí se convierten con `centsFromDb`. Las lecturas (fase 3b.2, PR 2) devuelven **solo
 * entradas**, tal como están guardadas: el cálculo es de `domain/` y nunca se hace aquí.
 */
import { sql, type Insertable, type Kysely } from 'kysely';
import type {
  Cents,
  CostType,
  EventStatus,
  GoalKind,
  Nature,
  RecordType,
  Status,
  Unit,
} from '@backoffice/shared';
import { centsFromDb } from '../../../db/cents.ts';
import type { Database } from '../../../db/schema.ts';

/** Filas por sentencia `INSERT`: con ~12 columnas queda muy por debajo del límite de 65.535 parámetros. */
const CHUNK = 500;

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += CHUNK)
    out.push(rows.slice(index, index + CHUNK));
  return out;
}

export interface SnapshotRecord {
  readonly id: string;
  readonly month: string;
  readonly importBatchId: string;
  readonly contentHash: Buffer;
  readonly status: 'active' | 'superseded';
}

export type NewSnapshotRow = Insertable<Database['plan_snapshots']>;
export type NewItemRow = Insertable<Database['plan_items']>;
export type NewBudgetLineRow = Insertable<Database['plan_budget_lines']>;
export type NewEventRow = Insertable<Database['plan_events']>;
export type NewGoalRow = Insertable<Database['plan_goals']>;
export type NewScenarioRow = Insertable<Database['plan_scenarios']>;
export type NewScenarioItemRow = Insertable<Database['plan_scenario_items']>;

/** Datos de una foto, sin sus filas (para el historial y la cabecera de cada respuesta). */
export interface SnapshotHeader {
  readonly id: string;
  /** Primer día del mes, `YYYY-MM-01`. */
  readonly month: string;
  readonly importBatchId: string;
  readonly templateVersion: number;
  readonly status: 'active' | 'superseded';
  readonly createdAt: Date;
  readonly supersededAt: Date | null;
}

export interface ItemRecord {
  readonly id: string;
  readonly sourceRow: number;
  readonly recordType: RecordType;
  readonly groupLabel: string;
  readonly concept: string;
  readonly unit: Unit;
  readonly amountCents: Cents | null;
  readonly quantityHundredths: number | null;
  readonly nature: Nature;
  readonly status: Status;
  readonly sourceNote: string | null;
  readonly note: string | null;
}

export interface BudgetLineRecord {
  readonly id: string;
  readonly sourceRow: number;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly concept: string;
  readonly costType: CostType;
  readonly essential: boolean;
  readonly planItemId: string;
}

export interface EventRecord {
  readonly id: string;
  readonly sourceRow: number;
  readonly concept: string;
  readonly note: string | null;
  readonly natureLabel: string | null;
  readonly amountItemId: string | null;
  readonly multiplierItemId: string | null;
  readonly amountCents: Cents | null;
  readonly status: EventStatus;
  /** `YYYY-MM-DD`. */
  readonly expectedDate: string | null;
  readonly includeInProjection: boolean;
}

export interface GoalRecord {
  readonly id: string;
  readonly sourceRow: number;
  readonly name: string;
  readonly criterion: string | null;
  readonly goalKind: GoalKind;
  readonly targetItemId: string | null;
  readonly targetCents: Cents | null;
  readonly currentItemId: string | null;
  readonly currentCents: Cents | null;
  readonly contributionItemId: string | null;
  readonly contributionCents: Cents | null;
}

export interface ScenarioRecord {
  readonly id: string;
  readonly sourceRow: number;
  readonly name: string;
  readonly items: readonly {
    readonly planItemId: string;
    readonly role: 'extra_monthly' | 'one_off';
  }[];
}

/** Las entradas de las cinco hojas de una foto, en el orden de la hoja (`source_row`). */
export interface SnapshotEntries {
  readonly items: readonly ItemRecord[];
  readonly budgetLines: readonly BudgetLineRecord[];
  readonly events: readonly EventRecord[];
  readonly goals: readonly GoalRecord[];
  readonly scenarios: readonly ScenarioRecord[];
}

const SNAPSHOT_COLUMNS = ['id', 'month', 'import_batch_id', 'content_hash', 'status'] as const;
const HEADER_COLUMNS = [
  'id',
  'month',
  'import_batch_id',
  'template_version',
  'status',
  'created_at',
  'superseded_at',
] as const;

function toHeader(row: {
  id: string;
  month: string;
  import_batch_id: string;
  template_version: number;
  status: 'active' | 'superseded';
  created_at: Date;
  superseded_at: Date | null;
}): SnapshotHeader {
  return {
    id: row.id,
    month: row.month,
    importBatchId: row.import_batch_id,
    templateVersion: row.template_version,
    status: row.status,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
  };
}

const optionalCents = (value: string | null): Cents | null =>
  value === null ? null : centsFromDb(value);

function toSnapshot(row: {
  id: string;
  month: string;
  import_batch_id: string;
  content_hash: Buffer;
  status: 'active' | 'superseded';
}): SnapshotRecord {
  return {
    id: row.id,
    month: row.month,
    importBatchId: row.import_batch_id,
    contentHash: row.content_hash,
    status: row.status,
  };
}

export class PlanRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * Bloqueo de aviso (`pg_advisory_xact_lock`) por mes del plan, hasta el final de la transacción: dos
   * confirmaciones del mismo mes se ejecutan una detrás de otra. Solo tiene sentido dentro de una
   * transacción. El espacio de claves es el de este tipo de bloqueo: `hashtextextended` con un prefijo
   * propio evita chocar con otros usos.
   */
  async lockMonth(month: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan_snapshot:${month}`}, 0))`.execute(
      this.#db,
    );
  }

  async findSnapshotByBatch(batchId: string): Promise<SnapshotRecord | undefined> {
    const row = await this.#db
      .selectFrom('plan_snapshots')
      .select(SNAPSHOT_COLUMNS)
      .where('import_batch_id', '=', batchId)
      .executeTakeFirst();
    return row === undefined ? undefined : toSnapshot(row);
  }

  /** La foto de un mes con ese contenido, esté vigente o sustituida (`UNIQUE (month, content_hash)`). */
  async findSnapshotByContent(
    month: string,
    contentHash: Buffer,
  ): Promise<SnapshotRecord | undefined> {
    const row = await this.#db
      .selectFrom('plan_snapshots')
      .select(SNAPSHOT_COLUMNS)
      .where('month', '=', month)
      .where('content_hash', '=', contentHash)
      .executeTakeFirst();
    return row === undefined ? undefined : toSnapshot(row);
  }

  /** Pasa a `superseded` la foto vigente del mes, si la hay. @returns cuántas fotos cambió (0 o 1). */
  async supersedeActive(month: string, now: Date): Promise<number> {
    const result = await this.#db
      .updateTable('plan_snapshots')
      .set({ status: 'superseded', superseded_at: now })
      .where('month', '=', month)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async insertSnapshot(row: NewSnapshotRow): Promise<string> {
    const inserted = await this.#db
      .insertInto('plan_snapshots')
      .values(row)
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  /** Inserta las filas de Datos y devuelve el identificador de cada una por su fila del Excel. */
  async insertItems(rows: readonly NewItemRow[]): Promise<Map<number, string>> {
    const ids = new Map<number, string>();
    for (const part of chunks(rows)) {
      const inserted = await this.#db
        .insertInto('plan_items')
        .values(part)
        .returning(['id', 'source_row'])
        .execute();
      for (const row of inserted) ids.set(row.source_row, row.id);
    }
    return ids;
  }

  async insertBudgetLines(rows: readonly NewBudgetLineRow[]): Promise<void> {
    for (const part of chunks(rows))
      await this.#db.insertInto('plan_budget_lines').values(part).execute();
  }

  async insertEvents(rows: readonly NewEventRow[]): Promise<void> {
    for (const part of chunks(rows))
      await this.#db.insertInto('plan_events').values(part).execute();
  }

  async insertGoals(rows: readonly NewGoalRow[]): Promise<void> {
    for (const part of chunks(rows)) await this.#db.insertInto('plan_goals').values(part).execute();
  }

  /** Inserta los escenarios y devuelve el identificador de cada uno por su fila del Excel. */
  async insertScenarios(rows: readonly NewScenarioRow[]): Promise<Map<number, string>> {
    const ids = new Map<number, string>();
    for (const part of chunks(rows)) {
      const inserted = await this.#db
        .insertInto('plan_scenarios')
        .values(part)
        .returning(['id', 'source_row'])
        .execute();
      for (const row of inserted) ids.set(row.source_row, row.id);
    }
    return ids;
  }

  async insertScenarioItems(rows: readonly NewScenarioItemRow[]): Promise<void> {
    for (const part of chunks(rows)) {
      await this.#db.insertInto('plan_scenario_items').values(part).execute();
    }
  }

  // --- lecturas (fase 3b.2, PR 2) --------------------------------------------------------------------

  /**
   * Las fotos cuyo mes está entre `from` y `to` (ambos `YYYY-MM-01`, incluidos), vigentes y sustituidas,
   * de la más reciente a la más antigua (y, en un mismo mes, la última creada primero).
   */
  async listSnapshotHeaders(from: string, to: string): Promise<SnapshotHeader[]> {
    const rows = await this.#db
      .selectFrom('plan_snapshots')
      .select(HEADER_COLUMNS)
      .where('month', '>=', from)
      .where('month', '<=', to)
      .orderBy('month', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map(toHeader);
  }

  /** Una foto por su identificador, vigente o sustituida. */
  async findSnapshotHeader(id: string): Promise<SnapshotHeader | undefined> {
    const row = await this.#db
      .selectFrom('plan_snapshots')
      .select(HEADER_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toHeader(row);
  }

  /** La foto vigente (`active`) de un mes (`YYYY-MM-01`); como mucho una, por un índice único parcial. */
  async findActiveSnapshotHeader(month: string): Promise<SnapshotHeader | undefined> {
    const row = await this.#db
      .selectFrom('plan_snapshots')
      .select(HEADER_COLUMNS)
      .where('month', '=', month)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return row === undefined ? undefined : toHeader(row);
  }

  /**
   * Las entradas de las cinco hojas de una foto. Las filas de una foto no cambian después de crearse (una
   * nueva confirmación crea otra foto), así que las lecturas no necesitan una transacción común.
   */
  async loadEntries(snapshotId: string): Promise<SnapshotEntries> {
    const [items, lines, events, goals, scenarios, scenarioItems] = await Promise.all([
      this.#db
        .selectFrom('plan_items')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .orderBy('source_row')
        .execute(),
      this.#db
        .selectFrom('plan_budget_lines')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .orderBy('source_row')
        .execute(),
      this.#db
        .selectFrom('plan_events')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .orderBy('source_row')
        .execute(),
      this.#db
        .selectFrom('plan_goals')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .orderBy('source_row')
        .execute(),
      this.#db
        .selectFrom('plan_scenarios')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .orderBy('source_row')
        .execute(),
      this.#db
        .selectFrom('plan_scenario_items')
        .innerJoin('plan_items', (join) =>
          join
            .onRef('plan_items.id', '=', 'plan_scenario_items.plan_item_id')
            .onRef('plan_items.snapshot_id', '=', 'plan_scenario_items.snapshot_id'),
        )
        .select([
          'plan_scenario_items.scenario_id',
          'plan_scenario_items.plan_item_id',
          'plan_scenario_items.role',
        ])
        // En el orden de la hoja de Datos: la respuesta no depende del orden físico de la tabla.
        .orderBy('plan_items.source_row')
        .orderBy('plan_scenario_items.role')
        .where('plan_scenario_items.snapshot_id', '=', snapshotId)
        .execute(),
    ]);

    // Los valores de los catálogos los fijan restricciones `CHECK` de la base de datos (migración 0010):
    // las columnas son `text` para Kysely, y aquí se les da el tipo del catálogo.
    return {
      items: items.map((row) => ({
        id: row.id,
        sourceRow: row.source_row,
        recordType: row.record_type as RecordType,
        groupLabel: row.group_label,
        concept: row.concept,
        unit: row.unit as Unit,
        amountCents: optionalCents(row.amount_cents),
        quantityHundredths: row.quantity_hundredths,
        nature: row.nature as Nature,
        status: row.status as Status,
        sourceNote: row.source_note,
        note: row.note,
      })),
      budgetLines: lines.map((row) => ({
        id: row.id,
        sourceRow: row.source_row,
        categoryId: row.category_id,
        categoryLabel: row.category_label,
        concept: row.concept,
        costType: row.cost_type as CostType,
        essential: row.essential,
        planItemId: row.plan_item_id,
      })),
      events: events.map((row) => ({
        id: row.id,
        sourceRow: row.source_row,
        concept: row.concept,
        note: row.note,
        natureLabel: row.nature_label,
        amountItemId: row.amount_item_id,
        multiplierItemId: row.multiplier_item_id,
        amountCents: optionalCents(row.amount_cents),
        status: row.status as EventStatus,
        expectedDate: row.expected_date,
        includeInProjection: row.include_in_projection,
      })),
      goals: goals.map((row) => ({
        id: row.id,
        sourceRow: row.source_row,
        name: row.name,
        criterion: row.criterion,
        goalKind: row.goal_kind as GoalKind,
        targetItemId: row.target_item_id,
        targetCents: optionalCents(row.target_cents),
        currentItemId: row.current_item_id,
        currentCents: optionalCents(row.current_cents),
        contributionItemId: row.contribution_item_id,
        contributionCents: optionalCents(row.contribution_cents),
      })),
      scenarios: scenarios.map((row) => ({
        id: row.id,
        sourceRow: row.source_row,
        name: row.name,
        items: scenarioItems
          .filter((entry) => entry.scenario_id === row.id)
          .map((entry) => ({ planItemId: entry.plan_item_id, role: entry.role })),
      })),
    };
  }

  // --- correspondencias de categorías ---------------------------------------------------------------

  /** Nombre normalizado → categoría de gasto. */
  async listCategoryMappings(): Promise<Map<string, string>> {
    const rows = await this.#db
      .selectFrom('plan_category_mappings')
      .select(['source_name_normalized', 'category_id'])
      .execute();
    return new Map(rows.map((row) => [row.source_name_normalized, row.category_id]));
  }

  /** Guarda (o cambia) las correspondencias. Idempotente: el mismo nombre se actualiza, no se duplica. */
  async upsertCategoryMappings(
    entries: readonly { readonly name: string; readonly categoryId: string }[],
    now: Date,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.#db
      .insertInto('plan_category_mappings')
      .values(
        entries.map((entry) => ({
          source_name_normalized: entry.name,
          category_id: entry.categoryId,
          created_at: now,
          updated_at: now,
        })),
      )
      .onConflict((oc) =>
        oc.column('source_name_normalized').doUpdateSet((eb) => ({
          category_id: eb.ref('excluded.category_id'),
          updated_at: now,
        })),
      )
      .execute();
  }
}
