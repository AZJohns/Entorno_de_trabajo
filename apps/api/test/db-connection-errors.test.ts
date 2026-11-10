/**
 * Si PostgreSQL corta una conexión, el proceso no debe caerse: `pg` emite un evento `error` y, sin
 * escuchante, Node lanza la excepción. Se simula con `pg_terminate_backend` desde otra conexión.
 * Si el escuchante faltara, Vitest marcaría la excepción no capturada y el test fallaría.
 */
import { sql, type QueryExecutorProvider } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type ConnectionErrorInfo } from '../src/db/database.ts';
import { createTestDatabase, DB_TIMEOUT_MS, type TestDatabase } from './support/database.ts';

let test: TestDatabase;

beforeAll(async () => {
  test = await createTestDatabase();
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await test.drop();
}, DB_TIMEOUT_MS);

/** Corta desde fuera la conexión del servidor con ese `pid`. */
async function terminateBackend(pid: number): Promise<void> {
  const admin = new pg.Client({ connectionString: test.url });
  await admin.connect();
  try {
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
  } finally {
    await admin.end();
  }
}

async function backendPid(executor: QueryExecutorProvider): Promise<number> {
  const { rows } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(executor);
  return rows[0]?.pid ?? -1;
}

/** Espera (con tope) a que se cumpla la condición. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('No ocurrió a tiempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createDatabase: conexiones cortadas por PostgreSQL', () => {
  it('una conexión libre cortada se anota sin datos sensibles y el pool se recupera', async () => {
    const errors: ConnectionErrorInfo[] = [];
    const db = createDatabase(test.url, { onConnectionError: (info) => errors.push(info) });
    try {
      // Con una sola consulta, la conexión queda libre en el pool.
      const pid = await backendPid(db);
      await terminateBackend(pid);
      await until(() => errors.length > 0);

      expect(errors).toHaveLength(1);
      // Solo clase y código: el mensaje de `pg` puede incluir servidor, puerto o parte de la consulta.
      expect(Object.keys(errors[0] ?? {}).sort()).toEqual(['code', 'name']);
      expect(errors[0]?.code).toBe('57P01'); // admin_shutdown

      // El pool descartó la conexión rota y abre otra.
      expect(await backendPid(db)).not.toBe(pid);
    } finally {
      await db.destroy();
    }
  });

  it('una conexión en uso cortada hace fallar su consulta, se anota y el pool se recupera', async () => {
    const errors: ConnectionErrorInfo[] = [];
    const db = createDatabase(test.url, { onConnectionError: (info) => errors.push(info) });
    try {
      await expect(
        db.transaction().execute(async (trx) => {
          await terminateBackend(await backendPid(trx));
          await sql`SELECT 1`.execute(trx);
        }),
      ).rejects.toBeInstanceOf(Error);
      await until(() => errors.length > 0);
      expect(errors[0]?.code).toBe('57P01');

      const { rows } = await sql<{ ok: number }>`SELECT 1 AS ok`.execute(db);
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it('sin escuchante de aviso tampoco se cae', async () => {
    const db = createDatabase(test.url);
    try {
      await terminateBackend(await backendPid(db));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect((await sql<{ ok: number }>`SELECT 1 AS ok`.execute(db)).rows[0]?.ok).toBe(1);
    } finally {
      await db.destroy();
    }
  });
});
