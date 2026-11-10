/**
 * Búsqueda de texto completo de notas contra un PostgreSQL real: lematización, acentos, ranking, palabras
 * a medias, filtro por etiqueta, paginación por relevancia y —sobre todo— que el resaltado nunca se
 * convierte en HTML. Textos inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { noteListResponseSchema } from '@backoffice/shared';
import { MATCH_END, MATCH_START } from '../../src/modules/notes/domain/search.ts';
import { useAuthTestContext } from '../support/auth.ts';
import { expectProblem } from '../support/ledger.ts';
import { NOTES, addNote, listNotes, resetNotes, searchTitles } from '../support/notes.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetNotes(getCtx().database.db);
});

describe('lematización y acentos', () => {
  it('«presupuestos» encuentra «presupuesto» y al revés (título y cuerpo)', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Informe', 'Revisar el presupuesto de la casa');
    await addNote(client, 'Los presupuestos del año', 'otra cosa');
    await addNote(client, 'Sin relación', 'nada que ver');
    expect(new Set(await searchTitles(client, 'presupuestos'))).toEqual(
      new Set(['Informe', 'Los presupuestos del año']),
    );
    expect(new Set(await searchTitles(client, 'presupuesto'))).toEqual(
      new Set(['Informe', 'Los presupuestos del año']),
    );
  });

  it('las formas verbales y los plurales comparten raíz', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Facturas', 'Pagué las facturas pendientes');
    expect(await searchTitles(client, 'factura')).toEqual(['Facturas']);
  });

  it('con y sin acento es lo mismo, en las dos direcciones y en mayúsculas', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Con tilde', 'La acción correctiva');
    await addNote(client, 'Sin tilde', 'una accion directa');
    for (const q of ['accion', 'acción', 'ACCIÓN']) {
      expect(new Set(await searchTitles(client, q))).toEqual(new Set(['Con tilde', 'Sin tilde']));
    }
  });

  it('no encuentra lo que no está', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Casa', 'pintar el salón');
    expect(await searchTitles(client, 'presupuesto')).toEqual([]);
  });
});

describe('palabras a medias (prefijo)', () => {
  it('el comienzo de una palabra encuentra la nota', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Planes', 'Revisión del presupuesto familiar');
    for (const q of ['presup', 'pres', 'revis', 'famil']) {
      expect(await searchTitles(client, q)).toEqual(['Planes']);
    }
  });

  it('varios términos a medias: todos deben aparecer, en cualquier orden', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'presupuesto familiar');
    await addNote(client, 'B', 'presupuesto de empresa');
    expect(await searchTitles(client, 'presup fam')).toEqual(['A']);
    expect(await searchTitles(client, 'fam presup')).toEqual(['A']);
    expect(await searchTitles(client, 'presup zzz')).toEqual([]);
  });

  it('una parte del medio de la palabra no es un prefijo y no encuentra (límite conocido)', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'presupuesto');
    expect(await searchTitles(client, 'upuest')).toEqual([]);
  });

  it('el prefijo también funciona sin acento y con la ñ', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'Colegio', 'El niño tiene la reunión del colegio');
    expect(await searchTitles(client, 'reuni')).toEqual(['Colegio']);
    expect(await searchTitles(client, 'niñ')).toEqual(['Colegio']);
  });
});

describe('entradas raras', () => {
  it('solo palabras vacías («de la») → lista vacía, no un error', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'casa de la abuela');
    expect(await searchTitles(client, 'de la')).toEqual([]);
  });

  it('los operadores de tsquery se tratan como texto, no rompen la consulta', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'presupuesto familiar');
    for (const q of ['presup & !x | (y', "'", 'a:* <-> b', 'presup:*', '(((', "\\' OR 1=1 --"]) {
      const res = await client.get(`${NOTES}?q=${encodeURIComponent(q)}`);
      // «'» y «(((» no tienen letras: 400 por el esquema; el resto, 200. Ninguno es un 500.
      expect([200, 400], q).toContain(res.status);
    }
    expect(await searchTitles(client, 'presup & !x | (y')).toEqual([]);
    expect(await searchTitles(client, 'presup:*')).toEqual(['A']);
  });
});

describe('ranking', () => {
  it('una coincidencia en el título pesa más que una en el cuerpo', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await addNote(client, 'Reunión', 'hablar del presupuesto con calma, nada más');
    // La del título es MÁS ANTIGUA: si ganara por recencia, quedaría detrás.
    ctx.t.clock.advance(1_000);
    await addNote(client, 'Presupuesto anual', 'revisar cifras y otras cosas, nada más');
    expect(await searchTitles(client, 'presupuesto')).toEqual(['Presupuesto anual', 'Reunión']);
  });

  it('a igual relevancia, la más recientemente editada va primero', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await addNote(client, 'Antigua', 'el presupuesto');
    ctx.t.clock.advance(1_000);
    await addNote(client, 'Reciente', 'el presupuesto');
    expect(await searchTitles(client, 'presupuesto')).toEqual(['Reciente', 'Antigua']);
  });

  it('con varios términos, la que los tiene juntos y en el título gana', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await addNote(client, 'Notas', 'el informe y, mucho más abajo, el presupuesto');
    ctx.t.clock.advance(1_000);
    await addNote(client, 'Informe de presupuesto', 'resumen');
    expect((await searchTitles(client, 'informe presupuesto'))[0]).toBe('Informe de presupuesto');
  });

  it('con q cada resultado trae relevancia ordenada: la lista no sale en orden de edición', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await addNote(client, 'Título con presupuesto', '');
    ctx.t.clock.advance(1_000);
    await addNote(client, 'Otra', 'cuerpo con presupuesto');
    ctx.t.clock.advance(1_000);
    await addNote(client, 'Más reciente aún', 'cuerpo con presupuesto');
    const titles = await searchTitles(client, 'presupuesto');
    expect(titles[0]).toBe('Título con presupuesto');
    expect(titles).toHaveLength(3);
  });
});

describe('filtro por etiqueta y paginación en una búsqueda', () => {
  it('q y tag se combinan', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'presupuesto', ['Casa']);
    await addNote(client, 'B', 'presupuesto', ['Trabajo']);
    await addNote(client, 'C', 'otra cosa', ['Casa']);
    const { items } = await listNotes(client, { q: 'presupuesto', tag: 'casa' });
    expect(items.map((i) => i.title)).toEqual(['A']);
  });

  it('pagina por relevancia sin repetir ni saltarse resultados', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    // Mezcla de relevancias (título / cuerpo / dos veces) y de fechas.
    const specs: [string, string][] = [
      ['Presupuesto uno', ''],
      ['Dos', 'presupuesto'],
      ['Tres', 'presupuesto y presupuesto'],
      ['Presupuesto cuatro', 'presupuesto'],
      ['Cinco', 'presupuesto'],
      ['Seis', 'presupuesto'],
      ['Siete', 'el presupuesto'],
    ];
    for (const [title, body] of specs) {
      await addNote(client, title, body);
      ctx.t.clock.advance(1_000);
    }
    const all = (await listNotes(client, { q: 'presupuesto', limit: 100 })).items.map(
      (i) => i.title,
    );
    expect(all).toHaveLength(specs.length);

    const paged: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listNotes(client, {
        q: 'presupuesto',
        limit: 3,
        ...(cursor === null ? {} : { cursor }),
      });
      paged.push(...page.items.map((i) => i.title));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(paged).toEqual(all);
  });

  it('un cursor de la lista sin búsqueda no vale en una búsqueda, ni al revés → 400', async () => {
    const client = await getCtx().loggedIn();
    for (const n of [1, 2, 3]) await addNote(client, `Nota ${n}`, 'presupuesto');
    const recent = await listNotes(client, { limit: 1 });
    const ranked = await listNotes(client, { q: 'presupuesto', limit: 1 });
    const path = (params: Record<string, string>): string =>
      `${NOTES}?${new URLSearchParams(params).toString()}`;
    expectProblem(
      await client.get(path({ q: 'presupuesto', cursor: recent.nextCursor ?? '' })),
      400,
      'VALIDATION_ERROR',
    );
    expectProblem(
      await client.get(path({ cursor: ranked.nextCursor ?? '' })),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('fragmentos resaltados: texto, nunca HTML', () => {
  it('devuelve tramos de texto con las coincidencias marcadas', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'Antes de todo, el presupuesto familiar y después más cosas');
    const [item] = (await listNotes(client, { q: 'presupuesto' })).items;
    const snippet = item?.snippet ?? [];
    expect(snippet.filter((f) => f.match).map((f) => f.text)).toEqual(['presupuesto']);
    expect(snippet.map((f) => f.text).join('')).toContain('el presupuesto familiar');
  });

  it('marca las formas lematizadas y los prefijos tal como aparecen en el texto', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'Los Presupuestos de la Acción pendiente');
    const [item] = (await listNotes(client, { q: 'presupuesto accion' })).items;
    expect(item?.snippet?.filter((f) => f.match).map((f) => f.text)).toEqual([
      'Presupuestos',
      'Acción',
    ]);
    const [partial] = (await listNotes(client, { q: 'presup' })).items;
    expect(partial?.snippet?.filter((f) => f.match).map((f) => f.text)).toEqual(['Presupuestos']);
  });

  it('con un <script> y un <img onerror> en el cuerpo, la API devuelve solo texto y no añade ningún marcado', async () => {
    const client = await getCtx().loggedIn();
    const body = '<script>alert(1)</script> el presupuesto <img src=x onerror=alert(1)>';
    await addNote(client, 'Con HTML', body);
    const res = await client.get(`${NOTES}?q=presupuesto`);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/^application\/json/u);

    const { items } = noteListResponseSchema.parse(res.body);
    const snippet = items[0]?.snippet ?? [];
    // Solo «presupuesto» está marcado, y el marcado nunca arrastra HTML del texto.
    expect(snippet.filter((f) => f.match)).toEqual([{ text: 'presupuesto', match: true }]);
    // PostgreSQL puede recortar el fragmento o quitar alguna etiqueta que reconoce, pero lo que deja pasa
    // como texto: la protección es que la web lo pinte como nodo de texto, nunca como HTML.
    // La API no ha añadido marcado propio (ni el <b> por defecto de ts_headline ni <mark>) ni marcas privadas.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/<\/?(b|mark|em|strong)>/u);
    expect(raw).not.toContain(MATCH_START);
    expect(raw).not.toContain(MATCH_END);
  });

  it('sin ningún carácter < ni > en la nota, el fragmento tampoco los tiene: nada se inyecta', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'Antes de todo, el presupuesto familiar y después más cosas');
    const [item] = (await listNotes(client, { q: 'presupuesto' })).items;
    const text = (item?.snippet ?? []).map((f) => f.text).join('');
    expect(text).toMatch(/presupuesto/u);
    expect(text).not.toMatch(/[<>]/u);
  });

  it('una etiqueta HTML alrededor de la coincidencia no entra en el tramo marcado', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', 'una <b>presupuesto</b> en negrita');
    const [item] = (await listNotes(client, { q: 'presupuesto' })).items;
    expect(item?.snippet?.filter((f) => f.match)).toEqual([{ text: 'presupuesto', match: true }]);
  });

  it('un cuerpo que contiene las marcas privadas no produce resaltados falsos', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, 'A', `${MATCH_START}hola${MATCH_END} el presupuesto`);
    const [item] = (await listNotes(client, { q: 'presupuesto' })).items;
    const snippet = item?.snippet ?? [];
    expect(snippet.filter((f) => f.match).map((f) => f.text)).toEqual(['presupuesto']);
    for (const { text } of snippet) {
      expect(text).not.toContain(MATCH_START);
      expect(text).not.toContain(MATCH_END);
    }
  });

  it('un título con <script> se devuelve como cadena y el cuerpo vacío no rompe el fragmento', async () => {
    const client = await getCtx().loggedIn();
    await addNote(client, '<script>alert(1)</script> presupuesto', '');
    const { items } = await listNotes(client, { q: 'presupuesto' });
    expect(items[0]?.title).toBe('<script>alert(1)</script> presupuesto');
    expect(items[0]?.snippet).toEqual([]);
  });

  it('un cuerpo largo da fragmentos cortos alrededor de la coincidencia, no todo el texto', async () => {
    const client = await getCtx().loggedIn();
    const body = `${'relleno '.repeat(2_000)} el presupuesto ${'más relleno '.repeat(2_000)}`;
    await addNote(client, 'Largo', body);
    const [item] = (await listNotes(client, { q: 'presupuesto' })).items;
    const text = (item?.snippet ?? []).map((f) => f.text).join('');
    expect(text.length).toBeLessThan(400);
    expect(item?.snippet?.some((f) => f.match && f.text === 'presupuesto')).toBe(true);
  });
});
