import { beforeEach, describe, expect, it } from 'vitest';
import type { MovementResponse } from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import type { TestClient } from '../support/client.ts';
import {
  archiveEmptied,
  createAccount,
  createCategory,
  createMovement,
  expectProblem,
  resetLedger,
} from '../support/ledger.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

const MISSING = '00000000-0000-4000-8000-000000000000';

/** Cuenta y categoría de gasto listas para crear movimientos. */
async function setup(client: TestClient, accountOverrides: Record<string, unknown> = {}) {
  const account = await createAccount(client, accountOverrides);
  const category = await createCategory(client, 'expense');
  const income = await createCategory(client, 'income');
  return { account, category, income };
}

/** Inserta un borrador pendiente directamente: lo crea el atajo de la fase 2, no esta API. */
async function seedPending(
  accountId: string | null,
  values: Record<string, unknown> = {},
): Promise<string> {
  const row = await getCtx()
    .database.db.insertInto('movements')
    .values({
      kind: 'expense',
      amount_cents: 0,
      account_id: accountId,
      booked_on: '2026-10-10',
      source: 'manual',
      status: 'pending',
      flags: ['amount_missing'],
      ...values,
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('alta de movimientos', () => {
  it('crea un movimiento manual confirmado y devuelve el DTO', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const res = await client.post('/api/v1/movements', {
      kind: 'expense',
      amountCents: 4_599,
      accountId: account.id,
      categoryId: category.id,
      bookedOn: '2026-10-10',
      description: '  Compra semanal ',
      merchant: '',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'expense',
      amountCents: 4_599,
      accountId: account.id,
      categoryId: category.id,
      bookedOn: '2026-10-10',
      description: 'Compra semanal',
      merchant: null,
      source: 'manual',
      status: 'confirmed',
      reconciliationId: null,
      flags: [],
    });
    expect((res.body as MovementResponse).confirmedAt).not.toBeNull();
  });

  it.each([
    ['importe 0', { amountCents: 0 }],
    ['importe negativo', { amountCents: -5 }],
    ['importe decimal', { amountCents: 10.5 }],
    ['sin categoría', { categoryId: undefined }],
    ['fecha imposible', { bookedOn: '2026-02-30' }],
    ['fecha con hora', { bookedOn: '2026-10-10T10:00:00Z' }],
    ['origen forzado a «reconciliation»', { source: 'reconciliation' }],
    ['estado forzado', { status: 'pending' }],
    ['concepto demasiado largo', { description: 'x'.repeat(501) }],
  ])('rechaza con 400: %s', async (_label, override) => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const res = await client.post('/api/v1/movements', {
      kind: 'expense',
      amountCents: 1_000,
      accountId: account.id,
      categoryId: category.id,
      bookedOn: '2026-10-10',
      ...override,
    });
    expectProblem(res, 400, 'VALIDATION_ERROR');
  });

  describe('referencias inexistentes: 422, nunca 409', () => {
    it('cuenta inexistente', async () => {
      const client = await getCtx().loggedIn();
      const { category } = await setup(client);
      const res = await client.post('/api/v1/movements', {
        kind: 'expense',
        amountCents: 1_000,
        accountId: MISSING,
        categoryId: category.id,
        bookedOn: '2026-10-10',
      });
      expectProblem(res, 422, 'UNPROCESSABLE');
      expect(res.status).not.toBe(409);
      expect(res.body).toMatchObject({ errors: [{ path: 'accountId' }] });
    });

    it('categoría inexistente', async () => {
      const client = await getCtx().loggedIn();
      const { account } = await setup(client);
      const res = await client.post('/api/v1/movements', {
        kind: 'expense',
        amountCents: 1_000,
        accountId: account.id,
        categoryId: MISSING,
        bookedOn: '2026-10-10',
      });
      expectProblem(res, 422, 'UNPROCESSABLE');
      expect(res.body).toMatchObject({ errors: [{ path: 'categoryId' }] });
    });

    it('no se crea nada cuando falla la comprobación', async () => {
      const client = await getCtx().loggedIn();
      const { category } = await setup(client);
      await client.post('/api/v1/movements', {
        kind: 'expense',
        amountCents: 1_000,
        accountId: MISSING,
        categoryId: category.id,
        bookedOn: '2026-10-10',
      });
      expect((await client.get('/api/v1/movements')).body).toMatchObject({ items: [] });
    });
  });

  it('una categoría de ingreso no vale para un gasto, ni al revés (422)', async () => {
    const client = await getCtx().loggedIn();
    const { account, category, income } = await setup(client);
    const base = { amountCents: 1_000, accountId: account.id, bookedOn: '2026-10-10' };
    expectProblem(
      await client.post('/api/v1/movements', { ...base, kind: 'expense', categoryId: income.id }),
      422,
      'UNPROCESSABLE',
    );
    expectProblem(
      await client.post('/api/v1/movements', { ...base, kind: 'income', categoryId: category.id }),
      422,
      'UNPROCESSABLE',
    );
  });

  describe('fecha de apertura (el saldo inicial es el del inicio de ese día)', () => {
    it('rechaza una fecha anterior a la apertura (422)', async () => {
      const client = await getCtx().loggedIn();
      const { account, category } = await setup(client, { openingDate: '2026-06-01' });
      const res = await client.post('/api/v1/movements', {
        kind: 'expense',
        amountCents: 1_000,
        accountId: account.id,
        categoryId: category.id,
        bookedOn: '2026-05-31',
      });
      expectProblem(res, 422, 'UNPROCESSABLE');
      expect(res.body).toMatchObject({ errors: [{ path: 'bookedOn' }] });
    });

    it('admite el mismo día de la apertura', async () => {
      const client = await getCtx().loggedIn();
      const { account, category } = await setup(client, { openingDate: '2026-06-01' });
      await createMovement(client, {
        accountId: account.id,
        categoryId: category.id,
        bookedOn: '2026-06-01',
      });
    });

    it('al editar la fecha o cambiar de cuenta también se comprueba', async () => {
      const client = await getCtx().loggedIn();
      const { account, category } = await setup(client, { openingDate: '2026-06-01' });
      const later = await createAccount(client, { openingDate: '2026-09-01' });
      const movement = await createMovement(client, {
        accountId: account.id,
        categoryId: category.id,
        bookedOn: '2026-07-01',
      });
      expectProblem(
        await client.patch(`/api/v1/movements/${movement.id}`, { bookedOn: '2026-05-31' }),
        422,
        'UNPROCESSABLE',
      );
      // Cambiarlo a una cuenta abierta después de su fecha.
      expectProblem(
        await client.patch(`/api/v1/movements/${movement.id}`, { accountId: later.id }),
        422,
        'UNPROCESSABLE',
      );
    });
  });

  describe('cuentas y categorías archivadas', () => {
    it('no admiten movimientos nuevos (409)', async () => {
      const client = await getCtx().loggedIn();
      const { account, category } = await setup(client);
      await archiveEmptied(client, getCtx().database.db, account);
      expectProblem(
        await client.post('/api/v1/movements', {
          kind: 'expense',
          amountCents: 1_000,
          accountId: account.id,
          categoryId: category.id,
          bookedOn: '2026-10-10',
        }),
        409,
        'CONFLICT',
      );

      const other = await createAccount(client);
      await client.post(`/api/v1/categories/${category.id}/archive`);
      expectProblem(
        await client.post('/api/v1/movements', {
          kind: 'expense',
          amountCents: 1_000,
          accountId: other.id,
          categoryId: category.id,
          bookedOn: '2026-10-10',
        }),
        409,
        'CONFLICT',
      );
    });

    it('los movimientos de una cuenta archivada no se editan ni se borran (409)', async () => {
      const client = await getCtx().loggedIn();
      const { account, category } = await setup(client);
      const movement = await createMovement(client, {
        accountId: account.id,
        categoryId: category.id,
      });
      await archiveEmptied(client, getCtx().database.db, account);
      expectProblem(
        await client.patch(`/api/v1/movements/${movement.id}`, { amountCents: 1 }),
        409,
        'CONFLICT',
      );
      expectProblem(await client.delete(`/api/v1/movements/${movement.id}`), 409, 'CONFLICT');
      // Se pueden seguir consultando.
      expect((await client.get(`/api/v1/movements/${movement.id}`)).status).toBe(200);
    });

    it('un movimiento antiguo conserva su categoría archivada al editarlo', async () => {
      const client = await getCtx().loggedIn();
      const { account, category } = await setup(client);
      const movement = await createMovement(client, {
        accountId: account.id,
        categoryId: category.id,
      });
      await client.post(`/api/v1/categories/${category.id}/archive`);
      const res = await client.patch(`/api/v1/movements/${movement.id}`, { amountCents: 2_000 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ amountCents: 2_000, categoryId: category.id });
    });
  });
});

describe('edición y borrado', () => {
  it('PATCH cambia solo lo enviado; null borra un texto', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const movement = await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
      description: 'Café',
      merchant: 'Bar',
    });
    const res = await client.patch(`/api/v1/movements/${movement.id}`, {
      amountCents: 1_999,
      description: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      amountCents: 1_999,
      description: null,
      merchant: 'Bar',
      bookedOn: '2026-10-10',
    });
  });

  it('cambiar el tipo sin cambiar la categoría da 422; con una categoría del nuevo tipo, 200', async () => {
    const client = await getCtx().loggedIn();
    const { account, category, income } = await setup(client);
    const movement = await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
    });
    expectProblem(
      await client.patch(`/api/v1/movements/${movement.id}`, { kind: 'income' }),
      422,
      'UNPROCESSABLE',
    );
    const res = await client.patch(`/api/v1/movements/${movement.id}`, {
      kind: 'income',
      categoryId: income.id,
    });
    expect(res.body).toMatchObject({ kind: 'income', categoryId: income.id });
  });

  it('un movimiento confirmado no puede quedar incompleto', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const movement = await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
    });
    expectProblem(
      await client.patch(`/api/v1/movements/${movement.id}`, { amountCents: 0 }),
      422,
      'UNPROCESSABLE',
    );
    expectProblem(
      await client.patch(`/api/v1/movements/${movement.id}`, { categoryId: null }),
      422,
      'UNPROCESSABLE',
    );
  });

  it('rechaza un cuerpo vacío, campos desconocidos y movimientos inexistentes', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const movement = await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
    });
    expectProblem(
      await client.patch(`/api/v1/movements/${movement.id}`, {}),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.patch(`/api/v1/movements/${movement.id}`, { source: 'reconciliation' }),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.patch(`/api/v1/movements/${MISSING}`, { amountCents: 1 }),
      404,
      'NOT_FOUND',
    );
  });

  it('DELETE borra (204) y después el movimiento no existe (404)', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const movement = await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
    });
    expect((await client.delete(`/api/v1/movements/${movement.id}`)).status).toBe(204);
    expectProblem(await client.get(`/api/v1/movements/${movement.id}`), 404, 'NOT_FOUND');
    expectProblem(await client.delete(`/api/v1/movements/${movement.id}`), 404, 'NOT_FOUND');
  });
});

