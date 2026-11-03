/**
 * Conciliación por la API, de extremo a extremo: HTTP → servicio → PostgreSQL → funciones puras.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MovementResponse, ReconciliationResponse } from '@backoffice/shared';
import { balanceAsOf } from '../../src/modules/finance/ledger/domain/balances.ts';
import { LedgerRepository } from '../../src/modules/finance/ledger/ledger.repository.ts';
import { useAuthTestContext } from '../support/auth.ts';
import type { TestClient } from '../support/client.ts';
import {
  archiveEmptied,
  createAccount,
  createCategory,
  createMovement,
  expectProblem,
  resetLedger,
  type Created,
} from '../support/ledger.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

const MISSING = '00000000-0000-4000-8000-000000000000';

/**
 * Cuenta abierta el 1/1/2026 con 1.000,00 €, y en octubre: ingreso de 2.000,00 el día 1, gasto de
 * 200,00 el 5, transferencia recibida de 50,00 el 8 y gasto de 99,99 el 20. Saldo el 15/10: 2.850,00.
 */
async function setup(client: TestClient) {
  const account = await createAccount(client);
  const other = await createAccount(client);
  const expense = await createCategory(client, 'expense');
  const income = await createCategory(client, 'income');
  await createMovement(client, {
    kind: 'income',
    amountCents: 200_000,
    accountId: account.id,
    categoryId: income.id,
    bookedOn: '2026-10-01',
  });
  const spent = await createMovement(client, {
    amountCents: 20_000,
    accountId: account.id,
    categoryId: expense.id,
    bookedOn: '2026-10-05',
  });
  await client.post('/api/v1/transfers', {
    fromAccountId: other.id,
    toAccountId: account.id,
    amountCents: 5_000,
    bookedOn: '2026-10-08',
  });
  await createMovement(client, {
    amountCents: 9_999,
    accountId: account.id,
    categoryId: expense.id,
    bookedOn: '2026-10-20',
  });
  return { account, other, expense, income, spent };
}

const COMPUTED_ON_15TH = 285_000;

function reconcile(client: TestClient, account: Created, overrides: Record<string, unknown> = {}) {
  return client.post(`/api/v1/accounts/${account.id}/reconciliations`, {
    month: '2026-10',
    asOf: '2026-10-15',
    statementBalanceCents: COMPUTED_ON_15TH,
    ...overrides,
  });
}

async function history(client: TestClient, account: Created): Promise<ReconciliationResponse[]> {
  const res = await client.get(`/api/v1/accounts/${account.id}/reconciliations`);
  expect(res.status).toBe(200);
  return (res.body as { items: ReconciliationResponse[] }).items;
}

/** Saldo que calcula el libro (las funciones puras sobre las filas reales) hasta una fecha. */
async function balanceOn(account: Created, asOf: string): Promise<number> {
  const repo = new LedgerRepository(getCtx().database.db);
  const record = await repo.findAccount(account.id);
  if (record === undefined) throw new Error('cuenta no encontrada');
  return balanceAsOf(await repo.loadLedger(record), asOf);
}

