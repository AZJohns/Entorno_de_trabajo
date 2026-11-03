/**
 * Saldo de las cuentas en la API (`balanceCents`): ingresos, gastos, transferencias en los dos
 * sentidos, ajustes de conciliación y pendientes, y que la lista no lance una consulta por cuenta.
 */
import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountResponse } from '@backoffice/shared';
import { LedgerService } from '../../src/modules/finance/ledger/ledger.service.ts';
import { useAuthTestContext } from '../support/auth.ts';
import {
  createAccount,
  createCategory,
  createMovement,
  resetLedger,
  type Created,
} from '../support/ledger.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

describe('balanceCents de las cuentas', () => {
  it('suma confirmados (también futuros), transferencias y ajustes; ignora pendientes', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const a = await createAccount(client, { name: 'A', openingBalanceCents: 100_000 });
    const b = await createAccount(client, { name: 'B', openingBalanceCents: 0 });
    const income = await createCategory(client, 'income');
    const expense = await createCategory(client, 'expense');

    await createMovement(client, {
      kind: 'expense',
      amountCents: 3_500,
      accountId: a.id,
      categoryId: expense.id,
      bookedOn: '2026-10-05',
    });
    // De fecha futura: cuenta igualmente en el saldo actual.
    await createMovement(client, {
      kind: 'income',
      amountCents: 20_000,
      accountId: a.id,
      categoryId: income.id,
      bookedOn: '2099-01-01',
    });
    // Una transferencia en cada sentido.
    await client.post('/api/v1/transfers', {
      fromAccountId: b.id,
      toAccountId: a.id,
      amountCents: 5_000,
      bookedOn: '2026-10-08',
    });
    await client.post('/api/v1/transfers', {
      fromAccountId: a.id,
      toAccountId: b.id,
      amountCents: 1_200,
      bookedOn: '2026-10-09',
    });
    // Un borrador pendiente: no cuenta.
    await ctx.database.db
      .insertInto('movements')
      .values({
        kind: 'expense',
        amount_cents: 9_999,
        account_id: a.id,
        booked_on: '2026-10-10',
        source: 'manual',
        status: 'pending',
        confirmed_at: null,
      })
      .execute();
    // Saldo calculado el 31/10: 100.000 − 3.500 + 5.000 − 1.200 = 100.300. El banco dice 100.000,
    // así que el ajuste es de −300 y cuenta en el saldo actual.
    const reconciled = await client.post(`/api/v1/accounts/${a.id}/reconciliations`, {
      month: '2026-10',
      asOf: '2026-10-31',
      statementBalanceCents: 100_000,
    });
    expect(reconciled.status, JSON.stringify(reconciled.body)).toBe(201);

    // A: 100.300 + 20.000 (futuro) − 300 (ajuste) = 120.000. B: −5.000 + 1.200 = −3.800.
    const list = await client.get('/api/v1/accounts');
    const items = (list.body as { items: AccountResponse[] }).items;
    expect(items.find((item) => item.id === a.id)?.balanceCents).toBe(120_000);
    expect(items.find((item) => item.id === b.id)?.balanceCents).toBe(-3_800);

    // El detalle y las mutaciones devuelven el mismo saldo.
    expect((await client.get(`/api/v1/accounts/${a.id}`)).body).toMatchObject({
      balanceCents: 120_000,
    });
    expect((await client.patch(`/api/v1/accounts/${a.id}`, { name: 'A2' })).body).toMatchObject({
      balanceCents: 120_000,
    });
  });

  it('una cuenta nueva sin actividad tiene como saldo el de apertura', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client, { openingBalanceCents: -2_500 });
    expect(account['balanceCents']).toBe(-2_500);
  });

  it('la lista de cuentas hace las mismas consultas con 1 que con 6 cuentas', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    let queries = 0;
    const counter: KyselyPlugin = {
      transformQuery: (args: PluginTransformQueryArgs) => {
        queries += 1;
        return args.node;
      },
      transformResult: (args: PluginTransformResultArgs) => Promise.resolve(args.result),
    };
    const service = new LedgerService({
      db: ctx.database.db.withPlugin(counter),
      clock: ctx.t.clock,
    });
    const countFor = async (): Promise<number> => {
      queries = 0;
      await service.listAccounts(false);
      return queries;
    };

    const first: Created = await createAccount(client);
    const withOne = await countFor();
    for (let i = 0; i < 5; i += 1) {
      const other = await createAccount(client);
      await client.post('/api/v1/transfers', {
        fromAccountId: first.id,
        toAccountId: other.id,
        amountCents: 100,
        bookedOn: '2026-10-10',
      });
    }
    // Cuentas + movimientos + transferencias, independientemente del número de cuentas.
    expect(withOne).toBe(3);
    expect(await countFor()).toBe(withOne);
  });
});
