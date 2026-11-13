/**
 * Acceso a la tabla `category_budgets`. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción, como `LedgerRepository`, para que el servicio pueda agrupar
 * operaciones. Los importes salen ya en céntimos y el mes como `YYYY-MM-01`.
 */
import type { Kysely, Selectable } from 'kysely';
import { centsFromDb } from '../../../db/cents.ts';
import type { CategoryBudgetsTable, Database } from '../../../db/schema.ts';
import type { LocalDate } from '../ledger/domain/dates.ts';

export interface BudgetRecord {
  readonly id: string;
  /** Primer día del mes presupuestado (`YYYY-MM-01`). */
  readonly month: LocalDate;
  readonly categoryId: string;
  readonly amountCents: number;
}

/** Un presupuesto del mes con su origen, para que la importación decida qué sustituye. */
export interface BudgetOriginRecord extends BudgetRecord {
  /** Foto del plan que lo creó, o `null` si se creó a mano. */
  readonly sourceSnapshotId: string | null;
}

/** Valores de un presupuesto nuevo. */
export interface NewBudget {
  readonly month: LocalDate;
  readonly categoryId: string;
  readonly amountCents: number;
}

type BudgetRow = Selectable<CategoryBudgetsTable>;

function toBudget(row: BudgetRow): BudgetRecord {
  return {
    id: row.id,
    month: row.month,
    categoryId: row.category_id,
    amountCents: centsFromDb(row.amount_cents),
  };
}

export class BudgetRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /** Presupuestos de un mes (`month` es el primer día). Sin orden de negocio: lo pone el servicio. */
  async listByMonth(month: LocalDate): Promise<BudgetRecord[]> {
    const rows = await this.#db
      .selectFrom('category_budgets')
      .selectAll()
      .where('month', '=', month)
      // Orden fijo: dos copias a la vez insertan en el mismo orden y no se bloquean entre sí.
      .orderBy('id')
      .execute();
    return rows.map(toBudget);
  }

  /** Presupuestos de un mes con su origen (`source_snapshot_id`). Orden fijo por `id`. */
  async listOriginByMonth(month: LocalDate): Promise<BudgetOriginRecord[]> {
    const rows = await this.#db
      .selectFrom('category_budgets')
      .selectAll()
      .where('month', '=', month)
      .orderBy('id')
      .execute();
    return rows.map((row) => ({ ...toBudget(row), sourceSnapshotId: row.source_snapshot_id }));
  }

  /** Todos los presupuestos de todos los meses, para la exportación. Orden fijo: mes, id. */
  async listAll(): Promise<BudgetRecord[]> {
    const rows = await this.#db
      .selectFrom('category_budgets')
      .selectAll()
      .orderBy('month')
      .orderBy('id')
      .execute();
    return rows.map(toBudget);
  }

  async find(id: string): Promise<BudgetRecord | undefined> {
    const row = await this.#db
      .selectFrom('category_budgets')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toBudget(row);
  }

  async insert(values: NewBudget): Promise<BudgetRecord> {
    const row = await this.#db
      .insertInto('category_budgets')
      .values({
        month: values.month,
        category_id: values.categoryId,
        amount_cents: values.amountCents,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toBudget(row);
  }

  /**
   * Inserta varios presupuestos importados en una sentencia, con la foto que los crea como origen; falla
   * si alguno ya existe (`UNIQUE (month, category_id)`).
   */
  async insertImported(values: readonly NewBudget[], snapshotId: string): Promise<void> {
    if (values.length === 0) return;
    await this.#db
      .insertInto('category_budgets')
      .values(
        values.map((value) => ({
          month: value.month,
          category_id: value.categoryId,
          amount_cents: value.amountCents,
          source_snapshot_id: snapshotId,
        })),
      )
      .execute();
  }

  /** Reasigna un presupuesto importado a la foto nueva, con su importe (el mismo si no cambia). */
  async updateImported(
    id: string,
    amountCents: number,
    snapshotId: string,
    now: Date,
  ): Promise<void> {
    await this.#db
      .updateTable('category_budgets')
      .set({ amount_cents: amountCents, source_snapshot_id: snapshotId, updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  /** Borra presupuestos por identificador. */
  async deleteMany(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.#db.deleteFrom('category_budgets').where('id', 'in', ids).execute();
  }

  /**
   * Inserta los presupuestos que aún no existen y **ignora** los que ya tienen fila para ese mes y
   * categoría (`ON CONFLICT DO NOTHING`): nunca sobrescribe, ni siquiera con dos copias a la vez.
   *
   * @returns cuántos se han insertado.
   */
  async insertMissing(values: readonly NewBudget[]): Promise<number> {
    if (values.length === 0) return 0;
    const inserted = await this.#db
      .insertInto('category_budgets')
      .values(
        values.map((value) => ({
          month: value.month,
          category_id: value.categoryId,
          amount_cents: value.amountCents,
        })),
      )
      .onConflict((oc) => oc.columns(['month', 'category_id']).doNothing())
      .returning('id')
      .execute();
    return inserted.length;
  }

  async updateAmount(
    id: string,
    amountCents: number,
    now: Date,
  ): Promise<BudgetRecord | undefined> {
    const row = await this.#db
      .updateTable('category_budgets')
      // Editar el importe a mano lo convierte en un presupuesto manual: ya no lo sustituye la importación.
      .set({ amount_cents: amountCents, source_snapshot_id: null, updated_at: now })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toBudget(row);
  }

  /** @returns `false` si no existía. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db
      .deleteFrom('category_budgets')
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}
