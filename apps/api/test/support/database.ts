/**
 * Base de datos temporal para tests de integración: se crea vacía, se migra y se borra al terminar.
 * Necesita TEST_DATABASE_URL (ver README).
 */
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/schema.ts';
import { migrateToLatest } from '../../src/db/migrator.ts';

/**
 * Tiempo máximo de los hooks que crean o borran la base de datos temporal. Motivo y medición en
 * test/migrations.test.ts: el primer CREATE DATABASE tras arrancar PostgreSQL en el runner de Windows
 * puede superar los 10 s por defecto de Vitest.
 */
export const DB_TIMEOUT_MS = 60_000;

function adminUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (url === undefined || url === '') {
    // Se falla en vez de saltar el test: un test de base de datos que no se ejecuta no protege nada.
    throw new Error(
      'Falta TEST_DATABASE_URL: arranca PostgreSQL (pnpm db:up) y define la variable.',
    );
  }
  return url;
}

async function admin(query: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

/** Base de datos temporal migrada. */
export interface TestDatabase {
  readonly db: Kysely<Database>;
  drop(): Promise<void>;
}

/** Crea una base de datos vacía con un nombre aleatorio y le aplica todas las migraciones. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `bo_test_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  const db = createDatabase(url.toString());
  await migrateToLatest(db);
  return {
    db,
    async drop() {
      await db.destroy();
      await admin(`DROP DATABASE IF EXISTS ${name}`);
    },
  };
}
