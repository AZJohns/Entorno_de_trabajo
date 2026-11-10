/**
 * Notas y etiquetas en la API (`/notes`, `/tags`): contra la base de datos real. Cubre el CRUD, las
 * etiquetas (deduplicación sin distinguir mayúsculas, sustitución del conjunto), los códigos de error
 * (400, 404, 409) y la paginación por cursor. La búsqueda tiene su archivo (`api-notes-search.test.ts`).
 * Textos inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_NOTE_BODY, noteResponseSchema, tagListResponseSchema } from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import type { TestClient } from '../support/client.ts';
import { expectProblem } from '../support/ledger.ts';
import { NOTES, TAGS, addNote, listNotes, resetNotes } from '../support/notes.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetNotes(getCtx().database.db);
});

async function tagList(client: TestClient) {
  const res = await client.get(TAGS);
  expect(res.status).toBe(200);
  return tagListResponseSchema.parse(res.body).items;
}

describe('alta y lectura', () => {
  it('crea la nota con el cuerpo y las etiquetas, y la devuelve igual al leerla', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, '  Ideas de la casa  ', '# Pintura\n\n- salón', ['Casa']);
    expect(note).toMatchObject({
      title: 'Ideas de la casa',
      bodyMd: '# Pintura\n\n- salón',
      tags: [{ name: 'Casa' }],
    });
    const read = await client.get(`${NOTES}/${note.id}`);
    expect(read.status).toBe(200);
    expect(noteResponseSchema.parse(read.body)).toEqual(note);
  });

  it('el cuerpo es vacío y las etiquetas ninguna por defecto', async () => {
    const client = await getCtx().loggedIn();
    const res = await client.post(NOTES, { title: 'Solo título' });
    expect(res.status).toBe(201);
    expect(noteResponseSchema.parse(res.body)).toMatchObject({ bodyMd: '', tags: [] });
  });

  it('un cuerpo con HTML se guarda y se devuelve tal cual: la API no lo interpreta', async () => {
    const client = await getCtx().loggedIn();
    const body = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
    const note = await addNote(client, 'HTML', body);
    expect(note.bodyMd).toBe(body);
  });

  it('GET de una nota inexistente → 404; con un identificador que no es UUID → 400', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(`${NOTES}/${MISSING_ID}`), 404, 'NOT_FOUND');
    expectProblem(await client.get(`${NOTES}/no-es-un-uuid`), 400, 'VALIDATION_ERROR');
  });
});

describe('validación (400)', () => {
  it.each([
    ['sin título', {}],
    ['título vacío', { title: '' }],
    ['título solo de espacios', { title: '   ' }],
    ['título de 201 caracteres', { title: 'x'.repeat(201) }],
    ['cuerpo demasiado largo', { title: 'a', bodyMd: 'x'.repeat(MAX_NOTE_BODY + 1) }],
    ['más de 20 etiquetas', { title: 'a', tags: Array.from({ length: 21 }, (_, i) => `e${i}`) }],
    ['etiqueta vacía', { title: 'a', tags: [' '] }],
    ['etiqueta de 41 caracteres', { title: 'a', tags: ['x'.repeat(41)] }],
    ['etiqueta con salto de línea', { title: 'a', tags: ['uno\ndos'] }],
    ['campo desconocido', { title: 'a', archived: true }],
  ])('POST: %s', async (_name, body) => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.post(NOTES, body), 400, 'VALIDATION_ERROR');
  });

  it('PATCH sin ningún campo → 400', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, 'A');
    expectProblem(await client.patch(`${NOTES}/${note.id}`, {}), 400, 'VALIDATION_ERROR');
  });

  it('PATCH o DELETE de una nota inexistente → 404', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.patch(`${NOTES}/${MISSING_ID}`, { title: 'x' }), 404, 'NOT_FOUND');
    expectProblem(await client.delete(`${NOTES}/${MISSING_ID}`), 404, 'NOT_FOUND');
  });
});

describe('edición y borrado', () => {
  it('edita título y cuerpo sin tocar las etiquetas, y actualiza updatedAt', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const note = await addNote(client, 'Antes', 'cuerpo', ['Uno']);
    ctx.t.clock.advance(60_000);
    const res = await client.patch(`${NOTES}/${note.id}`, { title: 'Después', bodyMd: 'nuevo' });
    expect(res.status).toBe(200);
    const edited = noteResponseSchema.parse(res.body);
    expect(edited).toMatchObject({ title: 'Después', bodyMd: 'nuevo', tags: note.tags });
    expect(edited.createdAt).toBe(note.createdAt);
    expect(Date.parse(edited.updatedAt)).toBe(Date.parse(note.updatedAt) + 60_000);
  });

  it('cambiar solo las etiquetas también actualiza updatedAt', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const note = await addNote(client, 'A', '', ['Uno']);
    ctx.t.clock.advance(1_000);
    const res = await client.patch(`${NOTES}/${note.id}`, { tags: [] });
    expect(noteResponseSchema.parse(res.body).updatedAt).not.toBe(note.updatedAt);
  });

  it('borra la nota y sus enlaces; las etiquetas siguen existiendo con 0 notas', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, 'A', '', ['Uno']);
    expect((await client.delete(`${NOTES}/${note.id}`)).status).toBe(204);
    expectProblem(await client.get(`${NOTES}/${note.id}`), 404, 'NOT_FOUND');
    expect(await tagList(client)).toMatchObject([{ name: 'Uno', noteCount: 0 }]);
  });
});

describe('etiquetas', () => {
  it('se deduplican sin distinguir mayúsculas, dentro de la petición y entre notas', async () => {
    const client = await getCtx().loggedIn();
    const first = await addNote(client, 'A', '', ['Cuentas', 'cuentas', 'CUENTAS', 'Casa']);
    expect(first.tags.map((t) => t.name)).toEqual(['Casa', 'Cuentas']);
    const second = await addNote(client, 'B', '', ['cuentas']);
    // Se reutiliza la etiqueta existente, con la grafía con que se creó.
    expect(second.tags).toEqual([first.tags.find((t) => t.name === 'Cuentas')]);
    const tags = await tagList(client);
    expect(tags.map((t) => [t.name, t.noteCount])).toEqual([
      ['Casa', 1],
      ['Cuentas', 2],
    ]);
  });

  it('las etiquetas de una nota salen ordenadas por nombre sin distinguir mayúsculas', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, 'A', '', ['beta', 'Alfa', 'Cero']);
    expect(note.tags.map((t) => t.name)).toEqual(['Alfa', 'beta', 'Cero']);
  });

  it('PATCH con tags SUSTITUYE el conjunto completo', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, 'A', '', ['Uno', 'Dos']);
    const res = await client.patch(`${NOTES}/${note.id}`, { tags: ['dos', 'Tres'] });
    const names = noteResponseSchema.parse(res.body).tags.map((t) => t.name);
    // «dos» ya existía como «Dos» y se conserva esa etiqueta; «Uno» sale; «Tres» entra.
    expect(names).toEqual(['Dos', 'Tres']);
    const tags = await tagList(client);
    expect(tags.map((t) => [t.name, t.noteCount])).toEqual([
      ['Dos', 1],
      ['Tres', 1],
      ['Uno', 0],
    ]);
  });

  it('PATCH con tags [] quita todas; sin tags no las toca', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, 'A', '', ['Uno', 'Dos']);
    const untouched = await client.patch(`${NOTES}/${note.id}`, { title: 'B' });
    expect(noteResponseSchema.parse(untouched.body).tags).toHaveLength(2);
    const cleared = await client.patch(`${NOTES}/${note.id}`, { tags: [] });
    expect(noteResponseSchema.parse(cleared.body).tags).toEqual([]);
  });

  it('la lista de etiquetas cuenta las notas y va por orden alfabético', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', '', ['b', 'a']);
    await addNote(client, 'B', '', ['B']);
    expect((await tagList(client)).map((t) => [t.name, t.noteCount])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('renombrar: cambia el nombre en todas las notas', async () => {
    const client = await getCtx().loggedIn();
    const note = await addNote(client, 'A', '', ['presupuesto']);
    const tag = note.tags[0];
    const res = await client.patch(`${TAGS}/${tag?.id}`, { name: '  Presupuesto 2026 ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: tag?.id, name: 'Presupuesto 2026', noteCount: 1 });
    const read = await client.get(`${NOTES}/${note.id}`);
    expect(noteResponseSchema.parse(read.body).tags.map((t) => t.name)).toEqual([
      'Presupuesto 2026',
    ]);
  });

  it('renombrar solo las mayúsculas de la propia etiqueta es válido', async () => {
    const client = await getCtx().loggedIn();
    const tag = (await addNote(client, 'A', '', ['python'])).tags[0];
    const res = await client.patch(`${TAGS}/${tag?.id}`, { name: 'PYTHON' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'PYTHON' });
  });

  it('renombrar al nombre de OTRA etiqueta (sin distinguir mayúsculas) → 409', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', '', ['Casa']);
    const other = (await addNote(client, 'B', '', ['Trabajo'])).tags[0];
    expectProblem(await client.patch(`${TAGS}/${other?.id}`, { name: 'CASA' }), 409, 'CONFLICT');
    // La etiqueta no cambió.
    expect((await tagList(client)).map((t) => t.name)).toEqual(['Casa', 'Trabajo']);
  });

  it('renombrar: inexistente → 404; nombre no válido o campo desconocido → 400', async () => {
    const client = await getCtx().loggedIn();
    const tag = (await addNote(client, 'A', '', ['Casa'])).tags[0];
    expectProblem(await client.patch(`${TAGS}/${MISSING_ID}`, { name: 'x' }), 404, 'NOT_FOUND');
    expectProblem(await client.patch(`${TAGS}/${tag?.id}`, { name: ' ' }), 400, 'VALIDATION_ERROR');
    expectProblem(
      await client.patch(`${TAGS}/${tag?.id}`, { name: 'y'.repeat(41) }),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.patch(`${TAGS}/${tag?.id}`, { name: 'ok', extra: 1 }),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(await client.patch(`${TAGS}/no-uuid`, { name: 'ok' }), 400, 'VALIDATION_ERROR');
  });
});

describe('lista, filtro por etiqueta y paginación', () => {
  it('sin búsqueda: última edición primero; sin cuerpo completo ni fragmentos', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await addNote(client, 'Primera', 'a'.repeat(500));
    ctx.t.clock.advance(1_000);
    await addNote(client, 'Segunda', 'corto');
    const { items, nextCursor } = await listNotes(client);
    expect(items.map((i) => i.title)).toEqual(['Segunda', 'Primera']);
    expect(nextCursor).toBeNull();
    expect(items[1]?.preview).toHaveLength(200);
    expect(items[0]?.snippet).toBeNull();
    expect(items[0]).not.toHaveProperty('bodyMd');
  });

  it('editar una nota la sube al principio', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const a = await addNote(client, 'A');
    ctx.t.clock.advance(1_000);
    await addNote(client, 'B');
    ctx.t.clock.advance(1_000);
    await client.patch(`${NOTES}/${a.id}`, { bodyMd: 'editada' });
    expect((await listNotes(client)).items.map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('filtra por etiqueta sin distinguir mayúsculas; una etiqueta inexistente da lista vacía', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Con casa', '', ['Casa']);
    await addNote(client, 'Con trabajo', '', ['Trabajo']);
    await addNote(client, 'Sin nada');
    expect((await listNotes(client, { tag: 'cASA' })).items.map((i) => i.title)).toEqual([
      'Con casa',
    ]);
    expect((await listNotes(client, { tag: 'nada' })).items).toEqual([]);
  });

  it('cada elemento de la lista trae sus etiquetas', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', '', ['b', 'a']);
    const { items } = await listNotes(client);
    expect(items[0]?.tags.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('pagina por cursor sin repetir ni saltarse notas, aunque se añadan notas entre páginas', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    for (const n of [1, 2, 3, 4, 5]) {
      await addNote(client, `Nota ${n}`);
      ctx.t.clock.advance(1_000);
    }
    const first = await listNotes(client, { limit: 2 });
    expect(first.items.map((i) => i.title)).toEqual(['Nota 5', 'Nota 4']);
    expect(first.nextCursor).not.toBeNull();
    // Una nota nueva (más reciente) no desplaza lo que falta por ver.
    await addNote(client, 'Nota 6');
    const second = await listNotes(client, { limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((i) => i.title)).toEqual(['Nota 3', 'Nota 2']);
    const third = await listNotes(client, { limit: 2, cursor: second.nextCursor ?? '' });
    expect(third.items.map((i) => i.title)).toEqual(['Nota 1']);
    expect(third.nextCursor).toBeNull();
  });

  it('con filtro de etiqueta también pagina', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    for (const n of [1, 2, 3]) {
      await addNote(client, `Casa ${n}`, '', ['Casa']);
      await addNote(client, `Otra ${n}`);
      ctx.t.clock.advance(1_000);
    }
    const first = await listNotes(client, { tag: 'casa', limit: 2 });
    const second = await listNotes(client, {
      tag: 'casa',
      limit: 2,
      cursor: first.nextCursor ?? '',
    });
    expect([...first.items, ...second.items].map((i) => i.title)).toEqual([
      'Casa 3',
      'Casa 2',
      'Casa 1',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ['cursor mal formado', { cursor: 'basura' }],
    ['limit 0', { limit: 0 }],
    ['limit 101', { limit: 101 }],
    ['parámetro desconocido', { archived: 'true' }],
    ['q sin letras ni cifras', { q: '???' }],
    ['q de más de 200 caracteres', { q: 'a'.repeat(201) }],
  ])('GET /notes: %s → 400', async (_name, params) => {
    const client = await getCtx().loggedIn();
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
    );
    expectProblem(await client.get(`${NOTES}?${query.toString()}`), 400, 'VALIDATION_ERROR');
  });
});
