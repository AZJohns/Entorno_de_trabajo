/**
 * Ejecutor de migraciones versionadas (Kysely Migrator).
 *
 * Reglas (ver docs/adr/0003):
 * - Cada migración es un archivo `NNNN_descripcion.ts` en `migrations/`; se aplican en orden.
 * - **Una migración aplicada o publicada en `main` no se edita nunca**: se crea otra nueva. La CI lo
 *   comprueba (`scripts/check-migrations-immutable.ts`).
 * - Se avanza siempre hacia delante. `down` solo existe si es trivial y sirve para el desarrollo local.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { FileMigrationProvider, Migrator, type MigrationResultSet } from 'kysely/migration';

/**
 * Las migraciones operan sobre un esquema que cambia con cada una: no hay un tipo de base de datos
 * fijo que las describa. Kysely tipa el migrador con `Kysely<any>` por ese motivo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver comentario anterior
type AnyDatabase = Kysely<any>;

/** Carpeta de las migraciones. */
export const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

/** Crea el migrador para una conexión. */
export function createMigrator(db: AnyDatabase): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder: MIGRATIONS_FOLDER }),
  });
}

/**
 * Aplica todas las migraciones pendientes.
 *
 * @throws el error de la primera migración que falle; las anteriores ya quedaron aplicadas.
 */
export async function migrateToLatest(db: AnyDatabase): Promise<MigrationResultSet> {
  const result = await createMigrator(db).migrateToLatest();
  if (result.error !== undefined) {
    throw result.error instanceof Error
      ? result.error
      : new Error('La migración ha fallado', { cause: result.error });
  }
  return result;
}
