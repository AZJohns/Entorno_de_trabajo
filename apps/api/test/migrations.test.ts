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

/**
 * Tiempo máximo de los hooks y tests que tocan la base de datos.
 *
 * Causa (medida en el runner windows-latest de la CI, PostgreSQL 17): el PRIMER `CREATE DATABASE`
 * tras arrancar el servicio tarda mucho más que los siguientes (1,9 s frente a 0,2–0,3 s en la
 * medición, y más de 10 s en dos ejecuciones que fallaron con el límite por defecto de Vitest). Es
 * el arranque en frío: la copia de `template1` se lee de disco y genera WAL mientras los demás
 * archivos de test se ejecutan en paralelo. No es un fallo del código, así que se amplía el límite.
 *
 * 60 s: seis veces el peor caso observado (> 10 s); sigue detectando un bloqueo real (una conexión
 * que no responde nunca) en un tiempo razonable.
 *
 * No se usa `CREATE DATABASE ... STRATEGY = FILE_COPY`: en la misma medición fue más lento en caliente
 * (0,5–0,9 s frente a 0,2–0,3 s), porque fuerza un checkpoint.
 */
const DB_TIMEOUT_MS = 60_000;

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
    const start = performance.now();
    await admin(`CREATE DATABASE ${dbName}`);
    // Se registra para poder seguir la evolución del tiempo en los logs de la CI.
    console.info(
      `CREATE DATABASE (test de migraciones): ${Math.round(performance.now() - start)} ms`,
    );
  }, DB_TIMEOUT_MS);

  afterAll(async () => {
    await db.destroy();
    await admin(`DROP DATABASE IF EXISTS ${dbName}`);
  }, DB_TIMEOUT_MS);

  it(
    'se aplican todas sobre una base vacía y la segunda vez no hacen nada',
    { timeout: DB_TIMEOUT_MS },
    async () => {
      const first = await migrateToLatest(db);
      expect(first.results?.length).toBeGreaterThan(0);
      expect(first.results?.every((result) => result.status === 'Success')).toBe(true);

      const second = await migrateToLatest(db);
      expect(second.results).toEqual([]);
    },
  );

  it(
    'es_unaccent ignora los acentos y aplica la raíz española',
    { timeout: DB_TIMEOUT_MS },
    async () => {
      const { rows } = await sql<{ a: string; b: string }>`
      SELECT to_tsvector('es_unaccent', 'Acción presupuestos')::text AS a,
             to_tsvector('es_unaccent', 'accion presupuesto')::text AS b
    `.execute(db);
      expect(rows[0]?.a).toBe(rows[0]?.b);
    },
  );
});
