/**
 * Informes en la API (`/reports/*`): contra la base de datos, con la conciliación real para generar un
 * ajuste. Los valores se comparan con los de las funciones puras y con las cuentas.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  balanceHistoryResponseSchema,
  balancesReportResponseSchema,
  categoryReportResponseSchema,
  monthlyReportResponseSchema,
} from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import {
  createAccount,
  createCategory,
  createMovement,
  expectProblem,
  resetLedger,
  type Created,
} from '../support/ledger.ts';
import type { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext();
const BASE = '/api/v1/reports';

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

/**
 * Cuenta A (abierta el 1/1/2026 con 1.000,00 €) y cuenta B (abierta el 1/11/2026 con 0). En octubre:
 * sueldo 2.000,00, comida 200,00 y 50,00, ocio 40,00 y otros 10,00; un pendiente de
 * 7,00; una transferencia A→B de 300,00 el 20/10 (cuenta como ingreso/gasto en ningún sitio) y una
 * conciliación el 25/10 que crea un ajuste de +5,00.
 */
async function setup(client: TestClient) {
  const a = await createAccount(client, { name: 'A' });
  const b = await createAccount(client, {
    name: 'B',
    openingBalanceCents: 0,
    openingDate: '2026-11-01',
  });
  const sueldo = await createCategory(client, 'income', { name: 'Sueldo' });
  const comida = await createCategory(client, 'expense', { name: 'Comida' });
  const ocio = await createCategory(client, 'expense', { name: 'Ocio' });
  const otros = await createCategory(client, 'expense', { name: 'Otros' });
  const add = (values: Record<string, unknown>) =>
    createMovement(client, { accountId: a.id, ...values });
  await add({
    kind: 'income',
    amountCents: 200_000,
    categoryId: sueldo.id,
    bookedOn: '2026-10-01',
  });
  await add({ amountCents: 20_000, categoryId: comida.id, bookedOn: '2026-10-05' });
  await add({ amountCents: 5_000, categoryId: comida.id, bookedOn: '2026-10-06' });
  await add({ amountCents: 4_000, categoryId: ocio.id, bookedOn: '2026-10-07' });
  await add({ amountCents: 1_000, categoryId: otros.id, bookedOn: '2026-10-08' });
  // Pendiente: lo crea el atajo en la fase 2; aquí se inserta directamente.
  await getCtx()
    .database.db.insertInto('movements')
    .values({
      kind: 'expense',
      amount_cents: 700,
      account_id: a.id,
      booked_on: '2026-10-09',
      source: 'manual',
      status: 'pending',
    })
    .execute();
  await client.post('/api/v1/transfers', {
    fromAccountId: a.id,
    toAccountId: b.id,
    amountCents: 30_000,
    bookedOn: '2026-11-02',
  });
  // Saldo calculado de A el 25/10: 100.000 + 200.000 − 30.000 (gastos) = 270.000; el banco dice 270.500.
  const rec = await client.post(`/api/v1/accounts/${a.id}/reconciliations`, {
    month: '2026-10',
    asOf: '2026-10-25',
    statementBalanceCents: 270_500,
  });
  expect(rec.status, JSON.stringify(rec.body)).toBe(201);
  return { a, b, sueldo, comida, ocio, otros };
}

describe('GET /reports/monthly', () => {
  it('da ingresos, gastos, neto, ajustes y pendientes por mes, también los vacíos', async () => {
    const client = await getCtx().loggedIn();
    await setup(client);
    const res = await client.get(`${BASE}/monthly?from=2026-09&to=2026-11`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { items } = monthlyReportResponseSchema.parse(res.body);
    expect(items.map((row) => row.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(items[0]).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
      adjustmentsCents: 0,
    });
    expect(items[1]).toEqual({
      month: '2026-10',
      incomeCents: 200_000,
      expenseCents: 30_000,
      netCents: 170_000,
      adjustmentsCents: 500,
      pending: { count: 1, incomeCents: 0, expenseCents: 700 },
    });
    // La transferencia (noviembre) no es ni ingreso ni gasto.
    expect(items[2]).toMatchObject({ incomeCents: 0, expenseCents: 0, netCents: 0 });
  });

  it.each([
    ['sin parámetros', ''],
    ['mes mal escrito', '?from=2026-1&to=2026-10'],
    ['rango invertido', '?from=2026-11&to=2026-10'],
    ['parámetro desconocido', '?from=2026-10&to=2026-10&x=1'],
  ])('400 con %s', async (_name, query) => {
    const client = await getCtx().loggedIn();
    expect((await client.get(`${BASE}/monthly${query}`)).status).toBe(400);
  });

  // ASVS 15.3.7: un parámetro repetido llega como array; Zod espera una cadena y lo rechaza. Es un
  // error de validación (400, como el resto; plan.md §2: 422 es solo para incoherencias con el libro).
  it('rechaza un parámetro repetido (?from=a&from=b) con 400, sin elegir uno de los dos', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.get(`${BASE}/monthly?from=2026-10&from=2026-09&to=2026-10`),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.get('/api/v1/movements?status=pending&status=confirmed'),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('422 si el rango supera 60 meses; 60 meses exactos valen', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.get(`${BASE}/monthly?from=2020-01&to=2025-01`),
      422,
      'UNPROCESSABLE',
    );
    const ok = await client.get(`${BASE}/monthly?from=2021-01&to=2025-12`);
    expect(ok.status).toBe(200);
    expect(monthlyReportResponseSchema.parse(ok.body).items).toHaveLength(60);
  });
});

