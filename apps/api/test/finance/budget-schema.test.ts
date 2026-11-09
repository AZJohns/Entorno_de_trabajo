/**
 * Restricciones de la migración 0005 (`category_budgets`) contra un PostgreSQL real. Cada test comprueba
 * que la base de datos rechaza el dato inválido **por la restricción concreta**. Importes inventados.
 */
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isReferencedRowError } from '../../src/db/errors.ts';
import type { Database } from '../../src/db/schema.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';

let testDb: TestDatabase;
let db: Kysely<Database>;
let seq = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = testDb.db;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb.drop();
}, DB_TIMEOUT_MS);

async function category(kind: 'income' | 'expense'): Promise<string> {
  const row = await db
    .insertInto('categories')
    .values({ name: `Categoría ${String(++seq)}`, kind })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Inserta con valores construidos a mano para poder romper cada regla; la base de datos valida. */
function insertBudget(values: Record<string, unknown>) {
  return db
    .insertInto('category_budgets')
    .values(values as never)
    .returning('id')
    .executeTakeFirstOrThrow();
}

const valid = (categoryId: string): Record<string, unknown> => ({
  month: '2026-10-01',
  category_id: categoryId,
  amount_cents: 30_000,
});

async function expectViolation(
  action: Promise<unknown>,
  code: '23514' | '23505' | '23503',
  constraint: string,
): Promise<void> {
  await expect(action).rejects.toMatchObject({ code, constraint });
}

describe('category_budgets', () => {
  it('acepta un presupuesto válido y devuelve el mes como texto y el importe como bigint', async () => {
    const row = await db
      .insertInto('category_budgets')
      .values({ month: '2026-10-01', category_id: await category('expense'), amount_cents: 30_000 })
      .returning(['month', 'kind', 'amount_cents'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ month: '2026-10-01', kind: 'expense', amount_cents: '30000' });
  });

  it('el mes debe ser el primer día', async () => {
    const id = await category('expense');
    await expectViolation(
      insertBudget({ ...valid(id), month: '2026-10-15' }),
      '23514',
      'category_budgets_month_check',
    );
    await expectViolation(
      insertBudget({ ...valid(id), month: '2026-10-31' }),
      '23514',
      'category_budgets_month_check',
    );
  });

  it.each([0, -1])('el importe debe ser mayor que 0 (%s)', async (amount) => {
    await expectViolation(
      insertBudget({ ...valid(await category('expense')), amount_cents: amount }),
      '23514',
      'category_budgets_amount_cents_check',
    );
  });

  it('solo categorías de gasto: la de ingreso se rechaza por la clave ajena compuesta', async () => {
    await expectViolation(
      insertBudget(valid(await category('income'))),
      '23503',
      'category_budgets_category_expense_fkey',
    );
  });

  it('`kind` solo puede valer «expense»', async () => {
    await expectViolation(
      insertBudget({ ...valid(await category('income')), kind: 'income' }),
      '23514',
      'category_budgets_kind_check',
    );
  });

  it('la categoría debe existir', async () => {
    await expectViolation(
      insertBudget(valid('00000000-0000-4000-8000-000000000000')),
      '23503',
      'category_budgets_category_expense_fkey',
    );
  });

  it('un único presupuesto por mes y categoría; otro mes u otra categoría sí se admite', async () => {
    const id = await category('expense');
    await insertBudget(valid(id));
    await expectViolation(
      insertBudget({ ...valid(id), amount_cents: 1 }),
      '23505',
      'category_budgets_month_category_key',
    );
    await expect(insertBudget({ ...valid(id), month: '2026-11-01' })).resolves.toBeDefined();
    await expect(insertBudget(valid(await category('expense')))).resolves.toBeDefined();
  });

  it('no se puede borrar una categoría con presupuesto (se archiva)', async () => {
    const id = await category('expense');
    await insertBudget(valid(id));
    const error = await db
      .deleteFrom('categories')
      .where('id', '=', id)
      .execute()
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error, 'el borrado debía fallar').not.toBeNull();
    expect(isReferencedRowError(error, 'category_budgets_category_expense_fkey')).toBe(true);
  });
});
