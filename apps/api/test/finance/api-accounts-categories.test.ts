import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthTestContext } from '../support/auth.ts';
import {
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

describe('cuentas', () => {
  it('crea una cuenta y devuelve solo los campos del DTO', async () => {
    const client = await getCtx().loggedIn();
    const res = await client.post('/api/v1/accounts', {
      name: '  Nómina  ',
      type: 'checking',
      openingBalanceCents: 123_456,
      openingDate: '2026-01-01',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/u) as string,
      name: 'Nómina',
      type: 'checking',
      currency: 'EUR',
      openingBalanceCents: 123_456,
      openingDate: '2026-01-01',
      archived: false,
    });
  });

  it('el saldo inicial puede ser negativo y por defecto es 0', async () => {
    const client = await getCtx().loggedIn();
    const negative = await createAccount(client, { openingBalanceCents: -5_000 });
    expect(negative['openingBalanceCents']).toBe(-5_000);
    const res = await client.post('/api/v1/accounts', {
      name: 'Efectivo',
      type: 'cash',
      openingDate: '2026-01-01',
    });
    expect(res.body).toMatchObject({ openingBalanceCents: 0 });
  });

  it.each([
    ['campo desconocido', { archived: true }],
    ['tipo inválido', { type: 'credit' }],
    ['nombre vacío', { name: '   ' }],
    ['nombre demasiado largo', { name: 'x'.repeat(101) }],
    ['fecha imposible', { openingDate: '2026-02-30' }],
    ['importe decimal', { openingBalanceCents: 12.5 }],
    ['importe como texto', { openingBalanceCents: '100' }],
    ['importe fuera del rango seguro', { openingBalanceCents: Number.MAX_SAFE_INTEGER + 2 }],
  ])('rechaza con 400: %s', async (_label, override) => {
    const client = await getCtx().loggedIn();
    const res = await client.post('/api/v1/accounts', {
      name: 'Cuenta',
      type: 'checking',
      openingBalanceCents: 0,
      openingDate: '2026-01-01',
      ...override,
    });
    expectProblem(res, 400, 'VALIDATION_ERROR');
  });

  it('el nombre es único entre las activas, sin distinguir mayúsculas', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client, { name: 'Ahorro' });
    expectProblem(
      await client.post('/api/v1/accounts', {
        name: 'AHORRO',
        type: 'savings',
        openingDate: '2026-01-01',
      }),
      409,
      'CONFLICT',
    );
    // Archivada, el nombre se puede reutilizar.
    await client.post(`/api/v1/accounts/${account.id}/archive`);
    await createAccount(client, { name: 'Ahorro' });
  });

  it('lista sin las archivadas salvo que se pida', async () => {
    const client = await getCtx().loggedIn();
    const active = await createAccount(client);
    const archived = await createAccount(client);
    await client.post(`/api/v1/accounts/${archived.id}/archive`);

    const ids = (res: { body: unknown }): string[] =>
      (res.body as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids(await client.get('/api/v1/accounts'))).toEqual([active.id]);
    expect(ids(await client.get('/api/v1/accounts?includeArchived=true')).sort()).toEqual(
      [active.id, archived.id].sort(),
    );
    expectProblem(
      await client.get('/api/v1/accounts?includeArchived=quizá'),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('GET: 404 si no existe y 400 si el identificador no es un UUID', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.get('/api/v1/accounts/00000000-0000-4000-8000-000000000000'),
      404,
      'NOT_FOUND',
    );
    expectProblem(await client.get('/api/v1/accounts/no-es-un-uuid'), 400, 'VALIDATION_ERROR');
  });

  it('PATCH cambia solo lo enviado y rechaza un cuerpo vacío', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client, { name: 'Vieja' });
    const res = await client.patch(`/api/v1/accounts/${account.id}`, {
      name: 'Nueva',
      openingBalanceCents: 7_000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Nueva',
      openingBalanceCents: 7_000,
      type: 'checking',
      openingDate: '2026-01-01',
    });
    expectProblem(
      await client.patch(`/api/v1/accounts/${account.id}`, {}),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('una cuenta archivada no se edita', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    await client.post(`/api/v1/accounts/${account.id}/archive`);
    expectProblem(
      await client.patch(`/api/v1/accounts/${account.id}`, { name: 'Otro' }),
      409,
      'CONFLICT',
    );
  });

  it('no se puede adelantar la apertura por encima de la actividad existente', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    const category = await createCategory(client);
    await createMovement(client, {
      accountId: account.id,
      categoryId: category.id,
      bookedOn: '2026-03-15',
    });

    const tooLate = await client.patch(`/api/v1/accounts/${account.id}`, {
      openingDate: '2026-03-16',
    });
    expectProblem(tooLate, 422, 'UNPROCESSABLE');
    // El mismo día del primer movimiento sí vale: el saldo de apertura es el del inicio de ese día.
    expect(
      (await client.patch(`/api/v1/accounts/${account.id}`, { openingDate: '2026-03-15' })).status,
    ).toBe(200);
    // Y retrasarla (antes de la actividad) siempre vale.
    expect(
      (await client.patch(`/api/v1/accounts/${account.id}`, { openingDate: '2025-12-31' })).status,
    ).toBe(200);
  });

  it('archivar: 409 con movimientos pendientes; después, idempotente', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const account = await createAccount(client);
    const pending = await ctx.database.db
      .insertInto('movements')
      .values({
        kind: 'expense',
        amount_cents: 0,
        account_id: account.id,
        booked_on: '2026-10-10',
        source: 'manual',
        status: 'pending',
        confirmed_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    expectProblem(await client.post(`/api/v1/accounts/${account.id}/archive`), 409, 'CONFLICT');

    await ctx.database.db.deleteFrom('movements').where('id', '=', pending.id).execute();
    const first = await client.post(`/api/v1/accounts/${account.id}/archive`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ archived: true });
    expect((await client.post(`/api/v1/accounts/${account.id}/archive`)).status).toBe(200);
    expectProblem(
      await client.post('/api/v1/accounts/00000000-0000-4000-8000-000000000000/archive'),
      404,
      'NOT_FOUND',
    );
  });
});

