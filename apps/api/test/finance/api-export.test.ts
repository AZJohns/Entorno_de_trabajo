/**
 * `GET /export` (S+): contenido completo y exacto, ningún dato de autenticación, cabeceras de descarga,
 * reautenticación obligatoria y constancia en la auditoría.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { exportResponseSchema } from '@backoffice/shared';
import { REAUTH_WINDOW_MS } from '../../src/modules/auth/domain/session-rules.ts';
import { PASSWORD, USERNAME, useAuthTestContext } from '../support/auth.ts';
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
const URL = '/api/v1/export';

/** La auditoría no se puede borrar entre tests: se mira solo lo registrado desde que empezó el test. */
let lastAuditId = 0;

beforeEach(async () => {
  const db = getCtx().database.db;
  await resetLedger(db);
  const last = await db
    .selectFrom('audit_events')
    .select((eb) => eb.fn.max('id').as('id'))
    .executeTakeFirst();
  lastAuditId = Number(last?.id ?? 0);
});

function exportEvents() {
  return getCtx()
    .database.db.selectFrom('audit_events')
    .selectAll()
    .where('action', '=', 'data.exported')
    .where('id', '>', String(lastAuditId))
    .execute();
}

/** Dos cuentas (una archivada), categorías, movimientos (uno pendiente), una transferencia y una conciliación. */
async function populate(client: TestClient) {
  const a = await createAccount(client, { name: 'A' });
  const b = await createAccount(client, { name: 'B', openingBalanceCents: 0 });
  const old = await createAccount(client, { name: 'Vieja', openingBalanceCents: 0 });
  const income = await createCategory(client, 'income', { name: 'Sueldo' });
  const expense = await createCategory(client, 'expense', { name: 'Comida' });
  await createMovement(client, {
    kind: 'income',
    amountCents: 200_000,
    accountId: a.id,
    categoryId: income.id,
    bookedOn: '2026-10-01',
  });
  await createMovement(client, {
    amountCents: 1_999,
    accountId: a.id,
    categoryId: expense.id,
    bookedOn: '2026-10-05',
    description: 'Compra ficticia',
  });
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
  const transfer = await client.post('/api/v1/transfers', {
    fromAccountId: a.id,
    toAccountId: b.id,
    amountCents: 30_000,
    bookedOn: '2026-10-20',
    note: 'Ahorro',
  });
  expect(transfer.status).toBe(201);
  const rec = await client.post(`/api/v1/accounts/${a.id}/reconciliations`, {
    month: '2026-10',
    asOf: '2026-10-25',
    statementBalanceCents: 270_500,
  });
  expect(rec.status, JSON.stringify(rec.body)).toBe(201);
  await archiveEmptied(client, getCtx().database.db, old);
  return { a, b, old };
}

describe('GET /export', () => {
  it('exporta todo el libro con el formato del esquema y descarga con nombre generado', async () => {
    const client = await getCtx().loggedIn();
    const { a, old } = await populate(client);
    const res = await client.get(URL);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/u);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="backoffice-export-\d{4}-\d{2}-\d{2}\.json"$/u,
    );
    expect(res.headers['cache-control']).toContain('no-store');

    const file = exportResponseSchema.parse(res.body);
    expect(file.accounts.map((x) => x.name).sort()).toEqual(['A', 'B', 'Vieja']);
    expect(file.accounts.find((x) => x.id === old.id)?.archived).toBe(true);
    expect(file.categories).toHaveLength(2);
    // 2 manuales confirmados, 1 pendiente y el ajuste de la conciliación.
    const kinds = file.movements.map((m) => `${m.source}/${m.status}`).sort();
    expect(kinds).toEqual([
      'manual/confirmed',
      'manual/confirmed',
      'manual/pending',
      'reconciliation/confirmed',
    ]);
    expect(file.movements.find((m) => m.description === 'Compra ficticia')?.amountCents).toBe(
      1_999,
    );
    expect(file.transfers).toHaveLength(1);
    expect(file.transfers.some((t) => t.note === 'Ahorro' && t.fromAccountId === a.id)).toBe(true);
    expect(file.reconciliations).toHaveLength(1);
    expect(file.reconciliations[0]?.adjustmentMovementId).toBe(
      file.movements.find((m) => m.source === 'reconciliation')?.id,
    );
    // Los importes son enteros (céntimos), nunca decimales.
    for (const m of file.movements) expect(Number.isInteger(m.amountCents)).toBe(true);
  });

  it('un libro vacío da un archivo válido con listas vacías', async () => {
    const client = await getCtx().loggedIn();
    const file = exportResponseSchema.parse((await client.get(URL)).body);
    expect(file).toMatchObject({
      accounts: [],
      categories: [],
      movements: [],
      transfers: [],
      reconciliations: [],
    });
  });

  it('no incluye secretos ni datos de autenticación', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await populate(client);
    const res = await client.get(URL);
    const text = JSON.stringify(res.body);

    // Solo estas claves de primer nivel: usuarios, sesiones, tokens y auditoría no existen en el archivo.
    expect(Object.keys(res.body as object).sort()).toEqual([
      'accounts',
      'amountUnit',
      'categories',
      'currency',
      'exportedAt',
      'format',
      'movements',
      'reconciliations',
      'transfers',
      'version',
    ]);
    // Ninguna clave, a ninguna profundidad, de las que guardan credenciales.
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(res.body);
    for (const key of keys) {
      expect(key, key).not.toMatch(
        /password|hash|secret|token|totp|recovery|session|cookie|csrf|user/iu,
      );
    }
    // Ni los valores: usuario, contraseña, TOTP y token CSRF de la sesión de prueba.
    for (const forbidden of [USERNAME, PASSWORD, ctx.totp(), client.csrf ?? '\u0000']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('sin reautenticación reciente: 403 y no sale ningún dato ni se audita', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await populate(client);
    ctx.t.clock.advance(REAUTH_WINDOW_MS);
    const res = await client.get(URL);
    expectProblem(res, 403, 'REAUTH_REQUIRED');
    expect(JSON.stringify(res.body)).not.toContain('Compra ficticia');
    expect(res.headers['content-disposition']).toBeUndefined();
    const audited = await exportEvents();
    expect(audited).toHaveLength(0);
  });

  it('sin sesión: 401', async () => {
    expectProblem(await getCtx().client().get(URL), 401, 'UNAUTHENTICATED');
  });

  it('audita data.exported con recuentos y sin datos', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await populate(client);
    expect((await client.get(URL)).status).toBe(200);
    const events = await exportEvents();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.actor).toMatch(/^user:/u);
    expect(event?.metadata).toEqual({
      counts: { accounts: 3, categories: 2, movements: 4, transfers: 1, reconciliations: 1 },
    });
    expect(JSON.stringify(event)).not.toContain('Compra ficticia');
  });
});
