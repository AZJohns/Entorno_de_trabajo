/**
 * Proyección del plan con meses pasados y mes en curso (`GET /plan/months/:month/projection`, fase 3b.2 PR 2):
 * el flujo real sale del libro (ingresos − gastos confirmados, sin pendientes, transferencias ni ajustes de
 * conciliación), el mes en curso se decide en Europe/Madrid con el reloj inyectado y un fallo del cálculo no
 * filtra datos de la foto. Datos y archivos FICTICIOS; la foto es `plan-ficticio-v2.xlsx` (mes 2026-11).
 *
 * Valores de referencia de la fixture (plan-ficticio-v2.expected.md): flujo del plan 137.500 céntimos al mes,
 * 45.000 de eventos en 2027-02 y 2027-08, 9.000 en 2026-11 y saldo inicial 650.000.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { planDashboardResponseSchema, planProjectionResponseSchema } from '@backoffice/shared';
import { useAuthTestContext, type AuthTestContext } from '../support/auth.ts';
import { resetImports } from '../support/imports.ts';
import { createAccount, createCategory, createMovement, expectProblem } from '../support/ledger.ts';
import { MONTH, importFixturePlan, monthUrl } from '../support/plan.ts';
import type { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetImports(getCtx().database.db);
});

/** Lleva el reloj simulado a ese instante (antes de iniciar sesión: una sesión no sobrevive a meses). */
function setClock(ctx: AuthTestContext, instant: string): void {
  ctx.t.clock.advance(new Date(instant).getTime() - ctx.t.clock.now().getTime());
}

async function projectionOf(client: TestClient) {
  const res = await client.get(monthUrl(MONTH, 'projection'));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return planProjectionResponseSchema.parse(res.body);
}

