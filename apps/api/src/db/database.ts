/**
 * Conexión a PostgreSQL con Kysely (constructor de consultas tipado; ver docs/adr/0003).
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './schema.ts';

export type { Database } from './schema.ts';

/** OID del tipo `date` de PostgreSQL. */
const DATE_OID = 1082;

/**
 * Tipos de `pg` con las fechas contables (`date`) como texto `YYYY-MM-DD`.
 *
 * Por defecto `pg` convierte un `date` en un `Date` a medianoche **de la zona horaria del proceso**: el
 * día cambiaría según dónde corra el servidor y las fechas contables dejarían de ser comparables.
 * Se configura en este pool y no con `pg.types.setTypeParser`, que afectaría a todo el proceso.
 */
const pgTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary'): (value: string) => unknown {
    if (oid === DATE_OID) return (value) => value;
    // @types/pg tipa el analizador como `any`; se estrecha a `unknown` para no propagar el `any`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parser: (value: string) => unknown = pg.types.getTypeParser(oid, format);
    return parser;
  },
};

/**
 * Crea una instancia de Kysely con un pool de conexiones.
 *
 * @param connectionString Cadena `postgres://…` (viene de la configuración, nunca de un literal).
 */
export function createDatabase(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 10, types: pgTypes }),
    }),
  });
}
