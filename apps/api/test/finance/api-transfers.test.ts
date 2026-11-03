import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthTestContext } from '../support/auth.ts';
import {
  archiveEmptied,
  createAccount,
  expectProblem,
  resetLedger,
  type Created,
} from '../support/ledger.ts';
import type { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

const MISSING = '00000000-0000-4000-8000-000000000000';

async function createTransfer(
  client: TestClient,
  from: Created,
  to: Created,
  overrides: Record<string, unknown> = {},
) {
  return client.post('/api/v1/transfers', {
    fromAccountId: from.id,
    toAccountId: to.id,
    amountCents: 5_000,
    bookedOn: '2026-10-10',
    ...overrides,
  });
}

describe('transferencias', () => {
  it('crea una transferencia entre dos cuentas y devuelve el DTO', async () => {
    const client = await getCtx().loggedIn();
    const [from, to] = [await createAccount(client), await createAccount(client)];
    const res = await createTransfer(client, from, to, { note: 'Ahorro mensual' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents: 5_000,
      bookedOn: '2026-10-10',
      note: 'Ahorro mensual',
    });
  });

  it('no es un movimiento: no aparece en /movements ni cuenta como pendiente', async () => {
    const client = await getCtx().loggedIn();
    const [from, to] = [await createAccount(client), await createAccount(client)];
    await createTransfer(client, from, to);
    expect((await client.get('/api/v1/movements')).body).toEqual({ items: [], nextCursor: null });
    expect((await client.get('/api/v1/movements/pending/count')).body).toEqual({ count: 0 });
  });

  it.each([
    ['importe 0', { amountCents: 0 }],
    ['importe negativo', { amountCents: -1 }],
    ['importe decimal', { amountCents: 1.5 }],
    ['fecha imposible', { bookedOn: '2026-13-01' }],
    ['campo desconocido', { source: 'manual' }],
  ])('rechaza con 400: %s', async (_label, override) => {
    const client = await getCtx().loggedIn();
    const [from, to] = [await createAccount(client), await createAccount(client)];
    expectProblem(await createTransfer(client, from, to, override), 400, 'VALIDATION_ERROR');
  });

  it('origen y destino iguales: 400', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    expectProblem(await createTransfer(client, account, account), 400, 'VALIDATION_ERROR');
  });

  it('una cuenta inexistente da 422, nunca 409', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    const missing = { id: MISSING };
    const toMissing = await createTransfer(client, account, missing);
    expectProblem(toMissing, 422, 'UNPROCESSABLE');
    expect(toMissing.body).toMatchObject({ errors: [{ path: 'toAccountId' }] });
    const fromMissing = await createTransfer(client, missing, account);
    expectProblem(fromMissing, 422, 'UNPROCESSABLE');
    expect(fromMissing.body).toMatchObject({ errors: [{ path: 'fromAccountId' }] });
  });

  it('una fecha anterior a la apertura de cualquiera de las dos cuentas da 422', async () => {
    const client = await getCtx().loggedIn();
    const early = await createAccount(client, { openingDate: '2026-01-01' });
    const late = await createAccount(client, { openingDate: '2026-06-01' });
    expectProblem(
      await createTransfer(client, early, late, { bookedOn: '2026-05-31' }),
      422,
      'UNPROCESSABLE',
    );
    expectProblem(
      await createTransfer(client, late, early, { bookedOn: '2026-05-31' }),
      422,
      'UNPROCESSABLE',
    );
    // El día de la apertura de la más reciente vale.
    expect((await createTransfer(client, early, late, { bookedOn: '2026-06-01' })).status).toBe(
      201,
    );
  });

  it('con una cuenta archivada: 409 al crear, editar y borrar', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = [
      await createAccount(client),
      await createAccount(client),
      await createAccount(client),
    ];
    const existing = (await createTransfer(client, a, b)).body as Created;

    await archiveEmptied(client, getCtx().database.db, b);
    expectProblem(await createTransfer(client, a, b), 409, 'CONFLICT');
    expectProblem(await createTransfer(client, b, a), 409, 'CONFLICT');
    expectProblem(
      await client.patch(`/api/v1/transfers/${existing.id}`, { amountCents: 1 }),
      409,
      'CONFLICT',
    );
    expectProblem(await client.delete(`/api/v1/transfers/${existing.id}`), 409, 'CONFLICT');
    expect((await createTransfer(client, a, c)).status).toBe(201);
  });

  it('PATCH cambia lo enviado y revalida el resultado completo', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = [
      await createAccount(client),
      await createAccount(client),
      await createAccount(client, { openingDate: '2026-11-01' }),
    ];
    const transfer = (await createTransfer(client, a, b)).body as Created;

    const res = await client.patch(`/api/v1/transfers/${transfer.id}`, {
      amountCents: 7_500,
      note: null,
    });
    expect(res.body).toMatchObject({ amountCents: 7_500, note: null, fromAccountId: a.id });

    // Destino igual al origen.
    expectProblem(
      await client.patch(`/api/v1/transfers/${transfer.id}`, { toAccountId: a.id }),
      400,
      'VALIDATION_ERROR',
    );
    // Destino abierto después de la fecha de la transferencia.
    expectProblem(
      await client.patch(`/api/v1/transfers/${transfer.id}`, { toAccountId: c.id }),
      422,
      'UNPROCESSABLE',
    );
    expectProblem(
      await client.patch(`/api/v1/transfers/${transfer.id}`, {}),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.patch(`/api/v1/transfers/${MISSING}`, { amountCents: 1 }),
      404,
      'NOT_FOUND',
    );
  });

  it('DELETE borra (204) y después no existe (404)', async () => {
    const client = await getCtx().loggedIn();
    const [a, b] = [await createAccount(client), await createAccount(client)];
    const transfer = (await createTransfer(client, a, b)).body as Created;
    expect((await client.delete(`/api/v1/transfers/${transfer.id}`)).status).toBe(204);
    expectProblem(await client.get(`/api/v1/transfers/${transfer.id}`), 404, 'NOT_FOUND');
  });

  it('lista con filtros y cursor', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = [
      await createAccount(client),
      await createAccount(client),
      await createAccount(client),
    ];
    const t1 = (await createTransfer(client, a, b, { bookedOn: '2026-10-01' })).body as Created;
    const t2 = (await createTransfer(client, b, c, { bookedOn: '2026-10-02' })).body as Created;
    const t3 = (await createTransfer(client, c, a, { bookedOn: '2026-10-03' })).body as Created;

    const ids = (res: { body: unknown }): string[] =>
      (res.body as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids(await client.get('/api/v1/transfers'))).toEqual([t3.id, t2.id, t1.id]);
    expect(ids(await client.get(`/api/v1/transfers?accountId=${a.id}`))).toEqual([t3.id, t1.id]);
    expect(ids(await client.get('/api/v1/transfers?from=2026-10-02&to=2026-10-02'))).toEqual([
      t2.id,
    ]);

    const first = await client.get('/api/v1/transfers?limit=2');
    const body = first.body as { nextCursor: string };
    expect(ids(first)).toEqual([t3.id, t2.id]);
    expect(ids(await client.get(`/api/v1/transfers?limit=2&cursor=${body.nextCursor}`))).toEqual([
      t1.id,
    ]);
  });
});
