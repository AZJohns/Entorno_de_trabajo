/**
 * Utilidades de los tests de la API del libro: sesión completa, datos de prueba mínimos y limpieza
 * entre tests. Todos los nombres e importes son inventados.
 */
import { expect } from 'vitest';
import type { Kysely } from 'kysely';
import { problemDetailsSchema } from '@backoffice/shared';
import type { Database } from '../../src/db/schema.ts';
import { balanceAsOf } from '../../src/modules/finance/ledger/domain/balances.ts';
import { LedgerRepository } from '../../src/modules/finance/ledger/ledger.repository.ts';
import type { TestClient } from './client.ts';

/** Borra los datos del libro (las tablas de autenticación las limpia `useAuthTestContext`). */
export async function resetLedger(db: Kysely<Database>): Promise<void> {
  // La capa del plan referencia categorías (RESTRICT): primero ella. Las fotos arrastran sus filas.
  await db.deleteFrom('plan_category_mappings').execute();
  await db.deleteFrom('plan_snapshots').execute();
  await db.deleteFrom('category_budgets').execute();
  await db.deleteFrom('movements').execute();
  await db.deleteFrom('transfers').execute();
  await db.deleteFrom('account_reconciliations').execute();
  await db.deleteFrom('accounts').execute();
  await db.deleteFrom('categories').execute();
}

export interface Created {
  readonly id: string;
  readonly [key: string]: unknown;
}

let counter = 0;
const unique = (prefix: string): string => `${prefix} ${String(++counter)}`;

function created(res: { status: number; body: unknown }): Created {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Created;
}

/** Crea una cuenta (por defecto, abierta el 1 de enero de 2026 con 1.000,00 €). */
export async function createAccount(
  client: TestClient,
  overrides: Record<string, unknown> = {},
): Promise<Created> {
  return created(
    await client.post('/api/v1/accounts', {
      name: unique('Cuenta'),
      type: 'checking',
      openingBalanceCents: 100_000,
      openingDate: '2026-01-01',
      ...overrides,
    }),
  );
}

export async function createCategory(
  client: TestClient,
  kind: 'income' | 'expense' = 'expense',
  overrides: Record<string, unknown> = {},
): Promise<Created> {
  return created(
    await client.post('/api/v1/categories', { name: unique('Categoría'), kind, ...overrides }),
  );
}

/** Crea un movimiento confirmado. */
export async function createMovement(
  client: TestClient,
  values: Record<string, unknown>,
): Promise<Created> {
  return created(
    await client.post('/api/v1/movements', {
      kind: 'expense',
      amountCents: 1_250,
      bookedOn: '2026-10-10',
      ...values,
    }),
  );
}

/** Código de un error RFC 9457 (comprobando que el cuerpo tiene ese formato). */
export function errorCode(res: { body: unknown }): string {
  return problemDetailsSchema.parse(res.body).code;
}

/** Comprueba estado y código de error de una respuesta. */
export function expectProblem(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(errorCode(res)).toBe(code);
}

/**
 * Archiva una cuenta que tiene actividad: archivar exige saldo 0, así que primero la vacía con una
 * transferencia a (o desde) una cuenta auxiliar. Sirve para probar el «congelado» de las archivadas.
 */
export async function archiveEmptied(
  client: TestClient,
  db: Kysely<Database>,
  account: Created,
): Promise<void> {
  const repo = new LedgerRepository(db);
  const record = await repo.findAccount(account.id);
  if (record === undefined) throw new Error('La cuenta de prueba no existe');
  const balance = balanceAsOf(await repo.loadLedger(record), null);
  if (balance !== 0) {
    const sink = await createAccount(client);
    const res = await client.post('/api/v1/transfers', {
      fromAccountId: balance > 0 ? account.id : sink.id,
      toAccountId: balance > 0 ? sink.id : account.id,
      amountCents: Math.abs(balance),
      bookedOn: '2026-12-31',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const archived = await client.post(`/api/v1/accounts/${account.id}/archive`);
  expect(archived.status, JSON.stringify(archived.body)).toBe(200);
}
