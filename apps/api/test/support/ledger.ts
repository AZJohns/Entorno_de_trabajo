/**
 * Utilidades de los tests de la API del libro: sesión completa, datos de prueba mínimos y limpieza
 * entre tests. Todos los nombres e importes son inventados.
 */
import { expect } from 'vitest';
import type { Kysely } from 'kysely';
import { problemDetailsSchema } from '@backoffice/shared';
import type { Database } from '../../src/db/schema.ts';
import type { TestClient } from './client.ts';

/** Borra los datos del libro (las tablas de autenticación las limpia `useAuthTestContext`). */
export async function resetLedger(db: Kysely<Database>): Promise<void> {
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