describe('categorías', () => {
  it('crea, lista y renombra', async () => {
    const client = await getCtx().loggedIn();
    const category = await createCategory(client, 'expense', { name: 'Comida' });
    expect(category).toMatchObject({ name: 'Comida', kind: 'expense', archived: false });

    const renamed = await client.patch(`/api/v1/categories/${category.id}`, {
      name: 'Alimentación',
    });
    expect(renamed.body).toMatchObject({ name: 'Alimentación', kind: 'expense' });
    const list = await client.get('/api/v1/categories');
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('el tipo no se puede cambiar y los campos desconocidos se rechazan', async () => {
    const client = await getCtx().loggedIn();
    const category = await createCategory(client);
    expectProblem(
      await client.patch(`/api/v1/categories/${category.id}`, { name: 'X', kind: 'income' }),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.post('/api/v1/categories', { name: 'X', kind: 'transfer' }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('el nombre es único por tipo, pero puede repetirse en el otro tipo', async () => {
    const client = await getCtx().loggedIn();
    await createCategory(client, 'expense', { name: 'Varios' });
    expectProblem(
      await client.post('/api/v1/categories', { name: 'varios', kind: 'expense' }),
      409,
      'CONFLICT',
    );
    await createCategory(client, 'income', { name: 'Varios' });
  });

  it('renombrar a un nombre ya usado da 409', async () => {
    const client = await getCtx().loggedIn();
    await createCategory(client, 'expense', { name: 'Ocio' });
    const other = await createCategory(client, 'expense', { name: 'Viajes' });
    expectProblem(
      await client.patch(`/api/v1/categories/${other.id}`, { name: 'OCIO' }),
      409,
      'CONFLICT',
    );
  });

  it('archivar es idempotente, oculta la categoría de la lista y bloquea su edición', async () => {
    const client = await getCtx().loggedIn();
    const category = await createCategory(client);
    expect((await client.post(`/api/v1/categories/${category.id}/archive`)).status).toBe(200);
    expect((await client.post(`/api/v1/categories/${category.id}/archive`)).status).toBe(200);
    expect((await client.get('/api/v1/categories')).body).toEqual({ items: [] });
    expect(
      ((await client.get('/api/v1/categories?includeArchived=true')).body as { items: unknown[] })
        .items,
    ).toHaveLength(1);
    expectProblem(
      await client.patch(`/api/v1/categories/${category.id}`, { name: 'Nueva' }),
      409,
      'CONFLICT',
    );
    expectProblem(
      await client.patch('/api/v1/categories/00000000-0000-4000-8000-000000000000', { name: 'X' }),
      404,
      'NOT_FOUND',
    );
  });
});
