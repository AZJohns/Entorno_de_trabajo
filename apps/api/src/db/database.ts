/**
 * Conexión a PostgreSQL con Kysely (constructor de consultas tipado; ver docs/adr/0003).
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/**
 * Esquema de la base de datos para Kysely. Vacío en la fase 0 (aún no hay tablas). En la fase 1 se
 * generará a partir de la base de datos real con kysely-codegen.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- se rellena en la fase 1
export interface Database {}

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