describe('conciliar', () => {
  it('diferencia 0: no crea ajuste', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const res = await reconcile(client, account);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String) as string,
      computedBalanceCents: COMPUTED_ON_15TH,
      differenceCents: 0,
    });
    const adjustments = await client.get('/api/v1/movements?source=reconciliation');
    expect((adjustments.body as { items: unknown[] }).items).toEqual([]);
  });

  it('diferencia positiva: crea un ingreso de ajuste y el saldo pasa a ser el del banco', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const res = await reconcile(client, account, { statementBalanceCents: 285_250 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ computedBalanceCents: 285_000, differenceCents: 250 });

    const adjustment = await client.get(
      `/api/v1/movements/${(res.body as { adjustmentMovementId: string }).adjustmentMovementId}`,
    );
    expect(adjustment.body).toMatchObject({
      kind: 'income',
      amountCents: 250,
      bookedOn: '2026-10-15',
      source: 'reconciliation',
      status: 'confirmed',
      categoryId: null,
      accountId: account.id,
      description: 'Ajuste de conciliación',
    });
    expect(await balanceOn(account, '2026-10-15')).toBe(285_250);
  });

  it('diferencia negativa: crea un gasto de ajuste y el saldo pasa a ser el del banco', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const res = await reconcile(client, account, { statementBalanceCents: 284_100 });
    expect(res.body).toMatchObject({ differenceCents: -900 });
    const adjustment = await client.get(
      `/api/v1/movements/${(res.body as { adjustmentMovementId: string }).adjustmentMovementId}`,
    );
    expect(adjustment.body).toMatchObject({ kind: 'expense', amountCents: 900 });
    expect(await balanceOn(account, '2026-10-15')).toBe(284_100);
  });

  it('el saldo del banco puede ser negativo', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const res = await reconcile(client, account, { statementBalanceCents: -1_000 });
    expect(res.status).toBe(201);
    expect(await balanceOn(account, '2026-10-15')).toBe(-1_000);
  });

  it('el historial muestra el registro y, sin cambios posteriores, ninguna discrepancia', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const created = await reconcile(client, account, {
      statementBalanceCents: 285_250,
      note: 'Extracto de octubre',
    });
    const [entry, ...rest] = await history(client, account);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      id: (created.body as { id: string }).id,
      accountId: account.id,
      month: '2026-10',
      asOf: '2026-10-15',
      statementBalanceCents: 285_250,
      computedBalanceCents: 285_000,
      note: 'Extracto de octubre',
      adjustmentMovementId: (created.body as { adjustmentMovementId: string }).adjustmentMovementId,
      discrepancy: { currentBalanceCents: 285_250, differenceCents: 0, hasDiscrepancy: false },
    });
  });

  it('no puede haber dos por cuenta y mes (409), pero sí en otro mes u otra cuenta', async () => {
    const client = await getCtx().loggedIn();
    const { account, other } = await setup(client);
    await reconcile(client, account, { statementBalanceCents: 285_250 });
    expectProblem(await reconcile(client, account, { asOf: '2026-10-31' }), 409, 'CONFLICT');
    // El intento fallido no deja un segundo ajuste.
    const adjustments = await client.get('/api/v1/movements?source=reconciliation');
    expect((adjustments.body as { items: unknown[] }).items).toHaveLength(1);

    expect(
      (
        await reconcile(client, account, {
          month: '2026-11',
          asOf: '2026-11-02',
          statementBalanceCents: 285_250,
        })
      ).status,
    ).toBe(201);
    expect((await reconcile(client, other, { statementBalanceCents: -5_000 })).status).toBe(201);
  });

  it.each([
    ['asOf fuera del mes', { asOf: '2026-11-01' }],
    ['mes mal formado', { month: '2026-13' }],
    ['mes con día', { month: '2026-10-01' }],
    ['fecha imposible', { asOf: '2026-10-32' }],
    ['saldo decimal', { statementBalanceCents: 10.5 }],
    ['campo desconocido', { computedBalanceCents: 1 }],
  ])('rechaza con 400: %s', async (_label, override) => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    expectProblem(await reconcile(client, account, override), 400, 'VALIDATION_ERROR');
  });

  it('anterior a la apertura de la cuenta: 422', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client, { openingDate: '2026-10-10' });
    const res = await reconcile(client, account, { asOf: '2026-10-09' });
    expectProblem(res, 422, 'UNPROCESSABLE');
    expect(res.body).toMatchObject({ errors: [{ path: 'asOf' }] });
    // El mismo día de la apertura sí: el saldo de apertura es el del inicio de ese día.
    const ok = await reconcile(client, account, {
      asOf: '2026-10-10',
      statementBalanceCents: 100_000,
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ computedBalanceCents: 100_000, differenceCents: 0 });
  });

  it('mes que empieza antes de la apertura pero con asOf posterior: vale', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client, { openingDate: '2026-10-10' });
    expect(
      (await reconcile(client, account, { asOf: '2026-10-20', statementBalanceCents: 99_000 }))
        .status,
    ).toBe(201);
  });

  it('cuenta archivada: 409; cuenta inexistente: 404', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    await archiveEmptied(client, getCtx().database.db, account);
    expectProblem(await reconcile(client, account), 409, 'CONFLICT');
    expectProblem(await reconcile(client, { id: MISSING }), 404, 'NOT_FOUND');
    expectProblem(
      await client.get(`/api/v1/accounts/${MISSING}/reconciliations`),
      404,
      'NOT_FOUND',
    );
  });
});

