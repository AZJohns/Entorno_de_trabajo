/**
 * Acceso a las tablas de la capa del plan (`plan_*`, migración 0010). Solo consultas: ninguna decisión de
 * negocio. Recibe un `Kysely` o una transacción para que el servicio (o el módulo de importaciones) pueda
 * agrupar operaciones en una sola.
 *
 * Los importes se escriben como números enteros de céntimos y se leen como cadena (`bigint`); aquí no se
 * lee ninguno de vuelta, porque el cálculo del plan es de la fase 3b.2.
 */
import { sql, type Insertable, type Kysely } from 'kysely';
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

const SNAPSHOT_COLUMNS = ['id', 'month', 'import_batch_id', 'content_hash', 'status'] as const;

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