describe('ajustes de conciliación', () => {
  /** Concilia con una diferencia de +2,50 € y devuelve el id del ajuste y el de la conciliación. */
  async function reconcileWithAdjustment(client: TestClient, accountId: string) {
    const res = await client.post(`/api/v1/accounts/${accountId}/reconciliations`, {
      month: '2026-10',
      asOf: '2026-10-15',
      statementBalanceCents: 100_250,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as { id: string; adjustmentMovementId: string };
    return { reconciliationId: body.id, adjustmentId: body.adjustmentMovementId };
  }

  it('no se editan, ni se borran, ni se confirman por la API', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const { adjustmentId } = await reconcileWithAdjustment(client, account.id);

    expectProblem(
      await client.patch(`/api/v1/movements/${adjustmentId}`, { amountCents: 1 }),
      409,
      'CONFLICT',
    );
    expectProblem(await client.delete(`/api/v1/movements/${adjustmentId}`), 409, 'CONFLICT');
    expectProblem(await client.post(`/api/v1/movements/${adjustmentId}/confirm`), 409, 'CONFLICT');

    // Siguen intactos.
    const res = await client.get(`/api/v1/movements/${adjustmentId}`);
    expect(res.body).toMatchObject({
      kind: 'income',
      amountCents: 250,
      source: 'reconciliation',
      categoryId: null,
      status: 'confirmed',
    });
  });

  it('solo desaparecen al borrar la conciliación', async () => {
    const client = await getCtx().loggedIn();
    const { account } = await setup(client);
    const { adjustmentId, reconciliationId } = await reconcileWithAdjustment(client, account.id);
    expect((await client.delete(`/api/v1/reconciliations/${reconciliationId}`)).status).toBe(204);
    expectProblem(await client.get(`/api/v1/movements/${adjustmentId}`), 404, 'NOT_FOUND');
  });
});

describe('confirmar borradores', () => {
  it('un borrador incompleto no se confirma (422) y uno completo sí, limpiando las incidencias', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    const draftId = await seedPending(account.id, { flags: ['merchant_missing'] });

    expectProblem(await client.post(`/api/v1/movements/${draftId}/confirm`), 422, 'UNPROCESSABLE');

    const completed = await client.patch(`/api/v1/movements/${draftId}`, {
      amountCents: 3_000,
      categoryId: category.id,
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: 'pending', flags: ['merchant_missing'] });

    const confirmed = await client.post(`/api/v1/movements/${draftId}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', flags: [], amountCents: 3_000 });
    expect((confirmed.body as MovementResponse).confirmedAt).not.toBeNull();

    expectProblem(await client.post(`/api/v1/movements/${draftId}/confirm`), 409, 'CONFLICT');
  });

  it('un borrador sin cuenta no se confirma', async () => {
    const client = await getCtx().loggedIn();
    const { category } = await setup(client);
    const draftId = await seedPending(null, { amount_cents: 500, category_id: category.id });
    expectProblem(await client.post(`/api/v1/movements/${draftId}/confirm`), 422, 'UNPROCESSABLE');
  });

  it('el contador de pendientes cuenta solo los borradores', async () => {
    const client = await getCtx().loggedIn();
    const { account, category } = await setup(client);
    await createMovement(client, { accountId: account.id, categoryId: category.id });
    expect((await client.get('/api/v1/movements/pending/count')).body).toEqual({ count: 0 });
    await seedPending(account.id);
    await seedPending(null);
    expect((await client.get('/api/v1/movements/pending/count')).body).toEqual({ count: 2 });
  });
});

describe('lista de movimientos', () => {
  async function seedList(client: TestClient) {
    const { account, category, income } = await setup(client);
    const other = await createAccount(client);
    const make = (values: Record<string, unknown>) =>
      createMovement(client, { accountId: account.id, categoryId: category.id, ...values });
    const a = await make({
      bookedOn: '2026-10-01',
      description: 'Café con leche',
      amountCents: 100,
    });
    const b = await make({
      bookedOn: '2026-10-02',
      description: 'Pago 100% tarjeta',
      amountCents: 200,
    });
    const c = await make({ bookedOn: '2026-10-03', merchant: 'Cafetería Ñandú', amountCents: 300 });
    const d = await make({ bookedOn: '2026-10-03', description: 'Otro', amountCents: 400 });
    const e = await createMovement(client, {
      kind: 'income',
      accountId: other.id,
      categoryId: income.id,
      bookedOn: '2026-11-01',
      amountCents: 500,
    });
    return { account, other, category, income, a, b, c, d, e };
  }

  const ids = (res: { body: unknown }): string[] =>
    (res.body as { items: { id: string }[] }).items.map((item) => item.id);

  it('ordena de más reciente a más antiguo y filtra', async () => {
    const client = await getCtx().loggedIn();
    const { account, other, category, a, b, c, d, e } = await seedList(client);

    const all = ids(await client.get('/api/v1/movements'));
    expect(all).toHaveLength(5);
    expect(all[0]).toBe(e.id);
    expect(all.at(-1)).toBe(a.id);

    expect(ids(await client.get(`/api/v1/movements?accountId=${other.id}`))).toEqual([e.id]);
    expect(ids(await client.get(`/api/v1/movements?categoryId=${category.id}`))).toHaveLength(4);
    expect(ids(await client.get('/api/v1/movements?kind=income'))).toEqual([e.id]);
    expect(ids(await client.get('/api/v1/movements?from=2026-10-02&to=2026-10-03')).sort()).toEqual(
      [b.id, c.id, d.id].sort(),
    );
    expect(ids(await client.get('/api/v1/movements?status=pending'))).toEqual([]);
    expect(ids(await client.get('/api/v1/movements?source=reconciliation'))).toEqual([]);
    expect(
      ids(await client.get(`/api/v1/movements?source=manual&accountId=${account.id}`)),
    ).toHaveLength(4);
  });

  it('q busca en concepto y comercio sin distinguir acentos ni mayúsculas, y trata % y _ como texto', async () => {
    const client = await getCtx().loggedIn();
    const { a, b, c } = await seedList(client);
    expect(ids(await client.get('/api/v1/movements?q=CAFE')).sort()).toEqual([a.id, c.id].sort());
    expect(ids(await client.get('/api/v1/movements?q=nandu'))).toEqual([c.id]);
    expect(ids(await client.get('/api/v1/movements?q=100%25'))).toEqual([b.id]);
    expect(ids(await client.get('/api/v1/movements?q=%25'))).toEqual([b.id]);
    expect(ids(await client.get('/api/v1/movements?q=_'))).toEqual([]);
  });

  it('pagina con cursor sin repetir ni saltarse ninguno', async () => {
    const client = await getCtx().loggedIn();
    await seedList(client);
    const everything = ids(await client.get('/api/v1/movements?limit=100'));

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/v1/movements?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const res = await client.get(url);
      const body = res.body as { items: { id: string }[]; nextCursor: string | null };
      collected.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(collected).toEqual(everything);
    expect(new Set(collected).size).toBe(5);
  });

  it.each([
    ['cursor mal formado', 'cursor=cualquier-cosa'],
    ['parámetro desconocido', 'foo=1'],
    ['rango de fechas invertido', 'from=2026-10-05&to=2026-10-01'],
    ['límite excesivo', 'limit=101'],
    ['estado desconocido', 'status=borrado'],
  ])('rechaza con 400: %s', async (_label, query) => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(`/api/v1/movements?${query}`), 400, 'VALIDATION_ERROR');
  });
});
