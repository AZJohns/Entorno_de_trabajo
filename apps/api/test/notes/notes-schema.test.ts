/**
 * Restricciones de la migración 0008 (`notes`, `tags`, `note_tags`) contra un PostgreSQL real. Cada test
 * comprueba que la base de datos rechaza el dato inválido **por la restricción concreta**. Datos inventados.
 */
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/schema.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';

let testDb: TestDatabase;
let db: Kysely<Database>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = testDb.db;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb.drop();
}, DB_TIMEOUT_MS);

beforeEach(async () => {
  await db.deleteFrom('notes').execute();
  await db.deleteFrom('tags').execute();
});

/** Inserta con valores construidos a mano para poder romper cada regla; la base de datos valida. */
const insertNote = (values: Record<string, unknown> = {}) =>
  db
    .insertInto('notes')
    .values({ title: 'Nota', ...values } as never)
    .returning('id')
    .executeTakeFirstOrThrow();

const insertTag = (name: string) =>
  db.insertInto('tags').values({ name }).returning('id').executeTakeFirstOrThrow();

async function expectViolation(
  action: Promise<unknown>,
  code: '23514' | '23505' | '428C9',
  constraint?: string,
): Promise<void> {
  await expect(action).rejects.toMatchObject(
    constraint === undefined ? { code } : { code, constraint },
  );
}

describe('notes', () => {
  it('acepta una nota válida; el cuerpo es vacío por defecto', async () => {
    const { id } = await insertNote();
    const row = await db
      .selectFrom('notes')
      .select('body_md')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.body_md).toBe('');
  });

  it.each(['', 'x'.repeat(201)])('el título tiene de 1 a 200 caracteres', async (title) => {
    await expectViolation(insertNote({ title }), '23514', 'notes_title_length');
  });

  it('el título no puede ser solo espacios', async () => {
    await expectViolation(insertNote({ title: '   ' }), '23514', 'notes_title_not_blank');
  });

  it('el título admite 200 caracteres', async () => {
    await insertNote({ title: 'x'.repeat(200) });
  });

  it('el cuerpo admite hasta 100 000 caracteres, no uno más', async () => {
    await insertNote({ body_md: 'palabra '.repeat(12_500) });
    await expectViolation(
      insertNote({ body_md: 'x'.repeat(100_001) }),
      '23514',
      'notes_body_length',
    );
  });

  it('search_vector es una columna generada: no se puede escribir', async () => {
    await expectViolation(insertNote({ search_vector: "'x'" }), '428C9');
  });

  it('search_vector se recalcula al editar y pondera título (A) y cuerpo (B)', async () => {
    const { id } = await insertNote({ title: 'Presupuestos', body_md: 'La acción de hoy' });
    const vector = async (): Promise<string> =>
      (
        await sql<{
          v: string;
        }>`SELECT search_vector::text AS v FROM notes WHERE id = ${id}`.execute(db)
      ).rows[0]?.v ?? '';
    // Lematizado y sin acentos: «presupuestos» → 'presupuest'; «acción» → 'accion'.
    expect(await vector()).toContain("'presupuest':1A");
    expect(await vector()).toMatch(/'accion':\d+B/u);
    await db.updateTable('notes').set({ title: 'Otra cosa' }).where('id', '=', id).execute();
    expect(await vector()).not.toContain('presupuest');
  });
});

describe('tags', () => {
  it.each(['', 'x'.repeat(41)])('el nombre tiene de 1 a 40 caracteres', async (name) => {
    await expectViolation(insertTag(name), '23514', 'tags_name_length');
  });

  it('el nombre no puede ser solo espacios', async () => {
    await expectViolation(insertTag('  '), '23514', 'tags_name_not_blank');
  });

  it('el nombre es único sin distinguir mayúsculas, y conserva la grafía', async () => {
    await insertTag('Casa');
    await expectViolation(insertTag('CASA'), '23505', 'tags_name_lower_key');
    await expectViolation(insertTag('casa'), '23505', 'tags_name_lower_key');
    await insertTag('Casas');
    const rows = await db.selectFrom('tags').select('name').orderBy('name').execute();
    expect(rows.map((r) => r.name)).toEqual(['Casa', 'Casas']);
  });
});

describe('note_tags', () => {
  it('una etiqueta no se repite en una nota', async () => {
    const note = await insertNote();
    const tag = await insertTag('Casa');
    await db.insertInto('note_tags').values({ note_id: note.id, tag_id: tag.id }).execute();
    await expectViolation(
      db.insertInto('note_tags').values({ note_id: note.id, tag_id: tag.id }).execute(),
      '23505',
      'note_tags_pkey',
    );
  });

  it('borrar la nota o la etiqueta borra el enlace, no la otra parte', async () => {
    const a = await insertNote();
    const b = await insertNote({ title: 'Otra' });
    const t1 = await insertTag('Uno');
    const t2 = await insertTag('Dos');
    await db
      .insertInto('note_tags')
      .values([
        { note_id: a.id, tag_id: t1.id },
        { note_id: b.id, tag_id: t1.id },
        { note_id: b.id, tag_id: t2.id },
      ])
      .execute();
    await db.deleteFrom('notes').where('id', '=', a.id).execute();
    expect(await db.selectFrom('note_tags').selectAll().execute()).toHaveLength(2);
    await db.deleteFrom('tags').where('id', '=', t1.id).execute();
    const left = await db.selectFrom('note_tags').selectAll().execute();
    expect(left).toEqual([{ note_id: b.id, tag_id: t2.id }]);
    expect(await db.selectFrom('notes').selectAll().execute()).toHaveLength(1);
  });

  it('no admite enlaces a etiquetas inexistentes', async () => {
    const note = await insertNote();
    await expect(
      db
        .insertInto('note_tags')
        .values({ note_id: note.id, tag_id: '00000000-0000-4000-8000-000000000000' })
        .execute(),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