describe('GET /reports/monthly/:month/categories', () => {
  it('desglosa por categoría con su nombre, sin ajustes ni pendientes', async () => {
    const client = await getCtx().loggedIn();
    const { sueldo, comida, ocio, otros } = await setup(client);
    const res = await client.get(`${BASE}/monthly/2026-10/categories`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = categoryReportResponseSchema.parse(res.body);
    expect(report.month).toBe('2026-10');
    expect(report.items).toEqual([
      { kind: 'income', categoryId: sueldo.id, name: 'Sueldo', totalCents: 200_000 },
      { kind: 'expense', categoryId: comida.id, name: 'Comida', totalCents: 25_000 },
      { kind: 'expense', categoryId: ocio.id, name: 'Ocio', totalCents: 4_000 },
      { kind: 'expense', categoryId: otros.id, name: 'Otros', totalCents: 1_000 },
    ]);
  });

  it('un mes sin movimientos da una lista vacía; un mes mal escrito, 400', async () => {
    const client = await getCtx().loggedIn();
    const empty = await client.get(`${BASE}/monthly/2026-03/categories`);
    expect(empty.body).toEqual({ month: '2026-03', items: [] });
    expect((await client.get(`${BASE}/monthly/2026-13/categories`)).status).toBe(400);
    expect((await client.get(`${BASE}/monthly/octubre/categories`)).status).toBe(400);
  });
});

describe('GET /reports/balances', () => {
  it('saldo por cuenta con el ajuste aparte y el total; coincide con el saldo de la cuenta', async () => {
    const client = await getCtx().loggedIn();
    const { a, b } = await setup(client);
    const res = await client.get(`${BASE}/balances?at=2026-12-31`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = balancesReportResponseSchema.parse(res.body);
    const byId = new Map(report.accounts.map((line) => [line.accountId, line]));
    // A: 100.000 + 200.000 − 30.000 − 30.000 (transferencia) + 500 (ajuste)
    expect(byId.get(a.id)).toMatchObject({ balanceCents: 240_500, adjustmentsCents: 500 });
    expect(byId.get(b.id)).toMatchObject({ balanceCents: 30_000, adjustmentsCents: 0 });
    expect(report.totalCents).toBe(270_500);
    expect(report.totalAdjustmentsCents).toBe(500);
    const account = (await client.get(`/api/v1/accounts/${a.id}`)).body as { balanceCents: number };
    expect(byId.get(a.id)?.balanceCents).toBe(account.balanceCents);
  });

  it('en una fecha anterior no aparece la cuenta aún no abierta y no cuenta lo posterior', async () => {
    const client = await getCtx().loggedIn();
    const { a, b } = await setup(client);
    const report = balancesReportResponseSchema.parse(
      (await client.get(`${BASE}/balances?at=2026-10-24`)).body,
    );
    expect(report.accounts.map((line) => line.accountId)).toEqual([a.id]);
    expect(report.accounts.some((line) => line.accountId === b.id)).toBe(false);
    // Antes del ajuste (25/10): 100.000 + 200.000 − 30.000
    expect(report.accounts[0]).toMatchObject({ balanceCents: 270_000, adjustmentsCents: 0 });
  });

  it('sin «at» o con una fecha imposible: 400', async () => {
    const client = await getCtx().loggedIn();
    expect((await client.get(`${BASE}/balances`)).status).toBe(400);
    expect((await client.get(`${BASE}/balances?at=2026-02-30`)).status).toBe(400);
  });

  it('sin cuentas: lista vacía y total 0', async () => {
    const client = await getCtx().loggedIn();
    const res = await client.get(`${BASE}/balances?at=2026-10-01`);
    expect(res.body).toEqual({
      at: '2026-10-01',
      accounts: [],
      totalCents: 0,
      totalAdjustmentsCents: 0,
    });
  });
});

describe('GET /reports/balance-history', () => {
  it('saldo a fin de cada mes por cuenta, null antes de abrirse, y total', async () => {
    const client = await getCtx().loggedIn();
    const { a, b } = await setup(client);
    const res = await client.get(`${BASE}/balance-history?from=2026-09&to=2026-11`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const history = balanceHistoryResponseSchema.parse(res.body);
    expect(history.months).toEqual(['2026-09', '2026-10', '2026-11']);
    const series = (id: Created['id']) =>
      history.accounts.find((x) => x.accountId === id)?.balancesCents;
    expect(series(a.id)).toEqual([100_000, 270_500, 240_500]);
    expect(series(b.id)).toEqual([null, null, 30_000]);
    expect(history.totalsCents).toEqual([100_000, 270_500, 270_500]);
  });

  it('valida el rango igual que el informe mensual', async () => {
    const client = await getCtx().loggedIn();
    expect((await client.get(`${BASE}/balance-history?from=2026-11&to=2026-10`)).status).toBe(400);
    expectProblem(
      await client.get(`${BASE}/balance-history?from=2020-01&to=2025-01`),
      422,
      'UNPROCESSABLE',
    );
  });
});
