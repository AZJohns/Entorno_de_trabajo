/**
 * Proveedor de migraciones propio: lee la carpeta de migraciones y las importa.
 *
 * Sustituye a `FileMigrationProvider` de Kysely, que hace `import()` de la ruta absoluta del sistema
 * de archivos. En Windows esa ruta (`C:\…`) no es una URL válida para el cargador ESM de Node y falla
 * con ERR_UNSUPPORTED_ESM_URL_SCHEME. Aquí cada archivo se importa con `pathToFileURL(ruta).href`
 * (`file:///C:/…`), que funciona en todos los sistemas.
 *
 * Además es más estricto que el de Kysely: un archivo `.ts` con un nombre que no sigue el formato
 * `NNNN_descripcion.ts` es un error, no se ignora. Una migración mal nombrada que se saltara en
 * silencio no se aplicaría nunca.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Migration, MigrationProvider } from 'kysely/migration';

/** Formato obligatorio del nombre de una migración: 4 cifras, guion bajo y descripción. */
export const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.ts$/;

function isMigrationModule(value: unknown): value is Migration {
  return (
    typeof value === 'object' &&
    value !== null &&
    'up' in value &&
    typeof value.up === 'function' &&
    (!('down' in value) || value.down === undefined || typeof value.down === 'function')
  );
}

/**
 * Migraciones de una carpeta, importadas como URL `file://`.
 */
export class TsFileMigrationProvider implements MigrationProvider {
  readonly #folder: string;

  /** @param folder Ruta absoluta de la carpeta de migraciones. */
  constructor(folder: string) {
    this.#folder = folder;
  }

  /**
   * Devuelve las migraciones ordenadas por nombre (sin la extensión `.ts`).
   *
   * Solo se consideran los archivos `.ts` (se excluyen los `.d.ts`); el resto, p. ej. un README, se
   * ignora.
   *
   * @throws {Error} si un `.ts` no sigue `NNNN_descripcion.ts` o no exporta una función `up`.
   */
  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await fs.readdir(this.#folder))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
      .sort();

    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      if (!MIGRATION_FILE_PATTERN.test(file)) {
        throw new Error(`Nombre de migración no válido: ${file} (formato: NNNN_descripcion.ts)`);
      }
      const url = pathToFileURL(path.join(this.#folder, file)).href;
      const module: unknown = await import(url);
      if (!isMigrationModule(module)) {
        throw new Error(`La migración ${file} no exporta una función up()`);
      }
      // Se guarda el módulo tal cual (su espacio de nombres exporta up y, opcionalmente, down).
      migrations[file.slice(0, -'.ts'.length)] = module;
    }
    return migrations;
  }
}
