// @vitest-environment jsdom
/**
 * Pantalla de notas con la API simulada en memoria: lista y «Cargar más», búsqueda con el resaltado
 * pintado como texto, filtro y renombrado de etiquetas (409), editor con vista previa, unión de
 * etiquetas por mayúsculas, aviso de cambios sin guardar y borrado con confirmación.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteEditorPage } from '../src/notes/NoteEditorPage.tsx';
import { NotesPage } from '../src/notes/NotesPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAMP = '2026-11-09T10:00:00.000Z';

interface FakeNote {
  id: string;
  title: string;
  bodyMd: string;
  tags: { id: string; name: string }[];
}
interface FakeTag {
  id: string;
  name: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const problem = (status: number, code: string, detail: string) =>
  json({ type: 'about:blank', title: detail, status, detail, code }, status);

interface Fake {
  notes: FakeNote[];
  tags: FakeTag[];
  /** Fragmento que devuelve la API cuando hay búsqueda. */
  snippet: { text: string; match: boolean }[];
  calls: { key: string; query: URLSearchParams; body: unknown }[];
}

const note = (n: number, extra: Partial<FakeNote> = {}): FakeNote => ({
  id: id(n),
  title: `Nota ${String(n)}`,
  bodyMd: `Cuerpo ${String(n)}`,
  tags: [],
  ...extra,
});

