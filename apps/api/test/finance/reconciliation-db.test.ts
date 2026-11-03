/**
 * Conciliación con filas reales de PostgreSQL: las funciones puras de domain/ se alimentan con lo que
 * devuelve la base de datos (importes como cadena, fechas como texto) y el resultado se guarda y se
 * vuelve a leer. El servicio de la parte 1b (PR 2) hará lo mismo; aquí se comprueba que domain/ y
 * las restricciones de 0003 son coherentes entre sí. Importes y nombres inventados.
 */
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { centsFromDb } from '../../src/db/cents.ts';
import type { Database } from '../../src/db/schema.ts';
import type { AccountLedger } from '../../src/modules/finance/ledger/domain/balances.ts';
import { balanceAsOf } from '../../src/modules/finance/ledger/domain/balances.ts';
import {
  reconcile,
  reconciliationDiscrepancy,
} from '../../src/modules/finance/ledger/domain/reconciliation.ts';
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

interface Fixture {
  readonly accountId: string;
  readonly otherAccountId: string;
  readonly categoryId: string;
  readonly expenseId: string;
}

/** Cuenta con apertura de 1.000,00 €, un ingreso, dos gastos y una transferencia recibida. */
async function createFixture(): Promise<Fixture> {
  const n = String(++seq);
  const insertAccount = async (name: string, opening: number): Promise<string> =>
    (
      await db
        .insertInto('accounts')
        .values({
          name: `${name} ${n}`,
          type: 'checking',
          opening_balance_cents: opening,
          opening_date: '2026-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const accountId = await insertAccount('Cuenta', 100_000);
  const otherAccountId = await insertAccount('Otra', 50_000);
  const expenseCategory = (
    await db
      .insertInto('categories')
      .values({ name: `Gastos ${n}`, kind: 'expense' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const incomeCategory = (
    await db
      .insertInto('categories')
      .values({ name: `Ingresos ${n}`, kind: 'income' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  const insertMovement = async (
    kind: 'income' | 'expense',
    amount: number,
    bookedOn: string,
  ): Promise<string> =>
    (
      await db
        .insertInto('movements')
        .values({
          kind,
          amount_cents: amount,
          account_id: accountId,
          category_id: kind === 'income' ? incomeCategory : expenseCategory,
          booked_on: bookedOn,
          source: 'manual',
          status: 'confirmed',
          confirmed_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  await insertMovement('income', 200_000, '2026-10-01');
  const expenseId = await insertMovement('expense', 20_000, '2026-10-05');
  await insertMovement('expense', 9_999, '2026-10-20');
  await db
    .insertInto('transfers')
    .values({
      from_account_id: otherAccountId,
      to_account_id: accountId,
      amount_cents: 5_000,
      booked_on: '2026-10-08',
    })
    .execute();
  return { accountId, otherAccountId, categoryId: expenseCategory, expenseId };
}

/** Lee del libro lo que necesita el dominio, convirtiendo los importes como lo hará el repositorio. */
async function loadLedger(accountId: string): Promise<AccountLedger> {
  const account = await db
    .selectFrom('accounts')
    .select('opening_balance_cents')
    .where('id', '=', accountId)
    .executeTakeFirstOrThrow();
  const movements = await db
    .selectFrom('movements')
    .selectAll()
    .where('account_id', '=', accountId)
    .execute();
  const transfers = await db
    .selectFrom('transfers')
    .selectAll()
    .where((eb) =>
      eb.or([eb('from_account_id', '=', accountId), eb('to_account_id', '=', accountId)]),
    )
    .execute();
  return {
    accountId,
    openingBalanceCents: centsFromDb(account.opening_balance_cents),
    movements: movements.map((row) => ({
      accountId: row.account_id,
      kind: row.kind,
      amountCents: centsFromDb(row.amount_cents),
      bookedOn: row.booked_on,
      status: row.status,
      source: row.source,
      reconciliationId: row.reconciliation_id,
    })),
    transfers: transfers.map((row) => ({
      fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id,
      amountCents: centsFromDb(row.amount_cents),
      bookedOn: row.booked_on,
    })),
  };
}

/** Guarda la conciliación y su ajuste en una sola transacción (lo que hará el servicio). */
async function reconcileAndSave(
  accountId: string,
  month: string,
  asOf: string,
  statementBalanceCents: number,
): Promise<{ reconciliationId: string; adjustmentId: string | null }> {
  const result = reconcile({
    ledger: await loadLedger(accountId),
    month,
    asOf,
    statementBalanceCents,
  });
  return db.transaction().execute(async (trx) => {
    const reconciliation = await trx
      .insertInto('account_reconciliations')
      .values({
        account_id: accountId,
        month,
        as_of: asOf,
        statement_balance_cents: statementBalanceCents,
        computed_balance_cents: result.computedBalanceCents,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    let adjustmentId: string | null = null;
    if (result.adjustment !== null) {
      adjustmentId = (
        await trx
          .insertInto('movements')
          .values({
            kind: result.adjustment.kind,
            amount_cents: result.adjustment.amountCents,
            description: result.adjustment.description,
            account_id: accountId,
            booked_on: result.adjustment.bookedOn,
            source: 'reconciliation',
            reconciliation_id: reconciliation.id,
            status: 'confirmed',
            confirmed_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    return { reconciliationId: reconciliation.id, adjustmentId };
  });
}

const month = '2026-10-01';
const asOf = '2026-10-15';

describe('conciliación con la base de datos', () => {
  it('el saldo calculado se obtiene de las filas: apertura + ingresos − gastos + transferencias', async () => {
    const { accountId, otherAccountId } = await createFixture();
    expect(balanceAsOf(await loadLedger(accountId), asOf)).toBe(100_000 + 200_000 - 20_000 + 5_000);
    // El gasto del 20 de octubre entra solo sin fecha límite.
    expect(balanceAsOf(await loadLedger(accountId), null)).toBe(285_000 - 9_999);
    // La cuenta de origen de la transferencia pierde ese importe.
    expect(balanceAsOf(await loadLedger(otherAccountId), null)).toBe(45_000);
  });

  it('diferencia 0: se guarda la conciliación y no se crea ningún ajuste', async () => {
    const { accountId } = await createFixture();
    const saved = await reconcileAndSave(accountId, month, asOf, 285_000);
    expect(saved.adjustmentId).toBeNull();
    const adjustments = await db
      .selectFrom('movements')
      .select('id')
      .where('reconciliation_id', '=', saved.reconciliationId)
      .execute();
    expect(adjustments).toEqual([]);
  });

  it('diferencia positiva: crea un ingreso de ajuste y el saldo pasa a ser el del banco', async () => {
    const { accountId } = await createFixture();
    const saved = await reconcileAndSave(accountId, month, asOf, 285_250);
    const adjustment = await db
      .selectFrom('movements')
      .selectAll()
      .where('id', '=', saved.adjustmentId ?? '')
      .executeTakeFirstOrThrow();
    expect(adjustment).toMatchObject({
      kind: 'income',
      amount_cents: '250',
      booked_on: asOf,
      source: 'reconciliation',
      status: 'confirmed',
      category_id: null,
      description: 'Ajuste de conciliación',
    });
    expect(balanceAsOf(await loadLedger(accountId), asOf)).toBe(285_250);
  });

  it('diferencia negativa: crea un gasto de ajuste y el saldo pasa a ser el del banco', async () => {
    const { accountId } = await createFixture();
    const saved = await reconcileAndSave(accountId, month, asOf, 284_100);
    const adjustment = await db
      .selectFrom('movements')
      .selectAll()
      .where('id', '=', saved.adjustmentId ?? '')
      .executeTakeFirstOrThrow();
    expect(adjustment).toMatchObject({ kind: 'expense', amount_cents: '900' });
    expect(balanceAsOf(await loadLedger(accountId), asOf)).toBe(284_100);
  });

  it('el registro histórico guarda el saldo calculado antes del ajuste', async () => {
    const { accountId } = await createFixture();
    const saved = await reconcileAndSave(accountId, month, asOf, 285_250);
    const row = await db
      .selectFrom('account_reconciliations')
      .select(['statement_balance_cents', 'computed_balance_cents'])
      .where('id', '=', saved.reconciliationId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ statement_balance_cents: '285250', computed_balance_cents: '285000' });
  });

  it('borrar la conciliación borra el ajuste y el saldo vuelve al calculado', async () => {
    const { accountId } = await createFixture();
    const saved = await reconcileAndSave(accountId, month, asOf, 285_250);
    await db
      .deleteFrom('account_reconciliations')
      .where('id', '=', saved.reconciliationId)
      .execute();
    const adjustment = await db
      .selectFrom('movements')
      .select('id')
      .where('id', '=', saved.adjustmentId ?? '')
      .executeTakeFirst();
    expect(adjustment).toBeUndefined();
    expect(balanceAsOf(await loadLedger(accountId), asOf)).toBe(285_000);
  });

  it('no puede haber dos por cuenta y mes, y el intento fallido no deja un segundo ajuste', async () => {
    const { accountId } = await createFixture();
    await reconcileAndSave(accountId, month, asOf, 285_250);
    await expect(reconcileAndSave(accountId, month, '2026-10-31', 1)).rejects.toMatchObject({
      code: '23505',
      constraint: 'account_reconciliations_account_month_key',
    });
    const adjustments = await db
      .selectFrom('movements')
      .select('id')
      .where('account_id', '=', accountId)
      .where('source', '=', 'reconciliation')
      .execute();
    expect(adjustments).toHaveLength(1);
  });

  it('un movimiento editado después de conciliar produce una discrepancia', async () => {
    const { accountId, expenseId } = await createFixture();
    const saved = await reconcileAndSave(accountId, month, asOf, 285_250);
    const recordedRow = await db
      .selectFrom('account_reconciliations')
      .selectAll()
      .where('id', '=', saved.reconciliationId)
      .executeTakeFirstOrThrow();
    const recorded = {
      id: recordedRow.id,
      asOf: recordedRow.as_of,
      computedBalanceCents: centsFromDb(recordedRow.computed_balance_cents),
    };

    expect(reconciliationDiscrepancy(await loadLedger(accountId), recorded).hasDiscrepancy).toBe(
      false,
    );

    await db
      .updateTable('movements')
      .set({ amount_cents: 18_000 })
      .where('id', '=', expenseId)
      .execute();
    expect(reconciliationDiscrepancy(await loadLedger(accountId), recorded)).toMatchObject({
      hasDiscrepancy: true,
      differenceCents: 2_000,
      recordedCents: 285_000,
      currentCents: 287_000,
    });
  });

  it('una conciliación de octubre cuenta el ajuste de una anterior de septiembre', async () => {
    const { accountId } = await createFixture();
    await reconcileAndSave(accountId, '2026-09-01', '2026-09-30', 100_100);
    // Septiembre: apertura 100.000, sin movimientos → ajuste +100. Octubre: 285.000 + 100.
    const october = reconcile({
      ledger: await loadLedger(accountId),
      month,
      asOf,
      statementBalanceCents: 285_100,
    });
    expect(october.computedBalanceCents).toBe(285_100);
    expect(october.adjustment).toBeNull();
  });
});