describe('proyección con meses pasados', () => {
  it('usa el flujo real de los meses pasados con movimientos confirmados y el plan en el resto', async () => {
    const ctx = getCtx();
    // Cuatro meses después del mes de la foto: 2026-11, 2026-12, 2027-01 y 2027-02 son pasados; 2027-03, el actual.
    setClock(ctx, '2027-03-10T12:00:00Z');
    const client = await ctx.loggedIn();
    await importFixturePlan(client);

    const a = await createAccount(client, { name: 'A' });
    const b = await createAccount(client, { name: 'B', openingBalanceCents: 0 });
    const sueldo = await createCategory(client, 'income', { name: 'Sueldo' });
    const comida = await createCategory(client, 'expense', { name: 'Comida' });
    const add = (values: Record<string, unknown>) =>
      createMovement(client, { accountId: a.id, ...values });
    const pending = (kind: 'income' | 'expense', amountCents: number, bookedOn: string) =>
      ctx.database.db
        .insertInto('movements')
        .values({
          kind,
          amount_cents: amountCents,
          account_id: a.id,
          booked_on: bookedOn,
          source: 'manual',
          status: 'pending',
        })
        .execute();

    // 2026-11: ingresos 250.000 y gastos 100.000 confirmados → flujo real 150.000. No cuentan: un
    // pendiente, una transferencia y el ajuste de conciliación (+500).
    await add({
      kind: 'income',
      amountCents: 250_000,
      categoryId: sueldo.id,
      bookedOn: '2026-11-01',
    });
    await add({ amountCents: 100_000, categoryId: comida.id, bookedOn: '2026-11-05' });
    await pending('expense', 70_000, '2026-11-09');
    const transfer = await client.post('/api/v1/transfers', {
      fromAccountId: a.id,
      toAccountId: b.id,
      amountCents: 30_000,
      bookedOn: '2026-11-20',
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
    // Saldo calculado de A el 25/11: 100.000 + 250.000 − 100.000 − 30.000 = 220.000; el banco dice 220.500.
    const novRec = await client.post(`/api/v1/accounts/${a.id}/reconciliations`, {
      month: '2026-11',
      asOf: '2026-11-25',
      statementBalanceCents: 220_500,
    });
    expect(novRec.status, JSON.stringify(novRec.body)).toBe(201);
    expect((novRec.body as { differenceCents: number }).differenceCents).toBe(500);

    // 2026-12: solo un pendiente (grande, para que se note si contara) → sin datos reales.
    await pending('income', 900_000, '2026-12-09');

    // 2027-01: ingresos 40.000 y gastos 40.000 confirmados → suman 0: hay datos y el flujo real es 0.
    await add({
      kind: 'income',
      amountCents: 40_000,
      categoryId: sueldo.id,
      bookedOn: '2027-01-05',
    });
    await add({ amountCents: 40_000, categoryId: comida.id, bookedOn: '2027-01-06' });

    // 2027-02: solo una transferencia y un ajuste de conciliación (+500) → sin datos reales.
    const febTransfer = await client.post('/api/v1/transfers', {
      fromAccountId: a.id,
      toAccountId: b.id,
      amountCents: 1_000,
      bookedOn: '2027-02-10',
    });
    expect(febTransfer.status, JSON.stringify(febTransfer.body)).toBe(201);
    const febRec = await client.post(`/api/v1/accounts/${a.id}/reconciliations`, {
      month: '2027-02',
      asOf: '2027-02-25',
      statementBalanceCents: 220_000,
    });
    expect(febRec.status, JSON.stringify(febRec.body)).toBe(201);
    expect((febRec.body as { differenceCents: number }).differenceCents).toBe(500);

    // 2027-03 (mes en curso): un ingreso confirmado que NO se usa, porque el mes no ha terminado.
    await add({
      kind: 'income',
      amountCents: 5_000,
      categoryId: sueldo.id,
      bookedOn: '2027-03-05',
    });

    const projection = await projectionOf(client);
    expect(projection.currentMonth).toBe('2027-03');
    // [mes, origen, aviso, P_k, flujo, inicial, final]
    expect(
      projection.projection.map((row) => [
        row.month,
        row.source,
        row.warning,
        row.eventsCents,
        row.flowCents,
        row.openingCents,
        row.closingCents,
      ]),
    ).toEqual([
      ['2026-11', 'real', null, 9_000, 150_000, 650_000, 800_000],
      ['2026-12', 'plan', 'NO_REAL_DATA', 0, 137_500, 800_000, 937_500],
      ['2027-01', 'real', null, 0, 0, 937_500, 937_500],
      ['2027-02', 'plan', 'NO_REAL_DATA', 45_000, 92_500, 937_500, 1_030_000],
      ['2027-03', 'plan', null, 0, 137_500, 1_030_000, 1_167_500],
      ['2027-04', 'plan', null, 0, 137_500, 1_167_500, 1_305_000],
      ['2027-05', 'plan', null, 0, 137_500, 1_305_000, 1_442_500],
      ['2027-06', 'plan', null, 0, 137_500, 1_442_500, 1_580_000],
      ['2027-07', 'plan', null, 0, 137_500, 1_580_000, 1_717_500],
      ['2027-08', 'plan', null, 45_000, 92_500, 1_717_500, 1_810_000],
      ['2027-09', 'plan', null, 0, 137_500, 1_810_000, 1_947_500],
      ['2027-10', 'plan', null, 0, 137_500, 1_947_500, 2_085_000],
    ]);
    // La tasa del mes real usa el ingreso del plan como denominador, también con flujo 0.
    expect(projection.projection[0]?.flowRate).toEqual({
      numerator: 150_000,
      denominator: 280_000,
    });
    expect(projection.projection[2]?.flowRate).toEqual({ numerator: 0, denominator: 280_000 });

    // El dashboard sale del mismo cálculo.
    const dashboard = planDashboardResponseSchema.parse(
      (await client.get(monthUrl(MONTH, 'dashboard'))).body,
    );
    expect(dashboard.projection).toEqual(projection.projection);
  });

  it('un mes pasado sin ningún movimiento confirmado sale con el plan y el aviso NO_REAL_DATA', async () => {
    const ctx = getCtx();
    setClock(ctx, '2027-01-20T12:00:00Z');
    const client = await ctx.loggedIn();
    await importFixturePlan(client);
    const { projection } = await projectionOf(client);
    expect(projection.slice(0, 3).map((row) => [row.month, row.source, row.warning])).toEqual([
      ['2026-11', 'plan', 'NO_REAL_DATA'],
      ['2026-12', 'plan', 'NO_REAL_DATA'],
      ['2027-01', 'plan', null],
    ]);
    // Sin datos reales, el flujo y el saldo son los del plan.
    expect(projection[1]).toMatchObject({ flowCents: 137_500, closingCents: 916_000 });
  });

  it('un movimiento confirmado de un mes anterior al de la foto no cambia nada', async () => {
    const ctx = getCtx();
    setClock(ctx, '2026-12-10T12:00:00Z');
    const client = await ctx.loggedIn();
    await importFixturePlan(client);
    const account = await createAccount(client);
    const category = await createCategory(client, 'expense');
    await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
      amountCents: 99_999,
      bookedOn: '2026-10-15',
    });
    const { projection } = await projectionOf(client);
    expect(projection.slice(0, 2).map((row) => [row.month, row.source, row.warning])).toEqual([
      ['2026-11', 'plan', 'NO_REAL_DATA'],
      ['2026-12', 'plan', null],
    ]);
  });
});

