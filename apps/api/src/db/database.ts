/**
 * Conexión a PostgreSQL con Kysely (constructor de consultas tipado; ver docs/adr/0003).
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './schema.ts';

export type { Database } from './schema.ts';

/**
 * Crea una instancia de Kysely con un pool de conexiones.
 *
 * @param connectionString Cadena `postgres://…` (viene de la configuración, nunca de un literal).
 */
export function createDatabase(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
  });
}