describe('borrar la conciliación', () => {
  it('borra el ajuste y el saldo vuelve al calculado; se puede rehacer', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const created = await reconcile(client, account, { statementBalanceCents: 285_250 });
    const { id, adjustmentMovementId } = created.body as {
      id: string;
      adjustmentMovementId: string;
    };

    expect((await client.delete(`/api/v1/reconciliations/${id}`)).status).toBe(204);
    expectProblem(await client.get(`/api/v1/movements/${adjustmentMovementId}`), 404, 'NOT_FOUND');
    expect(await balanceOn(account, '2026-10-15')).toBe(COMPUTED_ON_15TH);
    expect(await history(client, account)).toEqual([]);
    expect((await reconcile(client, account, { statementBalanceCents: 285_250 })).status).toBe(201);
  });

  it('borrar una sin ajuste, una inexistente y la de una cuenta archivada', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const created = await reconcile(client, account);
    const { id } = created.body as { id: string };
    expectProblem(await client.delete(`/api/v1/reconciliations/${MISSING}`), 404, 'NOT_FOUND');

    await archiveEmptied(client, getCtx().database.db, account);
    expectProblem(await client.delete(`/api/v1/reconciliations/${id}`), 409, 'CONFLICT');
  });
});

describe('discrepancias posteriores', () => {
  it('un movimiento editado después produce un aviso', async () => {
    const client = await getCtx().loggedIn();
    const { account, spent } = await setup(client);
    await reconcile(client, account, { statementBalanceCents: 285_250 });

    // El gasto del día 5 pasa de 200,00 a 180,00: el saldo calculado sube 20,00.
    expect(
      (await client.patch(`/api/v1/movements/${spent.id}`, { amountCents: 18_000 })).status,
    ).toBe(200);
    const [entry] = await history(client, account);
    expect(entry?.discrepancy).toEqual({
      currentBalanceCents: 287_250,
      differenceCents: 2_000,
      hasDiscrepancy: true,
    });
    // El registro histórico no cambia.
    expect(entry?.computedBalanceCents).toBe(285_000);
  });

  it('un movimiento borrado o uno posterior a la fecha del saldo', async () => {
    const client = await getCtx().loggedIn();
    const { account, expense, spent } = await setup(client);
    await reconcile(client, account);

    // Posterior al día 15: no afecta.
    await createMovement(client, {
      accountId: account.id,
      categoryId: expense.id,
      bookedOn: '2026-10-16',
      amountCents: 777,
    });
    expect((await history(client, account))[0]?.discrepancy.hasDiscrepancy).toBe(false);

    await client.delete(`/api/v1/movements/${spent.id}`);
    expect((await history(client, account))[0]?.discrepancy).toMatchObject({
      differenceCents: 20_000,
      hasDiscrepancy: true,
    });
  });

  it('una transferencia añadida después también se detecta', async () => {
    const client = await getCtx().loggedIn();
    const { account, other } = await setup(client);
    await reconcile(client, account);
    await client.post('/api/v1/transfers', {
      fromAccountId: account.id,
      toAccountId: other.id,
      amountCents: 1_000,
      bookedOn: '2026-10-12',
    });
    expect((await history(client, account))[0]?.discrepancy).toMatchObject({
      differenceCents: -1_000,
      hasDiscrepancy: true,
    });
  });

  it('conciliar un mes anterior después cambia el saldo del posterior y lo avisa', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    await reconcile(client, account); // octubre, sin ajuste
    // Septiembre: la cuenta no tiene movimientos, así que el calculado es la apertura (1.000,00 €).
    const september = await reconcile(client, account, {
      month: '2026-09',
      asOf: '2026-09-30',
      statementBalanceCents: 100_100,
    });
    expect(september.body).toMatchObject({ computedBalanceCents: 100_000, differenceCents: 100 });

    const entries = await history(client, account);
    expect(entries.map((entry) => entry.month)).toEqual(['2026-10', '2026-09']);
    expect(entries[0]?.discrepancy).toEqual({
      currentBalanceCents: COMPUTED_ON_15TH + 100,
      differenceCents: 100,
      hasDiscrepancy: true,
    });
    expect(entries[1]?.discrepancy.hasDiscrepancy).toBe(false);
  });

  it('el ajuste manipulado directamente en la base de datos se detecta', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const { account } = await setup(client);
    const created = await reconcile(client, account, { statementBalanceCents: 285_250 });
    const adjustmentId = (created.body as { adjustmentMovementId: string }).adjustmentMovementId;

    // La API no permite tocar el ajuste; si alguien lo hace por otra vía, el historial lo delata.
    await ctx.database.db
      .updateTable('movements')
      .set({ amount_cents: 400 })
      .where('id', '=', adjustmentId)
      .execute();
    expect((await history(client, account))[0]?.discrepancy).toMatchObject({
      differenceCents: 150,
      hasDiscrepancy: true,
    });
    const adjustment = (await client.get(`/api/v1/movements/${adjustmentId}`))
      .body as MovementResponse;
    expect(adjustment.amountCents).toBe(400);
  });
});
