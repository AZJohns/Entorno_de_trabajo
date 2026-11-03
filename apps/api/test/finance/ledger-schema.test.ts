/**
 * Restricciones de la migración 0003 contra un PostgreSQL real (docs/plan.md §2.3). Cada test comprueba
 * que la base de datos rechaza el dato inválido **por la restricción concreta**, no por otro motivo.
 * Los importes y nombres son inventados.
 */
import { sql, type Kysely } from 'kysely';
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

const unique = (prefix: string): string => `${prefix} ${String(++seq)}`;

async function account(
  overrides: Partial<{ name: string; archivedAt: Date }> = {},
): Promise<string> {
  const row = await db
    .insertInto('accounts')
    .values({
      name: overrides.name ?? unique('Cuenta'),
      type: 'checking',
      opening_date: '2026-01-01',
      archived_at: overrides.archivedAt ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function category(kind: 'income' | 'expense', name = unique('Categoría')): Promise<string> {
  const row = await db
    .insertInto('categories')
    .values({ name, kind })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Valores de un gasto manual confirmado y completo; cada test cambia lo que quiere romper. */
function confirmedExpense(accountId: string, categoryId: string): Record<string, unknown> {
  return {
    kind: 'expense',
    amount_cents: 1250,
    account_id: accountId,
    category_id: categoryId,
    booked_on: '2026-10-10',
    source: 'manual',
    status: 'confirmed',
    confirmed_at: new Date('2026-10-10T10:00:00Z'),
  };
}

async function insertMovement(values: Record<string, unknown>): Promise<string> {
  const row = await db
    .insertInto('movements')
    // Los valores se construyen a mano para poder romper cada regla; la base de datos es la que valida.
    .values(values as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Comprueba que la inserción falla por la restricción indicada (código y nombre). */
async function expectViolation(
  action: Promise<unknown>,
  code: '23514' | '23505' | '23503',
  constraint: string,
): Promise<void> {
  await expect(action).rejects.toMatchObject({ code, constraint });
}

/**
 * Comprueba que borrar una fila referenciada falla por la restricción indicada.
 *
 * Las FK son `ON DELETE RESTRICT` y el código SQLSTATE depende de la versión de PostgreSQL: la 17 y
 * anteriores devuelven 23503 (`foreign_key_violation`) y la 18 devuelve 23001 (`restrict_violation`).
 * `isReferencedRowError` acepta los dos; el nombre de la restricción sigue distinguiendo una FK de otra.
 */
async function expectReferencedRow(action: Promise<unknown>, constraint: string): Promise<void> {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'el borrado debía fallar').not.toBeNull();
  expect(isReferencedRowError(error, constraint)).toBe(true);
}

describe('accounts', () => {
  it('rechaza un tipo desconocido, otra moneda y un nombre vacío', async () => {
    const base = { name: unique('Cuenta'), type: 'checking' as const, opening_date: '2026-01-01' };
    await expectViolation(
      db
        .insertInto('accounts')
        .values({ ...base, type: 'credit' } as never)
        .execute(),
      '23514',
      'accounts_type_check',
    );
    await expectViolation(
      db
        .insertInto('accounts')
        .values({ ...base, currency: 'USD' } as never)
        .execute(),
      '23514',
      'accounts_currency_check',
    );
    await expectViolation(
      db
        .insertInto('accounts')
        .values({ ...base, name: '' })
        .execute(),
      '23514',
      'accounts_name_check',
    );
  });

  it('admite un saldo inicial negativo y la moneda es EUR por defecto', async () => {
    const row = await db
      .insertInto('accounts')
      .values({
        name: unique('Descubierto'),
        type: 'savings',
        opening_balance_cents: -5000,
        opening_date: '2026-01-01',
      })
      .returning(['opening_balance_cents', 'currency'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ opening_balance_cents: '-5000', currency: 'EUR' });
  });

  it('el nombre es único sin distinguir mayúsculas, salvo en las archivadas', async () => {
    const name = unique('Nómina');
    const id = await account({ name });
    await expectViolation(
      account({ name: name.toUpperCase() }),
      '23505',
      'accounts_active_name_key',
    );
    // Archivada, su nombre se puede reutilizar.
    await db
      .updateTable('accounts')
      .set({ archived_at: new Date() })
      .where('id', '=', id)
      .execute();
    await expect(account({ name })).resolves.toBeTypeOf('string');
  });

  it('devuelve opening_date como texto YYYY-MM-DD, sin depender de la zona horaria', async () => {
    const row = await db
      .insertInto('accounts')
      .values({ name: unique('Fecha'), type: 'cash', opening_date: '2026-03-31' })
      .returning('opening_date')
      .executeTakeFirstOrThrow();
    expect(row.opening_date).toBe('2026-03-31');
  });
});

describe('categories', () => {
  it('el nombre es único por tipo sin distinguir mayúsculas, y el mismo nombre puede existir en otro tipo', async () => {
    const name = unique('Varios');
    await category('expense', name);
    await expectViolation(
      category('expense', name.toLowerCase()),
      '23505',
      'categories_kind_name_key',
    );
    await expect(category('income', name)).resolves.toBeTypeOf('string');
  });

  it('rechaza un tipo desconocido', async () => {
    await expectViolation(
      db
        .insertInto('categories')
        .values({ name: unique('X'), kind: 'transfer' } as never)
        .execute(),
      '23514',
      'categories_kind_check',
    );
  });
});

describe('movements', () => {
  it('acepta un gasto confirmado completo', async () => {
    await expect(
      insertMovement(confirmedExpense(await account(), await category('expense'))),
    ).resolves.toBeTypeOf('string');
  });

  it('rechaza un importe negativo', async () => {
    await expectViolation(
      insertMovement({
        ...confirmedExpense(await account(), await category('expense')),
        amount_cents: -1,
      }),
      '23514',
      'movements_amount_cents_check',
    );
  });

  it('impide asignar una categoría de ingreso a un gasto (y al revés)', async () => {
    const acc = await account();
    await expectViolation(
      insertMovement(confirmedExpense(acc, await category('income'))),
      '23503',
      'movements_category_kind_fkey',
    );
    await expectViolation(
      insertMovement({ ...confirmedExpense(acc, await category('expense')), kind: 'income' }),
      '23503',
      'movements_category_kind_fkey',
    );
  });

  it('un movimiento confirmado debe estar completo', async () => {
    const acc = await account();
    const cat = await category('expense');
    const complete = confirmedExpense(acc, cat);
    const broken: Record<string, unknown>[] = [
      { ...complete, amount_cents: 0 },
      { ...complete, account_id: null },
      { ...complete, category_id: null },
      { ...complete, flags: ['unknown_card'] },
    ];
    for (const values of broken) {
      await expectViolation(insertMovement(values), '23514', 'movements_confirmed_is_complete');
    }
  });

  it('un borrador pendiente puede estar incompleto, pero no tener confirmed_at', async () => {
    await expect(
      insertMovement({
        kind: 'expense',
        amount_cents: 0,
        booked_on: '2026-10-10',
        source: 'manual',
        status: 'pending',
        flags: ['amount_missing', 'unknown_card'],
      }),
    ).resolves.toBeTypeOf('string');
    await expectViolation(
      insertMovement({
        kind: 'expense',
        amount_cents: 0,
        booked_on: '2026-10-10',
        source: 'manual',
        status: 'pending',
        confirmed_at: new Date(),
      }),
      '23514',
      'movements_confirmed_at',
    );
  });

  it('confirmed_at es obligatorio al confirmar', async () => {
    await expectViolation(
      insertMovement({
        ...confirmedExpense(await account(), await category('expense')),
        confirmed_at: null,
      }),
      '23514',
      'movements_confirmed_at',
    );
  });

  it('rechaza una incidencia desconocida, un estado desconocido y la fuente shortcut (fase 2)', async () => {
    const pending = {
      kind: 'expense',
      amount_cents: 0,
      booked_on: '2026-10-10',
      status: 'pending',
    };
    await expectViolation(
      insertMovement({ ...pending, source: 'manual', flags: ['inventada'] }),
      '23514',
      'movements_flags_known',
    );
    await expectViolation(
      // Fila completa y sin confirmed_at, para que solo falle la restricción del estado.
      insertMovement({
        ...confirmedExpense(await account(), await category('expense')),
        status: 'draft',
        confirmed_at: null,
      }),
      '23514',
      'movements_status_check',
    );
    await expectViolation(
      insertMovement({ ...pending, source: 'shortcut' }),
      '23514',
      'movements_source_check',
    );
  });

  it('solo los ajustes llevan reconciliation_id, y los ajustes no pueden estar pendientes', async () => {
    const acc = await account();
    const rec = await reconciliation(acc, '2026-10-01', '2026-10-15');
    const adjustment = {
      kind: 'income',
      amount_cents: 250,
      account_id: acc,
      booked_on: '2026-10-15',
      source: 'reconciliation',
      reconciliation_id: rec,
      status: 'confirmed',
      confirmed_at: new Date(),
    };
    // Un ajuste sin categoría es válido…
    await expect(insertMovement(adjustment)).resolves.toBeTypeOf('string');
    // …un movimiento manual con reconciliation_id, o un ajuste sin él, no.
    const cat = await category('income');
    await expectViolation(
      insertMovement({ ...confirmedExpense(acc, cat), kind: 'income', reconciliation_id: rec }),
      '23514',
      'movements_reconciliation_source',
    );
    await expectViolation(
      insertMovement({ ...adjustment, reconciliation_id: null }),
      '23514',
      'movements_reconciliation_source',
    );
    await expectViolation(
      insertMovement({ ...adjustment, status: 'pending', confirmed_at: null }),
      '23514',
      'movements_reconciliation_is_confirmed',
    );
  });

  it('una cuenta con movimientos no se puede borrar y una categoría usada tampoco', async () => {
    const acc = await account();
    const cat = await category('expense');
    await insertMovement(confirmedExpense(acc, cat));
    await expectReferencedRow(
      db.deleteFrom('accounts').where('id', '=', acc).execute(),
      'movements_account_id_fkey',
    );
    await expectReferencedRow(
      db.deleteFrom('categories').where('id', '=', cat).execute(),
      'movements_category_kind_fkey',
    );
  });
});

async function reconciliation(accountId: string, month: string, asOf: string): Promise<string> {
  const row = await db
    .insertInto('account_reconciliations')
    .values({
      account_id: accountId,
      month,
      as_of: asOf,
      statement_balance_cents: 10_000,
      computed_balance_cents: 9_750,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('account_reconciliations', () => {
  it('no puede haber dos por cuenta y mes, pero sí en otro mes u otra cuenta', async () => {
    const acc = await account();
    await reconciliation(acc, '2026-10-01', '2026-10-31');
    await expectViolation(
      reconciliation(acc, '2026-10-01', '2026-10-15'),
      '23505',
      'account_reconciliations_account_month_key',
    );
    await expect(reconciliation(acc, '2026-11-01', '2026-11-02')).resolves.toBeTypeOf('string');
    await expect(reconciliation(await account(), '2026-10-01', '2026-10-31')).resolves.toBeTypeOf(
      'string',
    );
  });

  it('month debe ser el primer día del mes', async () => {
    await expectViolation(
      reconciliation(await account(), '2026-10-02', '2026-10-15'),
      '23514',
      'account_reconciliations_month_check',
    );
  });

  it('as_of debe estar dentro del mes (incluidos el primer y el último día)', async () => {
    const acc = await account();
    for (const asOf of ['2026-09-30', '2026-11-01', '2025-10-15']) {
      await expectViolation(
        reconciliation(acc, '2026-10-01', asOf),
        '23514',
        'account_reconciliations_as_of_in_month',
      );
    }
    await expect(reconciliation(acc, '2026-10-01', '2026-10-01')).resolves.toBeTypeOf('string');
    await expect(reconciliation(acc, '2026-02-01', '2026-02-28')).resolves.toBeTypeOf('string');
  });

  it('borrar la conciliación borra su ajuste y solo ese', async () => {
    const acc = await account();
    const cat = await category('expense');
    const rec = await reconciliation(acc, '2026-10-01', '2026-10-15');
    const adjustment = await insertMovement({
      kind: 'income',
      amount_cents: 250,
      account_id: acc,
      booked_on: '2026-10-15',
      source: 'reconciliation',
      reconciliation_id: rec,
      status: 'confirmed',
      confirmed_at: new Date(),
    });
    const ordinary = await insertMovement(confirmedExpense(acc, cat));

    await db.deleteFrom('account_reconciliations').where('id', '=', rec).execute();

    const remaining = await db
      .selectFrom('movements')
      .select('id')
      .where('id', 'in', [adjustment, ordinary])
      .execute();
    expect(remaining.map((row) => row.id)).toEqual([ordinary]);
  });

  it('una conciliación solo tiene un ajuste', async () => {
    const acc = await account();
    const rec = await reconciliation(acc, '2026-10-01', '2026-10-15');
    const adjustment = {
      kind: 'income',
      amount_cents: 250,
      account_id: acc,
      booked_on: '2026-10-15',
      source: 'reconciliation',
      reconciliation_id: rec,
      status: 'confirmed',
      confirmed_at: new Date(),
    };
    await insertMovement(adjustment);
    await expectViolation(insertMovement(adjustment), '23505', 'movements_reconciliation_id_key');
  });

  it('el ajuste debe ser de la misma cuenta que la conciliación', async () => {
    const rec = await reconciliation(await account(), '2026-10-01', '2026-10-15');
    await expectViolation(
      insertMovement({
        kind: 'income',
        amount_cents: 250,
        account_id: await account(),
        booked_on: '2026-10-15',
        source: 'reconciliation',
        reconciliation_id: rec,
        status: 'confirmed',
        confirmed_at: new Date(),
      }),
      '23503',
      'movements_reconciliation_fkey',
    );
  });
});

describe('transfers', () => {
  async function insertTransfer(values: Record<string, unknown>): Promise<unknown> {
    return db
      .insertInto('transfers')
      .values({ booked_on: '2026-10-10', amount_cents: 5_000, ...values } as never)
      .execute();
  }

  it('acepta una transferencia entre dos cuentas distintas', async () => {
    await expect(
      insertTransfer({ from_account_id: await account(), to_account_id: await account() }),
    ).resolves.toBeDefined();
  });

  it('rechaza el mismo origen y destino', async () => {
    const acc = await account();
    await expectViolation(
      insertTransfer({ from_account_id: acc, to_account_id: acc }),
      '23514',
      'transfers_distinct_accounts',
    );
  });

  it('rechaza un importe de 0 o negativo', async () => {
    const [from, to] = [await account(), await account()];
    for (const amount of [0, -100]) {
      await expectViolation(
        insertTransfer({ from_account_id: from, to_account_id: to, amount_cents: amount }),
        '23514',
        'transfers_amount_cents_check',
      );
    }
  });

  it('rechaza una cuenta inexistente y no deja borrar una cuenta con transferencias', async () => {
    const [from, to] = [await account(), await account()];
    await expectViolation(
      insertTransfer({
        from_account_id: from,
        to_account_id: '00000000-0000-4000-8000-000000000000',
      }),
      '23503',
      'transfers_to_account_id_fkey',
    );
    await insertTransfer({ from_account_id: from, to_account_id: to });
    await expectReferencedRow(
      db.deleteFrom('accounts').where('id', '=', to).execute(),
      'transfers_to_account_id_fkey',
    );
  });

  it('una transferencia no es un movimiento: no aparece en movements', async () => {
    const [from, to] = [await account(), await account()];
    await insertTransfer({ from_account_id: from, to_account_id: to });
    const { rows } = await sql<{ n: string }>`
      SELECT count(*) AS n FROM movements WHERE account_id IN (${from}, ${to})
    `.execute(db);
    expect(rows[0]?.n).toBe('0');
  });
});
