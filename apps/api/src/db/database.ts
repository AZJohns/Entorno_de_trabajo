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

/** Qué se sabe de un error de conexión, sin nada que pueda ser sensible. */
export interface ConnectionErrorInfo {
  /** Nombre de la clase del error (`Error`, `DatabaseError`…). */
  readonly name: string;
  /** Código SQLSTATE (p. ej. `57P01`) o de red (p. ej. `ECONNRESET`), si lo hay. */
  readonly code: string | undefined;
}

/** Opciones de `createDatabase`. */
export interface DatabaseOptions {
  /**
   * Se llama cuando PostgreSQL corta una conexión (reinicio, `pg_terminate_backend`, fallo de red). Recibe
   * solo `ConnectionErrorInfo`: el mensaje del error de `pg` puede traer el servidor y el puerto, y el de
   * PostgreSQL, fragmentos de la consulta, así que no se pasa.
   */
  readonly onConnectionError?: (info: ConnectionErrorInfo) => void;
}

function describeError(error: unknown): ConnectionErrorInfo {
  const { code } = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown };
  return {
    name: error instanceof Error ? error.name : typeof error,
    code: typeof code === 'string' ? code : undefined,
  };
}

/**
 * Crea una instancia de Kysely con un pool de conexiones.
 *
 * Si PostgreSQL corta una conexión, `pg` emite un evento `error`; un `EventEmitter` sin escuchante para
 * `error` lanza la excepción y tumba el proceso. El pool solo escucha a las conexiones libres (y las
 * retira); las que están en uso no tienen escuchante, así que se añade uno a cada cliente al crearlo. Este
 * cubre los dos casos y es el que avisa; el del pool existe solo para que su evento no lance (si también
 * avisara, una conexión libre rota se contaría dos veces). La consulta en curso falla con su propio error,
 * que llega al llamante. No se reintenta nada aquí: reintentar una consulta (puede no ser idempotente) es
 * decisión de quien la lanzó; el pool se recupera solo porque descarta la conexión rota.
 *
 * @param connectionString Cadena `postgres://…` (viene de la configuración, nunca de un literal).
 */
export function createDatabase(
  connectionString: string,
  options: DatabaseOptions = {},
): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: 10, types: pgTypes });
  pool.on('error', () => {
    // Sin acción: el aviso lo da el escuchante de cada cliente (ver arriba).
  });
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      options.onConnectionError?.(describeError(error));
    });
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