describe('mes en curso (Europe/Madrid, con el reloj inyectado)', () => {
  // [instante UTC, mes en curso en Madrid]. Madrid es UTC+1 en invierno y UTC+2 en verano.
  it.each([
    // 30 de noviembre: a las 22:30 UTC son las 23:30 en Madrid; a las 23:30 UTC, ya es diciembre.
    ['2026-11-30T22:30:00Z', '2026-11'],
    ['2026-11-30T23:30:00Z', '2026-12'],
    // 31 de julio (verano, UTC+2): el cambio de mes llega a las 22:00 UTC.
    ['2026-07-31T21:59:00Z', '2026-07'],
    ['2026-07-31T23:30:00Z', '2026-08'],
    // 31 de enero (invierno, UTC+1): llega a las 23:00 UTC.
    ['2026-01-31T22:59:00Z', '2026-01'],
    ['2026-01-31T23:30:00Z', '2026-02'],
    // Fin de año: el servidor (UTC) sigue en 2026 y Madrid ya está en 2027.
    ['2026-12-31T23:30:00Z', '2027-01'],
  ])('a las %s el mes en curso es %s', async (instant, expected) => {
    const ctx = getCtx();
    setClock(ctx, instant);
    const client = await ctx.loggedIn();
    await importFixturePlan(client);
    const dashboard = planDashboardResponseSchema.parse(
      (await client.get(monthUrl(MONTH, 'dashboard'))).body,
    );
    expect(dashboard.currentMonth).toBe(expected);
    // El mes de la foto (2026-11) es pasado solo si ya empezó un mes posterior.
    const first = dashboard.projection[0];
    expect(first?.warning).toBe(expected > MONTH ? 'NO_REAL_DATA' : null);
  });

  it('un gasto confirmado el último día del mes cuenta como flujo real cuando en Madrid ya es el mes siguiente', async () => {
    const ctx = getCtx();
    // En UTC todavía es 30 de noviembre; en Madrid, 1 de diciembre a las 00:30.
    setClock(ctx, '2026-11-30T23:30:00Z');
    const client = await ctx.loggedIn();
    await importFixturePlan(client);
    const account = await createAccount(client);
    const category = await createCategory(client, 'expense');
    await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
      amountCents: 20_000,
      bookedOn: '2026-11-30',
    });
    const { projection } = await projectionOf(client);
    expect(projection[0]).toMatchObject({ source: 'real', warning: null, flowCents: -20_000 });
    expect(projection[0]?.closingCents).toBe(630_000);
  });
});

describe('un cálculo que falla', () => {
  it('responde 500 genérico y no deja datos de la foto en la respuesta ni en el log', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const snapshotId = await importFixturePlan(client);
    // Foto incoherente que el importador no deja pasar: la fila de «Alquiler» (fila 8 de Datos, que una línea
    // de Presupuesto referencia) pasa a estar en meses, sin importe. Las restricciones CHECK lo permiten.
    await ctx.database.db
      .updateTable('plan_items')
      .set({ unit: 'months', amount_cents: null, quantity_hundredths: 600 })
      .where('snapshot_id', '=', snapshotId)
      .where('source_row', '=', 8)
      .execute();
    const rentId = (
      await ctx.database.db
        .selectFrom('plan_items')
        .select('id')
        .where('snapshot_id', '=', snapshotId)
        .where('source_row', '=', 8)
        .executeTakeFirstOrThrow()
    ).id;

    for (const rest of ['budget', 'projection', 'goals', 'scenarios', 'checks', 'dashboard']) {
      const res = await client.get(monthUrl(MONTH, rest));
      expectProblem(res, 500, 'INTERNAL_ERROR');
      const body = JSON.stringify(res.body);
      expect(body, rest).not.toContain('Alquiler');
      expect(body, rest).not.toContain(rentId);
      expect(body, rest).not.toContain(snapshotId);
    }

    // El log registra el fallo con el identificador de la foto y sin su contenido.
    const logs = ctx.t.logs();
    const failures = logs.filter((line) => line['msg'] === 'Error no controlado');
    expect(failures).toHaveLength(6);
    const text = JSON.stringify(logs);
    expect(text).toContain(snapshotId);
    expect(text).not.toContain('Alquiler');
    expect(text).not.toContain(rentId);
    expect(text).not.toContain('no tiene importe');

    // Las entradas se siguen pudiendo leer: el fallo es del cálculo, no de la foto guardada.
    expect((await client.get(monthUrl(MONTH))).status).toBe(200);
  });
});
