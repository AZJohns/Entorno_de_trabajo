/**
 * Test de integración contra un PostgreSQL real. Necesita TEST_DATABASE_URL (ver README): crea una
 * base de datos temporal, aplica las migraciones y la borra al terminar.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.ts';
import { migrateToLatest } from '../src/db/migrator.ts';

const adminUrl = process.env['TEST_DATABASE_URL'];
if (adminUrl === undefined || adminUrl === '') {
  // Se falla en vez de saltar el test: un test de base de datos que no se ejecuta no protege nada.
  throw new Error('Falta TEST_DATABASE_URL: arranca PostgreSQL (pnpm db:up) y define la variable.');
}

const dbName = `bo_test_${randomBytes(6).toString('hex')}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${dbName}`;

async function admin(query: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

describe('migraciones', () => {
  const db = createDatabase(testUrl.toString());

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${dbName}`);
  });

  afterAll(async () => {
    await db.destroy();
    await admin(`DROP DATABASE IF EXISTS ${dbName}`);
  });

  it('se aplican todas sobre una base vacía y la segunda vez no hacen nada', async () => {
    const first = await migrateToLatest(db);
    expect(first.results?.length).toBeGreaterThan(0);
    expect(first.results?.every((result) => result.status === 'Success')).toBe(true);

    const second = await migrateToLatest(db);
    expect(second.results).toEqual([]);
  });

  it('es_unaccent ignora los acentos y aplica la raíz española', async () => {
    const { rows } = await sql<{ a: string; b: string }>`
      SELECT to_tsvector('es_unaccent', 'Acción presupuestos')::text AS a,
             to_tsvector('es_unaccent', 'accion presupuesto')::text AS b
    `.execute(db);
    expect(rows[0]?.a).toBe(rows[0]?.b);
  });
});
