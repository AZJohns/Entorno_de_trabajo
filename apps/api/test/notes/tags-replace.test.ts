/**
 * Sustituir el conjunto de etiquetas de una nota es atómico: o se aplica entero o no cambia nada, y dos
 * sustituciones simultáneas no se mezclan. Se prueba en el servicio (sin HTTP) porque necesita saltarse la
 * validación del esquema para provocar un fallo en mitad de la operación y lanzar peticiones a la vez.
 * Textos inventados.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNotesModule } from '../../src/modules/notes/index.ts';
import type { NotesService } from '../../src/modules/notes/index.ts';
import { systemClock } from '../../src/lib/clock.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';

let testDb: TestDatabase;
let notes: NotesService;

beforeAll(async () => {
  testDb = await createTestDatabase();
  notes = createNotesModule({ db: testDb.db, clock: systemClock }).notes;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb.drop();
}, DB_TIMEOUT_MS);

beforeEach(async () => {
  await testDb.db.deleteFrom('notes').execute();
  await testDb.db.deleteFrom('tags').execute();
});

const names = (tags: readonly { name: string }[]): string[] => tags.map((t) => t.name);

async function allTagNames(): Promise<string[]> {
  const rows = await testDb.db.selectFrom('tags').select('name').orderBy('name').execute();
  return rows.map((r) => r.name);
}

describe('atomicidad', () => {
  it('si una etiqueta falla en la base de datos, no cambia nada: ni etiquetas, ni título, ni cuerpo', async () => {
    const note = await notes.create({ title: 'Original', bodyMd: 'cuerpo', tags: ['Uno', 'Dos'] });
    // La segunda etiqueta pasa de 40 caracteres: el esquema la habría rechazado, la base de datos
    // también (CHECK), y esto ocurre DESPUÉS de crear «Nueva» y de editar el título.
    await expect(
      notes.update(note.id, { title: 'Cambiado', tags: ['Nueva', 'x'.repeat(41)] }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'tags_name_length' });

    const after = await notes.get(note.id);
    expect(after.title).toBe('Original');
    expect(after.bodyMd).toBe('cuerpo');
    expect(after.updatedAt).toEqual(note.updatedAt);
    expect(names(after.tags)).toEqual(['Dos', 'Uno']);
    // «Nueva» se creó dentro de la transacción y se deshizo con ella.
    expect(await allTagNames()).toEqual(['Dos', 'Uno']);
  });

  it('si la creación de la nota falla por una etiqueta, no queda la nota', async () => {
    await expect(
      notes.create({ title: 'Nueva', bodyMd: '', tags: ['Buena', 'x'.repeat(41)] }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await testDb.db.selectFrom('notes').selectAll().execute()).toEqual([]);
    expect(await allTagNames()).toEqual([]);
  });

  it('una nota inexistente → 404 sin crear etiquetas', async () => {
    await expect(
      notes.update('00000000-0000-4000-8000-000000000000', { tags: ['Fantasma'] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await allTagNames()).toEqual([]);
  });
});

describe('concurrencia', () => {
  it('dos sustituciones a la vez del mismo conjunto: queda exactamente uno de los dos, nunca una mezcla', async () => {
    for (let round = 0; round < 15; round += 1) {
      const note = await notes.create({ title: `Nota ${round}`, bodyMd: '', tags: ['a', 'b'] });
      await Promise.all([
        notes.update(note.id, { tags: ['c', 'd'] }),
        notes.update(note.id, { tags: ['e', 'f'] }),
      ]);
      const final = names((await notes.get(note.id)).tags);
      expect(
        [
          ['c', 'd'],
          ['e', 'f'],
        ],
        `ronda ${round}: ${final.join(',')}`,
      ).toContainEqual(final);
    }
  });

  it('dos notas que crean a la vez la misma etiqueta nueva comparten una sola, sin error', async () => {
    for (let round = 0; round < 10; round += 1) {
      const name = `Etiqueta ${round}`;
      const [a, b] = await Promise.all([
        notes.create({ title: 'A', bodyMd: '', tags: [name] }),
        notes.create({ title: 'B', bodyMd: '', tags: [name.toUpperCase()] }),
      ]);
      expect(a.tags[0]?.id).toBe(b.tags[0]?.id);
    }
    expect(await allTagNames()).toHaveLength(10);
  });
});