function stubApi(notes: FakeNote[], tags: FakeTag[] = []): Fake {
  const fake: Fake = { notes, tags, snippet: [], calls: [] };
  const item = (n: FakeNote, withSnippet: boolean) => ({
    id: n.id,
    title: n.title,
    tags: n.tags,
    createdAt: STAMP,
    updatedAt: STAMP,
    preview: n.bodyMd.slice(0, 200),
    snippet: withSnippet ? fake.snippet : null,
  });
  const full = (n: FakeNote) => ({
    id: n.id,
    title: n.title,
    bodyMd: n.bodyMd,
    tags: n.tags,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  const resolveTags = (names: string[]) =>
    names.map((name) => {
      let tag = fake.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (tag === undefined) {
        tag = { id: id(500 + fake.tags.length), name };
        fake.tags.push(tag);
      }
      return tag;
    });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const [rawPath = '', rawQuery = ''] = url.replace('/api/v1', '').split('?');
      const method = init?.method ?? 'GET';
      const key = `${method} ${rawPath}`;
      const query = new URLSearchParams(rawQuery);
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fake.calls.push({ key, query, body });

      if (key === 'GET /notes') {
        // Paginación de pega: el cursor es el índice por el que seguir.
        const limit = Number(query.get('limit'));
        const from = Number(query.get('cursor') ?? '0');
        const q = query.get('q');
        const tag = query.get('tag')?.toLowerCase();
        const pool = fake.notes.filter(
          (n) => tag === undefined || n.tags.some((t) => t.name.toLowerCase() === tag),
        );
        const page = pool.slice(from, from + limit);
        const next = from + limit < pool.length ? String(from + limit) : null;
        return Promise.resolve(
          json({ items: page.map((n) => item(n, q !== null)), nextCursor: next }),
        );
      }
      if (key === 'GET /tags') {
        return Promise.resolve(
          json({
            items: fake.tags.map((t) => ({
              ...t,
              noteCount: fake.notes.filter((n) => n.tags.some((x) => x.id === t.id)).length,
            })),
          }),
        );
      }
      const tagPatch = /^PATCH \/tags\/([^/]+)$/u.exec(key);
      if (tagPatch !== null) {
        const wanted = (body as { name: string }).name;
        const target = fake.tags.find((t) => t.id === tagPatch[1]);
        if (fake.tags.some((t) => t !== target && t.name.toLowerCase() === wanted.toLowerCase())) {
          return Promise.resolve(problem(409, 'CONFLICT', 'Ya existe una etiqueta con ese nombre'));
        }
        if (target !== undefined) target.name = wanted;
        return Promise.resolve(json({ ...target, noteCount: 0 }));
      }
      if (key === 'POST /notes') {
        const request = body as { title: string; bodyMd: string; tags: string[] };
        const created: FakeNote = {
          id: id(100 + fake.notes.length),
          title: request.title,
          bodyMd: request.bodyMd,
          tags: resolveTags(request.tags),
        };
        fake.notes.unshift(created);
        return Promise.resolve(json(full(created), 201));
      }
      const one = /^(GET|PATCH|DELETE) \/notes\/([^/]+)$/u.exec(key);
      if (one !== null) {
        const target = fake.notes.find((n) => n.id === one[2]);
        if (target === undefined) return Promise.resolve(problem(404, 'NOT_FOUND', 'No existe'));
        if (one[1] === 'DELETE') {
          fake.notes = fake.notes.filter((n) => n !== target);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (one[1] === 'PATCH') {
          const patch = body as Partial<{ title: string; bodyMd: string; tags: string[] }>;
          if (patch.title !== undefined) target.title = patch.title;
          if (patch.bodyMd !== undefined) target.bodyMd = patch.bodyMd;
          if (patch.tags !== undefined) target.tags = resolveTags(patch.tags);
        }
        return Promise.resolve(json(full(target)));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return fake;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/notas', element: <NotesPage /> },
      { path: '/notas/nueva', element: <NoteEditorPage /> },
      { path: '/notas/:id', element: <NoteEditorPage /> },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('lista', () => {
  it('muestra título, etiquetas y fecha, y explica el alcance de la búsqueda', async () => {
    stubApi([note(1, { tags: [{ id: id(501), name: 'Casa' }] })], [{ id: id(501), name: 'Casa' }]);
    renderAt('/notas');
    const list = await screen.findByRole('list', { name: 'Notas' });
    expect(within(list).getByRole('link', { name: 'Nota 1' })).toBeTruthy();
    expect(within(list).getByText('Casa')).toBeTruthy();
    expect(list.querySelector('time')?.textContent).toMatch(/09\/11\/2026/u);
    expect(screen.getByText(/palabras completas o su principio/u)).toBeTruthy();
  });

  it('«Cargar más» pide la página siguiente con el cursor de la API', async () => {
    const many = Array.from({ length: 25 }, (_, i) => note(i + 1));
    const fake = stubApi(many);
    const user = userEvent.setup();
    renderAt('/notas');
    const list = await screen.findByRole('list', { name: 'Notas' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25));
    const pages = fake.calls.filter((c) => c.key === 'GET /notes');
    expect(pages.at(-1)?.query.get('cursor')).toBe('20');
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('sin notas lo dice', async () => {
    stubApi([]);
    renderAt('/notas');
    expect(await screen.findByText(/Aún no hay notas/u)).toBeTruthy();
  });
});

describe('búsqueda', () => {
  it('pinta los fragmentos como texto, con <mark> en las coincidencias', async () => {
    const fake = stubApi([note(1)]);
    fake.snippet = [
      { text: 'revisar el ', match: false },
      { text: 'presupuesto', match: true },
      { text: ' de <b>marzo</b>', match: false },
    ];
    const user = userEvent.setup();
    renderAt('/notas');
    await screen.findByRole('list', { name: 'Notas' });
    await user.type(screen.getByLabelText('Buscar'), 'presup');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const mark = await screen.findByText('presupuesto');
    expect(mark.tagName).toBe('MARK');
    // El «<b>» del texto no se interpreta: se ve literal y no hay ningún <b>.
    const list = screen.getByRole('list', { name: 'Notas' });
    expect(list.querySelector('b')).toBeNull();
    expect(list.textContent).toContain('de <b>marzo</b>');
    const last = fake.calls.filter((c) => c.key === 'GET /notes').at(-1);
    expect(last?.query.get('q')).toBe('presup');
  });

  it('un fragmento con <script> o <img onerror> sale como texto, también dentro del <mark>', async () => {
    const fake = stubApi([note(1)]);
    fake.snippet = [
      { text: '<script>alert(1)</script> ', match: false },
      { text: '<img src=x onerror=alert(2)>', match: true },
    ];
    const user = userEvent.setup();
    renderAt('/notas');
    await screen.findByRole('list', { name: 'Notas' });
    await user.type(screen.getByLabelText('Buscar'), 'alert');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const mark = await screen.findByText('<img src=x onerror=alert(2)>');
    expect(mark.tagName).toBe('MARK');
    const list = screen.getByRole('list', { name: 'Notas' });
    expect(list.querySelector('script, img, [onerror]')).toBeNull();
    expect(list.textContent).toContain('<script>alert(1)</script>');
  });

  it('un texto sin letras ni cifras no se envía a la API', async () => {
    const fake = stubApi([note(1)]);
    const user = userEvent.setup();
    renderAt('/notas');
    await screen.findByRole('list', { name: 'Notas' });
    await user.type(screen.getByLabelText('Buscar'), '???');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(fake.calls.every((c) => c.query.get('q') === null)).toBe(true);
  });

  it('el filtro por etiqueta envía su nombre', async () => {
    const casa = { id: id(501), name: 'Casa' };
    const fake = stubApi([note(1, { tags: [casa] }), note(2)], [casa]);
    const user = userEvent.setup();
    renderAt('/notas');
    await screen.findByRole('list', { name: 'Notas' });
    await user.selectOptions(await screen.findByLabelText('Etiqueta'), 'Casa');
    await waitFor(() => {
      const list = screen.getByRole('list', { name: 'Notas' });
      expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
      expect(within(list).queryByText('Nota 2')).toBeNull();
    });
    expect(
      fake.calls
        .filter((c) => c.key === 'GET /notes')
        .at(-1)
        ?.query.get('tag'),
    ).toBe('Casa');
  });
});

describe('etiquetas', () => {
  it('renombrar a un nombre que ya existe muestra el 409 en español y no cierra el campo', async () => {
    stubApi(
      [],
      [
        { id: id(501), name: 'Casa' },
        { id: id(502), name: 'Trabajo' },
      ],
    );
    const user = userEvent.setup();
    renderAt('/notas');
    await user.click(await screen.findByRole('button', { name: 'Gestionar etiquetas' }));
    await user.click(await screen.findByRole('button', { name: 'Renombrar la etiqueta Casa' }));
    const input = screen.getByLabelText(/Nuevo nombre de «Casa»/u);
    await user.clear(input);
    await user.type(input, 'trabajo');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Ya existe otra etiqueta con ese nombre/u);
    expect(screen.getByLabelText(/Nuevo nombre de «Casa»/u)).toBeTruthy();
  });

  it('renombrar bien actualiza la lista', async () => {
    const fake = stubApi([], [{ id: id(501), name: 'Casa' }]);
    const user = userEvent.setup();
    renderAt('/notas');
    await user.click(await screen.findByRole('button', { name: 'Gestionar etiquetas' }));
    await user.click(await screen.findByRole('button', { name: 'Renombrar la etiqueta Casa' }));
    const input = screen.getByLabelText(/Nuevo nombre de «Casa»/u);
    await user.clear(input);
    await user.type(input, 'Hogar');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('button', { name: 'Renombrar la etiqueta Hogar' })).toBeTruthy();
    expect(fake.tags[0]?.name).toBe('Hogar');
  });
});

describe('editor', () => {
  it('la vista previa de lo escrito no ejecuta nada y se puede volver a escribir', async () => {
    stubApi([]);
    const user = userEvent.setup();
    renderAt('/notas/nueva');
    await user.type(await screen.findByLabelText('Título'), 'XSS');
    await user.click(screen.getByLabelText('Texto en Markdown'));
    await user.paste('# Hola\n\n<script>alert(1)</script> [x](javascript:alert(2))');
    await user.click(screen.getByRole('tab', { name: 'Vista previa' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: 'Hola' })).toBeTruthy();
    expect(panel.querySelector('script, a')).toBeNull();
    expect(panel.textContent).toContain('<script>alert(1)</script>');
    await user.click(screen.getByRole('tab', { name: 'Escribir' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Texto en Markdown').value).toContain(
      '# Hola',
    );
  });

  it('las etiquetas que solo difieren en mayúsculas se unen y se envía una sola', async () => {
    const fake = stubApi([], [{ id: id(501), name: 'Casa' }]);
    const user = userEvent.setup();
    const router = renderAt('/notas/nueva');
    await user.type(await screen.findByLabelText('Título'), 'Con etiquetas');
    const tags = screen.getByRole('combobox');
    await user.type(tags, 'casa{Enter}');
    await user.type(tags, 'CASA{Enter}');
    await user.type(tags, 'Nueva{Enter}');
    await user.type(tags, 'nueva{Enter}');
    expect(screen.getAllByRole('button', { name: /Quitar la etiqueta/u })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/notas\/0000/u));
    const post = fake.calls.find((c) => c.key === 'POST /notes');
    // «casa» se resolvió a la grafía existente («Casa»).
    expect((post?.body as { tags: string[] }).tags).toEqual(['Casa', 'Nueva']);
  });

  it('el autocompletado funciona con el teclado: ↓ y Enter eligen una etiqueta existente', async () => {
    stubApi(
      [],
      [
        { id: id(501), name: 'Casa' },
        { id: id(502), name: 'Coche' },
      ],
    );
    const user = userEvent.setup();
    renderAt('/notas/nueva');
    const input = await screen.findByRole('combobox');
    await screen.findByLabelText('Título');
    await user.click(input);
    await user.keyboard('c');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]?.id);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Quitar la etiqueta Coche' })).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('avisa antes de salir con cambios sin guardar y permite quedarse o salir', async () => {
    stubApi([note(1)]);
    const user = userEvent.setup();
    const router = renderAt(`/notas/${id(1)}`);
    const title = await screen.findByLabelText('Título');
    await user.type(title, ' editado');
    await user.click(screen.getByRole('link', { name: 'Volver a las notas' }));
    const warning = await screen.findByRole('alertdialog', { name: 'Cambios sin guardar' });
    expect(router.state.location.pathname).toBe(`/notas/${id(1)}`);
    await user.click(within(warning).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByRole('alertdialog', { name: 'Cambios sin guardar' })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Título').value).toBe('Nota 1 editado');

    await user.click(screen.getByRole('link', { name: 'Volver a las notas' }));
    await user.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notas'));
  });

  it('sin cambios no avisa, y tras guardar tampoco', async () => {
    const fake = stubApi([note(1)]);
    const user = userEvent.setup();
    const router = renderAt(`/notas/${id(1)}`);
    await screen.findByLabelText('Título');
    await user.click(screen.getByRole('link', { name: 'Volver a las notas' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notas'));

    await router.navigate(`/notas/${id(1)}`);
    await user.type(await screen.findByLabelText('Título'), '!');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText('Nota guardada.');
    expect(fake.calls.find((c) => c.key === `PATCH /notes/${id(1)}`)?.body).toEqual({
      title: 'Nota 1!',
    });
    await user.click(screen.getByRole('link', { name: 'Volver a las notas' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notas'));
  });

  it('con cambios sin guardar el navegador también avisa al cerrar la pestaña', async () => {
    stubApi([note(1)]);
    const user = userEvent.setup();
    renderAt(`/notas/${id(1)}`);
    await user.type(await screen.findByLabelText('Título'), 'x');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('borrar pide confirmación y no borra si se cancela', async () => {
    const fake = stubApi([note(1)]);
    const user = userEvent.setup();
    const router = renderAt(`/notas/${id(1)}`);
    await screen.findByLabelText('Título');
    await user.click(screen.getByRole('button', { name: 'Borrar' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(fake.calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Borrar' }));
    await user.click(await screen.findByRole('button', { name: 'Borrar la nota' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notas'));
    expect(fake.notes).toHaveLength(0);
  });

  it('una nota que no existe lo dice', async () => {
    stubApi([]);
    renderAt(`/notas/${id(9)}`);
    expect(await screen.findByText('La nota no existe o se borró.')).toBeTruthy();
  });
});
