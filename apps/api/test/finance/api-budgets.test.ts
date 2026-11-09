/**
 * Presupuesto por categoría y mes en la API (`/budgets`): contra la base de datos real. Cubre el cálculo
 * de lo gastado (mes sin gastos, gastos sin presupuesto, categoría archivada), los códigos de error
 * (400, 404, 409, 422) y la copia del mes anterior sin duplicados. Nombres e importes inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  budgetMonthResponseSchema,
  budgetResponseSchema,
  copyBudgetsResponseSchema,
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
const BASE = '/api/v1/budgets';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

async function addBudget(
  client: TestClient,
  month: string,
  category: Created,
  amountCents: number,
): Promise<Created> {
  const res = await client.post(BASE, { month, categoryId: category.id, amountCents });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return budgetResponseSchema.parse(res.body);
}

async function listMonth(client: TestClient, month: string) {
  const res = await client.get(`${BASE}?month=${month}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return budgetMonthResponseSchema.parse(res.body);
}

async function copyTo(client: TestClient, month: string) {
  const res = await client.post(`${BASE}/copy-previous`, { month });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return copyBudgetsResponseSchema.parse(res.body);
}

const rowCount = async (): Promise<number> =>
  (await getCtx().database.db.selectFrom('category_budgets').select('id').execute()).length;

describe('alta, edición y borrado', () => {
  it('crea un presupuesto y lo devuelve con el mes como YYYY-MM', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client, 'expense', { name: 'Comida' });
    const res = await client.post(BASE, {
      month: '2026-10',
      categoryId: food.id,
      amountCents: 30_000,
    });
    expect(res.status).toBe(201);
    expect(budgetResponseSchema.parse(res.body)).toMatchObject({
      month: '2026-10',
      categoryId: food.id,
      amountCents: 30_000,
    });
  });

  it('PATCH cambia solo el importe', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    const budget = await addBudget(client, '2026-10', food, 30_000);
    const res = await client.patch(`${BASE}/${budget.id}`, { amountCents: 45_000 });
    expect(res.status).toBe(200);
    expect(budgetResponseSchema.parse(res.body)).toMatchObject({
      id: budget.id,
      month: '2026-10',
      categoryId: food.id,
      amountCents: 45_000,
    });
  });

  it('DELETE borra el presupuesto y deja de salir en la lista', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    const budget = await addBudget(client, '2026-10', food, 30_000);
    expect((await client.delete(`${BASE}/${budget.id}`)).status).toBe(204);
    expect((await listMonth(client, '2026-10')).items).toEqual([]);
    expectProblem(await client.delete(`${BASE}/${budget.id}`), 404, 'NOT_FOUND');
  });

  it('un importe que no es un entero positivo, un campo desconocido o un mes mal escrito dan 400', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    const ok = { month: '2026-10', categoryId: food.id, amountCents: 100 };
    for (const bad of [
      { ...ok, amountCents: 0 },
      { ...ok, amountCents: -5 },
      { ...ok, amountCents: 10.5 },
      { ...ok, amountCents: '100' },
      { ...ok, amountCents: Number.MAX_SAFE_INTEGER + 1 },
      { ...ok, extra: true },
      { ...ok, month: '2026-10-01' },
      { ...ok, month: '2026-13' },
      { ...ok, month: '0000-05' },
      { ...ok, categoryId: 'no-es-un-uuid' },
    ]) {
      expectProblem(await client.post(BASE, bad), 400, 'VALIDATION_ERROR');
    }
    expect(await rowCount()).toBe(0);
  });

  it('PATCH no admite cambiar el mes ni la categoría, ni un cuerpo vacío', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    const budget = await addBudget(client, '2026-10', food, 30_000);
    expectProblem(
      await client.patch(`${BASE}/${budget.id}`, { amountCents: 1, month: '2026-11' }),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(await client.patch(`${BASE}/${budget.id}`, {}), 400, 'VALIDATION_ERROR');
    expectProblem(
      await client.patch(`${BASE}/${budget.id}`, { amountCents: 0 }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('una categoría que no existe da 422 (no 404 ni 409)', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.post(BASE, { month: '2026-10', categoryId: MISSING_ID, amountCents: 100 }),
      422,
      'UNPROCESSABLE',
    );
  });

  it('una categoría de ingreso da 422', async () => {
    const client = await getCtx().loggedIn();
    const salary = await createCategory(client, 'income');
    expectProblem(
      await client.post(BASE, { month: '2026-10', categoryId: salary.id, amountCents: 100 }),
      422,
      'UNPROCESSABLE',
    );
    expect(await rowCount()).toBe(0);
  });

  it('un segundo presupuesto de la misma categoría y mes da 409; en otro mes se admite', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    await addBudget(client, '2026-10', food, 30_000);
    expectProblem(
      await client.post(BASE, { month: '2026-10', categoryId: food.id, amountCents: 1 }),
      409,
      'CONFLICT',
    );
    await addBudget(client, '2026-11', food, 30_000);
    expect(await rowCount()).toBe(2);
  });

  it('un presupuesto que no existe da 404 al editarlo o borrarlo; un id mal formado, 400', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.patch(`${BASE}/${MISSING_ID}`, { amountCents: 1 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await client.delete(`${BASE}/${MISSING_ID}`), 404, 'NOT_FOUND');
    expectProblem(await client.patch(`${BASE}/abc`, { amountCents: 1 }), 400, 'VALIDATION_ERROR');
    expectProblem(await client.delete(`${BASE}/abc`), 400, 'VALIDATION_ERROR');
  });

  it('una categoría archivada: no admite presupuestos nuevos ni editar el suyo (409), pero se puede borrar', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    const travel = await createCategory(client);
    const budget = await addBudget(client, '2026-10', food, 30_000);
    expect((await client.post(`/api/v1/categories/${food.id}/archive`)).status).toBe(200);
    expect((await client.post(`/api/v1/categories/${travel.id}/archive`)).status).toBe(200);

    expectProblem(
      await client.post(BASE, { month: '2026-11', categoryId: travel.id, amountCents: 1 }),
      409,
      'CONFLICT',
    );
    expectProblem(await client.patch(`${BASE}/${budget.id}`, { amountCents: 1 }), 409, 'CONFLICT');
    expect((await client.delete(`${BASE}/${budget.id}`)).status).toBe(204);
  });
});

describe('lista del mes con lo gastado', () => {
  it('calcula lo gastado y lo que queda, y deja aparte lo que no tiene presupuesto', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const a = await createAccount(client);
    const b = await createAccount(client);
    const food = await createCategory(client, 'expense', { name: 'Comida' });
    const leisure = await createCategory(client, 'expense', { name: 'Ocio' });
    const home = await createCategory(client, 'expense', { name: 'Casa' });
    const salary = await createCategory(client, 'income', { name: 'Sueldo' });
    await addBudget(client, '2026-10', food, 30_000);
    await addBudget(client, '2026-10', leisure, 5_000);

    const add = (values: Record<string, unknown>) =>
      createMovement(client, { accountId: a.id, ...values });
    await add({ amountCents: 20_000, categoryId: food.id, bookedOn: '2026-10-05' });
    await add({ amountCents: 5_000, categoryId: food.id, bookedOn: '2026-10-31' });
    await add({ amountCents: 6_000, categoryId: leisure.id, bookedOn: '2026-10-07' });
    await add({ amountCents: 1_700, categoryId: home.id, bookedOn: '2026-10-08' });
    // No cuentan: ingreso, gasto de otro mes (por los dos lados), pendiente, transferencia y ajuste.
    await add({
      kind: 'income',
      amountCents: 200_000,
      categoryId: salary.id,
      bookedOn: '2026-10-01',
    });
    await add({ amountCents: 900, categoryId: food.id, bookedOn: '2026-09-30' });
    await add({ amountCents: 800, categoryId: food.id, bookedOn: '2026-11-01' });
    await ctx.database.db
      .insertInto('movements')
      .values({
        kind: 'expense',
        amount_cents: 700,
        account_id: a.id,
        category_id: food.id,
        booked_on: '2026-10-09',
        source: 'manual',
        status: 'pending',
      })
      .execute();
    expect(
      (
        await client.post('/api/v1/transfers', {
          fromAccountId: a.id,
          toAccountId: b.id,
          amountCents: 40_000,
          bookedOn: '2026-10-20',
        })
      ).status,
    ).toBe(201);
    // Saldo calculado de B el 25/10: 100.000 + 40.000 = 140.000; el banco dice 139.000 → ajuste de −10,00 €.
    const reconciliation = await client.post(`/api/v1/accounts/${b.id}/reconciliations`, {
      month: '2026-10',
      asOf: '2026-10-25',
      statementBalanceCents: 139_000,
    });
    expect(reconciliation.status, JSON.stringify(reconciliation.body)).toBe(201);

    const month = await listMonth(client, '2026-10');
    expect(month.month).toBe('2026-10');
    // Ordenado por nombre de categoría.
    expect(month.items.map((item) => item.categoryName)).toEqual(['Comida', 'Ocio']);
    expect(month.items[0]).toMatchObject({
      categoryId: food.id,
      categoryArchived: false,
      amountCents: 30_000,
      spentCents: 25_000,
      remainingCents: 5_000,
    });
    expect(month.items[1]).toMatchObject({
      amountCents: 5_000,
      spentCents: 6_000,
      remainingCents: -1_000,
    });
    expect(month.unbudgeted).toEqual([
      { categoryId: home.id, categoryName: 'Casa', spentCents: 1_700 },
    ]);
    expect(month.totals).toEqual({
      budgetedCents: 35_000,
      spentCents: 31_000,
      remainingCents: 4_000,
      unbudgetedSpentCents: 1_700,
    });
  });

  it('un mes con presupuesto y sin gastos: gastado 0 y queda todo', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    await addBudget(client, '2026-10', food, 30_000);
    const month = await listMonth(client, '2026-10');
    expect(month.items).toHaveLength(1);
    expect(month.items[0]).toMatchObject({ spentCents: 0, remainingCents: 30_000 });
    expect(month.unbudgeted).toEqual([]);
    expect(month.totals).toMatchObject({ spentCents: 0, remainingCents: 30_000 });
  });

  it('un mes sin presupuestos: lista vacía y todo el gasto como «sin presupuesto»', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    const food = await createCategory(client, 'expense', { name: 'Comida' });
    expect(await listMonth(client, '2026-10')).toMatchObject({
      items: [],
      unbudgeted: [],
      totals: { budgetedCents: 0, spentCents: 0, remainingCents: 0, unbudgetedSpentCents: 0 },
    });
    await createMovement(client, {
      accountId: account.id,
      categoryId: food.id,
      amountCents: 1_250,
      bookedOn: '2026-10-10',
    });
    const month = await listMonth(client, '2026-10');
    expect(month.items).toEqual([]);
    expect(month.unbudgeted).toEqual([
      { categoryId: food.id, categoryName: 'Comida', spentCents: 1_250 },
    ]);
  });

  it('una categoría archivada conserva su presupuesto y su gasto, marcada como archivada', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    const old = await createCategory(client, 'expense', { name: 'Gimnasio' });
    const spendOnly = await createCategory(client, 'expense', { name: 'Taxi' });
    await addBudget(client, '2026-10', old, 4_000);
    for (const category of [old, spendOnly]) {
      await createMovement(client, {
        accountId: account.id,
        categoryId: category.id,
        amountCents: 1_500,
        bookedOn: '2026-10-10',
      });
      expect((await client.post(`/api/v1/categories/${category.id}/archive`)).status).toBe(200);
    }
    const month = await listMonth(client, '2026-10');
    expect(month.items).toHaveLength(1);
    expect(month.items[0]).toMatchObject({
      categoryName: 'Gimnasio',
      categoryArchived: true,
      spentCents: 1_500,
      remainingCents: 2_500,
    });
    // Sin presupuesto y archivada: su gasto sigue saliendo, con su nombre.
    expect(month.unbudgeted).toEqual([
      { categoryId: spendOnly.id, categoryName: 'Taxi', spentCents: 1_500 },
    ]);
  });

  it('el mes es obligatorio y debe ser YYYY-MM', async () => {
    const client = await getCtx().loggedIn();
    for (const query of ['', '?month=', '?month=2026-10-01', '?month=2026-13', '?month=0000-05']) {
      expectProblem(await client.get(`${BASE}${query}`), 400, 'VALIDATION_ERROR');
    }
    expectProblem(await client.get(`${BASE}?month=2026-10&extra=1`), 400, 'VALIDATION_ERROR');
  });
});

describe('copiar del mes anterior', () => {
  /** Septiembre: Comida 300,00, Ocio 100,00 y Viajes 50,00 (archivada después). Octubre: Comida 999,00. */
  async function setup(client: TestClient) {
    const food = await createCategory(client, 'expense', { name: 'Comida' });
    const leisure = await createCategory(client, 'expense', { name: 'Ocio' });
    const travel = await createCategory(client, 'expense', { name: 'Viajes' });
    await addBudget(client, '2026-09', food, 30_000);
    await addBudget(client, '2026-09', leisure, 10_000);
    await addBudget(client, '2026-09', travel, 5_000);
    await addBudget(client, '2026-10', food, 99_900);
    expect((await client.post(`/api/v1/categories/${travel.id}/archive`)).status).toBe(200);
    return { food, leisure, travel };
  }

  it('nunca es automática: crear o consultar un mes no copia nada', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    await addBudget(client, '2026-09', food, 30_000);
    expect((await listMonth(client, '2026-10')).items).toEqual([]);
    expect(await rowCount()).toBe(1);
  });

  it('copia lo que falta sin tocar lo que ya había ni las categorías archivadas', async () => {
    const client = await getCtx().loggedIn();
    const { food, leisure } = await setup(client);
    const result = await copyTo(client, '2026-10');
    expect(result).toEqual({
      month: '2026-10',
      sourceMonth: '2026-09',
      copied: 1,
      skippedExisting: 1,
      skippedArchived: 1,
    });
    const october = await listMonth(client, '2026-10');
    expect(october.items.map((item) => [item.categoryId, item.amountCents])).toEqual([
      [food.id, 99_900], // el que ya existía no se sobrescribe
      [leisure.id, 10_000],
    ]);
    // El mes de origen no cambia.
    const september = await listMonth(client, '2026-09');
    expect(september.items.map((item) => item.amountCents).sort((x, y) => x - y)).toEqual([
      5_000, 10_000, 30_000,
    ]);
  });

  it('repetir la copia no duplica nada', async () => {
    const client = await getCtx().loggedIn();
    await setup(client);
    await copyTo(client, '2026-10');
    const again = await copyTo(client, '2026-10');
    expect(again).toMatchObject({ copied: 0, skippedExisting: 2, skippedArchived: 1 });
    expect(await rowCount()).toBe(3 + 1 + 1); // septiembre (3), octubre: el previo y Ocio
  });

  it('dos copias a la vez no duplican ni fallan', async () => {
    const client = await getCtx().loggedIn();
    await setup(client);
    const responses = await Promise.all([
      client.post(`${BASE}/copy-previous`, { month: '2026-10' }),
      client.post(`${BASE}/copy-previous`, { month: '2026-10' }),
    ]);
    for (const res of responses) expect(res.status, JSON.stringify(res.body)).toBe(200);
    const copied = responses.map((res) => copyBudgetsResponseSchema.parse(res.body).copied);
    expect(copied.reduce((total, value) => total + value, 0)).toBe(1);
    expect(await rowCount()).toBe(5);
  });

  it('cruza el cambio de año', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    await addBudget(client, '2026-12', food, 30_000);
    expect(await copyTo(client, '2027-01')).toMatchObject({ sourceMonth: '2026-12', copied: 1 });
    expect((await listMonth(client, '2027-01')).items[0]?.amountCents).toBe(30_000);
  });

  it('si el mes anterior no tiene presupuestos, 200 con todo a cero (no 409) y no crea nada', async () => {
    const client = await getCtx().loggedIn();
    const food = await createCategory(client);
    await addBudget(client, '2026-08', food, 30_000); // dos meses antes: no cuenta
    const res = await client.post(`${BASE}/copy-previous`, { month: '2026-10' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(copyBudgetsResponseSchema.parse(res.body)).toEqual({
      month: '2026-10',
      sourceMonth: '2026-09',
      copied: 0,
      skippedExisting: 0,
      skippedArchived: 0,
    });
    expect(await rowCount()).toBe(1);
  });

  it('antes del año 1 no hay mes anterior: 422; un mes mal escrito, 400', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.post(`${BASE}/copy-previous`, { month: '0001-01' }),
      422,
      'UNPROCESSABLE',
    );
    for (const body of [
      {},
      { month: '2026-13' },
      { month: '2026-10-01' },
      { month: '2026-10', x: 1 },
    ]) {
      expectProblem(await client.post(`${BASE}/copy-previous`, body), 400, 'VALIDATION_ERROR');
    }
  });
});
