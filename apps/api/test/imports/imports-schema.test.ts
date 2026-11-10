/**
 * Restricciones de `import_batches` (migración 0009) en la base de datos real: lo que la aplicación no puede
 * saltarse aunque tenga un fallo.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/db/schema.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';

let database: TestDatabase;
let db: Kysely<Database>;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await database.drop();
}, DB_TIMEOUT_MS);

beforeEach(async () => {
  await db.deleteFrom('import_batches').execute();
});

const NOW = new Date('2026-11-03T09:00:00Z');
const LATER = new Date('2026-11-04T09:00:00Z');

/** Un lote válido en vista previa; cada test estropea una cosa. */
function batch(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'plan_excel' as const,
    month: '2026-11-01',
    file_name: 'plan.xlsx',
    file_size_bytes: 1000,
    file_sha256: randomBytes(32),
    content_hash: randomBytes(32),
    template_version: 2,
    status: 'preview' as const,
    extracted: '{"items":[]}',
    issues: '[]',
    created_at: NOW,
    expires_at: LATER,
    ...overrides,
  };
}

const insert = (overrides: Record<string, unknown> = {}) =>
  db.insertInto('import_batches').values(batch(overrides)).execute();

describe('import_batches', () => {
  it('admite un lote válido y usa los valores por defecto de issues y decisions', async () => {
    await insert();
    const row = await db.selectFrom('import_batches').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('preview');
    expect(row.decisions).toEqual({});
    expect(row.confirmed_at).toBeNull();
  });

  it.each([
    ['un tipo de lote desconocido', { kind: 'extracto' }],
    ['un mes que no es el día 1', { month: '2026-11-15' }],
    ['un nombre de archivo vacío', { file_name: '' }],
    ['un nombre de archivo de más de 255 caracteres', { file_name: 'a'.repeat(256) }],
    ['un tamaño 0', { file_size_bytes: 0 }],
    ['un SHA-256 de otra longitud', { file_sha256: Buffer.alloc(16) }],
    ['un hash de contenido de otra longitud', { content_hash: Buffer.alloc(16) }],
    ['un estado desconocido', { status: 'aprobado' }],
    ['issues que no es una lista', { issues: '{}' }],
    ['una caducidad no posterior a la creación', { expires_at: NOW }],
  ])('rechaza %s', async (_name, overrides) => {
    await expect(insert(overrides)).rejects.toThrow();
  });

  it('una vista previa tiene que llevar entradas y hash de contenido', async () => {
    await expect(insert({ extracted: null })).rejects.toThrow(
      /import_batches_preview_has_content/u,
    );
    await expect(insert({ content_hash: null })).rejects.toThrow(
      /import_batches_preview_has_content/u,
    );
    // Un lote fallido no tiene ni lo uno ni lo otro.
    await insert({ status: 'failed', extracted: null, content_hash: null, template_version: null });
  });

  it('confirmed_at existe si y solo si el lote está confirmado', async () => {
    await expect(insert({ confirmed_at: NOW })).rejects.toThrow(/import_batches_confirmed_at/u);
    await expect(insert({ status: 'confirmed', extracted: null })).rejects.toThrow(
      /import_batches_confirmed_at/u,
    );
    await insert({ status: 'confirmed', extracted: null, confirmed_at: NOW });
  });

  it('el mismo contenido no se confirma dos veces en el mismo mes, pero sí en otro mes o en vista previa', async () => {
    const hash = randomBytes(32);
    const confirmed = {
      status: 'confirmed',
      extracted: null,
      confirmed_at: NOW,
      content_hash: hash,
    };
    await insert(confirmed);
    await expect(insert(confirmed)).rejects.toThrow(/import_batches_confirmed_content_key/u);
    await insert({ ...confirmed, month: '2026-12-01' });
    await insert({ content_hash: hash }); // una vista previa con el mismo contenido: permitido
    await insert({ content_hash: hash });
  });

  it('jsonb se guarda y se lee como objeto, sin convertir la lista de problemas en un array de PostgreSQL', async () => {
    await insert({ issues: JSON.stringify([{ code: 'CELL_TYPE' }]) });
    const row = await db.selectFrom('import_batches').select('issues').executeTakeFirstOrThrow();
    expect(row.issues).toEqual([{ code: 'CELL_TYPE' }]);
  });
});
