/**
 * Tests del proveedor de migraciones SIN base de datos. También se ejecutan en el job `windows` de la
 * CI: allí las rutas son `C:\…` y comprueban que las migraciones se importan como URL `file://`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/migrator.ts';
import { TsFileMigrationProvider } from '../src/db/migration-provider.ts';

const tempDirs: string[] = [];

async function folderWith(files: Record<string, string>): Promise<string> {
  // os.tmpdir() en Windows es una ruta absoluta con unidad (C:\Users\…\Temp): el caso que fallaba.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bo-migrations-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

const VALID = 'export async function up(): Promise<void> {}\n';

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('TsFileMigrationProvider', () => {
  it('carga las migraciones reales del proyecto, con up() y down()', async () => {
    const migrations = await new TsFileMigrationProvider(MIGRATIONS_FOLDER).getMigrations();
    expect(Object.keys(migrations)).toContain('0001_spanish_text_search');
    for (const migration of Object.values(migrations)) {
      expect(typeof migration.up).toBe('function');
    }
    expect(typeof migrations['0001_spanish_text_search']?.down).toBe('function');
  });

  it('devuelve las migraciones en orden e ignora lo que no es .ts', async () => {
    const dir = await folderWith({
      '0002_second.ts': VALID,
      '0001_first.ts': VALID,
      '0010_tenth.ts': VALID,
      'README.md': '# notas',
      'types.d.ts': 'export {};\n',
    });
    const migrations = await new TsFileMigrationProvider(dir).getMigrations();
    expect(Object.keys(migrations)).toEqual(['0001_first', '0002_second', '0010_tenth']);
  });

  it('falla con un .ts mal nombrado en lugar de ignorarlo', async () => {
    const dir = await folderWith({ '0001_ok.ts': VALID, '2-mal-nombrada.ts': VALID });
    await expect(new TsFileMigrationProvider(dir).getMigrations()).rejects.toThrow(
      'Nombre de migración no válido: 2-mal-nombrada.ts',
    );
  });

  it('falla si una migración no exporta up()', async () => {
    const dir = await folderWith({ '0001_sin_up.ts': 'export const x = 1;\n' });
    await expect(new TsFileMigrationProvider(dir).getMigrations()).rejects.toThrow(
      'no exporta una función up()',
    );
  });
});
