// @vitest-environment jsdom
/**
 * Tablero de tareas con la API simulada en memoria: mover con teclado, con menú y arrastrando; revertir si
 * el servidor lo rechaza; vencidas; borrado; «Ver más»; cronómetro y tiempo manual.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksPage } from '../src/tasks/TasksPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATUSES = ['todo', 'in_progress', 'testing', 'done'] as const;
type Status = (typeof STATUSES)[number];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface FakeTask {
  id: string;
  title: string;
  status: Status;
  dueOn: string | null;
  completedAt: string | null;
  timeSpentSeconds: number;
  timerStartedAt: string | null;
}

const fakeTask = (n: number, status: Status, extra: Partial<FakeTask> = {}): FakeTask => ({
  id: id(n),
  title: `Tarea ${String(n)}`,
  status,
  dueOn: null,
  completedAt:
    status === 'done' ? `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00.000Z` : null,
  timeSpentSeconds: 0,
  timerStartedAt: null,
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problem = (status: number, code: string, detail: string) =>
  json({ type: 'about:blank', title: detail, status, detail, code }, status);

interface Fake {
  tasks: FakeTask[];
  entries: Record<string, unknown>[];
  /** Respuesta forzada para una petición `MÉTODO ruta`. */
  overrides: Record<string, () => Response>;
  calls: { key: string; body: unknown }[];
}

const entryOf = (taskId: string, startedAt: string | null | undefined) => ({
  id: id(900),
  taskId,
  startedAt: startedAt ?? '2026-11-09T10:00:00.000Z',
  endedAt: null,
  durationSeconds: 0,
});

/** API en memoria: lo justo del tablero y del tiempo para ejercitar la pantalla. */
function stubApi(tasks: FakeTask[], overrides: Fake['overrides'] = {}): Fake {
  const fake: Fake = { tasks, entries: [], overrides, calls: [] };
  const wire = (t: FakeTask) => ({
    id: t.id,
    title: t.title,
    descriptionMd: null,
    status: t.status,
    position: 0,
    dueOn: t.dueOn,
    completedAt: t.completedAt,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    timeSpentSeconds: t.timeSpentSeconds,
    timerStartedAt: t.timerStartedAt,
  });
  const find = (taskId: string | undefined) => fake.tasks.find((t) => t.id === taskId);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/v1', '').split('?')[0] ?? '';
      const method = init?.method ?? 'GET';
      const key = `${method} ${path}`;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fake.calls.push({ key, body });
      const forced = fake.overrides[key];
      if (forced !== undefined) return Promise.resolve(forced());
      if (key === 'GET /tasks') {
        return Promise.resolve(
          json({
            columns: STATUSES.map((status) => ({
              status,
              tasks: fake.tasks.filter((t) => t.status === status).map(wire),
            })),
          }),
        );
      }
      const move = /^POST \/tasks\/([^/]+)\/move$/u.exec(key);
      if (move !== null) {
        const task = find(move[1]);
        if (task !== undefined) task.status = (body as { status: Status }).status;
        return Promise.resolve(json({ task: wire(task ?? fake.tasks[0]!), columns: [] }));
      }
      const start = /^POST \/tasks\/([^/]+)\/timer\/start$/u.exec(key);
      if (start !== null) {
        const task = find(start[1]);
        if (task !== undefined) task.timerStartedAt = new Date().toISOString();
        return Promise.resolve(json(entryOf(start[1] ?? '', task?.timerStartedAt), 201));
      }
      const stop = /^POST \/tasks\/([^/]+)\/timer\/stop$/u.exec(key);
      if (stop !== null) {
        const task = find(stop[1]);
        if (task !== undefined) task.timerStartedAt = null;
        return Promise.resolve(
          json({
            ...entryOf(stop[1] ?? '', null),
            endedAt: '2026-11-09T10:05:00.000Z',
            durationSeconds: 300,
          }),
        );
      }
      if (/^GET \/tasks\/[^/]+\/time-entries$/u.test(key)) {
        return Promise.resolve(json({ items: fake.entries }));
      }
      if (/^POST \/tasks\/[^/]+\/time-entries$/u.test(key)) {
        return Promise.resolve(
          json(
            {
              ...entryOf(id(1), '2026-11-09T08:30:00.000Z'),
              id: id(901),
              endedAt: '2026-11-09T10:00:00.000Z',
              durationSeconds: 5400,
            },
            201,
          ),
        );
      }
      const del = /^DELETE \/tasks\/([^/]+)$/u.exec(key);
      if (del !== null) fake.tasks = fake.tasks.filter((t) => t.id !== del[1]);
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return fake;
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPage />
    </QueryClientProvider>,
  );
}

const column = (name: string) => screen.getByRole('region', { name: new RegExp(name, 'u') });
const titlesIn = (name: string) =>
  within(column(name))
    .queryAllByRole('heading', { level: 3 })
    .map((h) => h.textContent);

describe('mover tarjetas', () => {
  it('con el teclado: coger con Espacio, flecha derecha a «En curso» y soltar', async () => {
    const fake = stubApi([fakeTask(1, 'todo'), fakeTask(2, 'todo')]);
    renderBoard();
    await screen.findByText('Tarea 1');
    const user = userEvent.setup();

    screen.getByRole('button', { name: 'Reordenar «Tarea 1»' }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('status').textContent).toContain('cogida en Por hacer');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status').textContent).toContain('En curso');
    // Mientras está cogida, ya se ve en la columna nueva y conserva el foco.
    expect(titlesIn('En curso')).toEqual(['Tarea 1']);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Reordenar «Tarea 1»' }),
    );
    await user.keyboard(' ');

    await vi.waitFor(() =>
      expect(fake.calls.find((c) => c.key === `POST /tasks/${id(1)}/move`)?.body).toEqual({
        status: 'in_progress',
      }),
    );
    expect(await screen.findByText(/movida a En curso/u)).toBeTruthy();
    expect(titlesIn('En curso')).toEqual(['Tarea 1']);
  });

  it('con el teclado: flecha abajo reordena dentro de la columna y Escape cancela sin pedir nada', async () => {
    const fake = stubApi([fakeTask(1, 'todo'), fakeTask(2, 'todo')]);
    renderBoard();
    await screen.findByText('Tarea 1');
    const user = userEvent.setup();

    screen.getByRole('button', { name: 'Reordenar «Tarea 1»' }).focus();
    await user.keyboard(' {ArrowDown}');
    expect(screen.getByRole('status').textContent).toContain('posición 2 de 2');
    expect(titlesIn('Por hacer')).toEqual(['Tarea 2', 'Tarea 1']);
    await user.keyboard('{Escape}');
    expect(titlesIn('Por hacer')).toEqual(['Tarea 1', 'Tarea 2']);
    expect(fake.calls.some((c) => c.key.endsWith('/move'))).toBe(false);
  });

  it('si el servidor rechaza el movimiento, la tarjeta vuelve a su sitio y se muestra el error', async () => {
    stubApi([fakeTask(1, 'todo'), fakeTask(2, 'in_progress')], {
      [`POST /tasks/${id(1)}/move`]: () =>
        problem(422, 'UNPROCESSABLE', 'La referencia no está en la columna de destino'),
    });
    renderBoard();
    await screen.findByText('Tarea 1');
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Mover «Tarea 1» a…' }),
      'En prueba',
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No se pudo mover la tarea');
    expect(alert.textContent).toContain('devuelto a su sitio');
    expect(titlesIn('Por hacer')).toEqual(['Tarea 1']);
    expect(titlesIn('En prueba')).toEqual([]);
  });

  it('con el menú «Mover a…» la tarjeta cambia de columna', async () => {
    const fake = stubApi([fakeTask(1, 'todo')]);
    renderBoard();
    await screen.findByText('Tarea 1');
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Mover «Tarea 1» a…' }), 'Terminado');
    await vi.waitFor(() =>
      expect(fake.calls.find((c) => c.key.endsWith('/move'))?.body).toEqual({ status: 'done' }),
    );
    expect(await screen.findByText(/movida a Terminado/u)).toBeTruthy();
  });

  it('arrastrando con el ratón a otra columna', async () => {
    const fake = stubApi([fakeTask(1, 'todo'), fakeTask(2, 'testing')]);
    renderBoard();
    await screen.findByText('Tarea 1');
    const card = screen.getByText('Tarea 1').closest('li')!;
    const target = column('En prueba');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    await vi.waitFor(() =>
      expect(fake.calls.find((c) => c.key === `POST /tasks/${id(1)}/move`)?.body).toEqual({
        status: 'testing',
        afterId: id(2),
      }),
    );
  });
});

describe('vencidas', () => {
  it('se marcan con texto, no solo con color, y las terminadas o de fecha futura no', async () => {
    stubApi([
      fakeTask(1, 'todo', { dueOn: '2000-01-01' }),
      fakeTask(2, 'todo', { dueOn: '2999-12-31' }),
      fakeTask(3, 'done', { dueOn: '2000-01-01' }),
    ]);
    renderBoard();
    await screen.findByText('Tarea 1');
    expect(screen.getAllByText(/Vencida:/u)).toHaveLength(1);
    expect(within(column('Por hacer')).getByText(/Vencida: 01\/01\/2000/u)).toBeTruthy();
    expect(screen.getByText(/Fecha límite: 31\/12\/2999/u)).toBeTruthy();
  });
});

describe('borrar y «Terminado»', () => {
  it('avisa de que también se borra el tiempo dedicado y no borra hasta confirmar', async () => {
    const fake = stubApi([fakeTask(1, 'todo', { timeSpentSeconds: 3725 })]);
    renderBoard();
    await screen.findByText('Tarea 1');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Borrar «Tarea 1»/u }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('También se borra el tiempo dedicado (1 h 02 min 05 s)');
    expect(fake.calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'Borrar tarea' }));
    await vi.waitFor(() =>
      expect(fake.calls.some((c) => c.key === `DELETE /tasks/${id(1)}`)).toBe(true),
    );
    await vi.waitFor(() => expect(screen.queryByText('Tarea 1')).toBeNull());
  });

  it('«Terminado» muestra las 10 más recientes y «Ver más» añade el resto', async () => {
    const done = Array.from({ length: 12 }, (_, i) => fakeTask(i + 1, 'done'));
    stubApi(done);
    renderBoard();
    await screen.findByText('Tarea 12');
    expect(titlesIn('Terminado')).toHaveLength(10);
    // Las más recientes (cierre mayor) primero; las dos más antiguas quedan ocultas.
    expect(titlesIn('Terminado')[0]).toBe('Tarea 12');
    expect(screen.queryByText('Tarea 1')).toBeNull();
    expect(screen.getByRole('heading', { name: /Terminado \(12\)/u })).toBeTruthy();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Ver más \(2 más antiguas\)/u }));
    expect(titlesIn('Terminado')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /Ver más/u })).toBeNull();
  });
});

describe('cronómetro', () => {
  it('inicia y para, con el tiempo en marcha visible y avisos', async () => {
    const fake = stubApi([fakeTask(1, 'todo')]);
    renderBoard();
    await screen.findByText('Tarea 1');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Iniciar cronómetro/u }));
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toContain('En marcha');
    expect(screen.getByRole('status').textContent).toContain('Cronómetro iniciado en «Tarea 1»');

    await user.click(screen.getByRole('button', { name: /Parar cronómetro/u }));
    await vi.waitFor(() => expect(screen.queryByRole('timer')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('Cronómetro parado');
    expect(screen.getByRole('status').textContent).toContain('5 min 00 s');
    expect(fake.calls.filter((c) => c.key.includes('/timer/')).map((c) => c.key)).toEqual([
      `POST /tasks/${id(1)}/timer/start`,
      `POST /tasks/${id(1)}/timer/stop`,
    ]);
  });

  it('si ya hay otro en marcha, explica cuál sin llamar al servidor', async () => {
    const fake = stubApi([
      fakeTask(1, 'todo'),
      fakeTask(2, 'in_progress', { timerStartedAt: new Date().toISOString() }),
    ]);
    renderBoard();
    await screen.findByText('Tarea 1');

    await userEvent
      .setup()
      .click(within(column('Por hacer')).getByRole('button', { name: /Iniciar cronómetro/u }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Ya hay un cronómetro en marcha en «Tarea 2»',
    );
    expect(fake.calls.some((c) => c.key.includes('/timer/start'))).toBe(false);
  });

  it('un 409 del servidor al iniciar se explica en español', async () => {
    stubApi([fakeTask(1, 'todo')], {
      [`POST /tasks/${id(1)}/timer/start`]: () =>
        problem(409, 'CONFLICT', 'Ya hay un cronómetro en marcha'),
    });
    renderBoard();
    await screen.findByText('Tarea 1');
    await userEvent.setup().click(screen.getByRole('button', { name: /Iniciar cronómetro/u }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Ya hay un cronómetro en marcha',
    );
  });
});

describe('tiempo manual', () => {
  async function openTime() {
    await screen.findByText('Tarea 1');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Tiempo de «Tarea 1»/u }));
    const panel = await screen.findByRole('region', { name: /Tiempo dedicado a Tarea 1/u });
    return { user, panel };
  }

  it('lista las entradas con su total y permite borrarlas', async () => {
    const fake = stubApi([fakeTask(1, 'todo', { timeSpentSeconds: 600 })]);
    fake.entries = [
      {
        id: id(800),
        taskId: id(1),
        startedAt: '2026-11-08T09:00:00.000Z',
        endedAt: '2026-11-08T09:10:00.000Z',
        durationSeconds: 600,
      },
    ];
    renderBoard();
    const { user, panel } = await openTime();
    expect(panel.textContent).toContain('Total: 10 min 00 s');
    expect(await within(panel).findAllByText('10 min 00 s')).toHaveLength(2);

    await user.click(within(panel).getByRole('button', { name: /Borrar la entrada/u }));
    await vi.waitFor(() =>
      expect(fake.calls.some((c) => c.key === `DELETE /time-entries/${id(800)}`)).toBe(true),
    );
  });

  it('añade una duración como tiempo terminado ahora', async () => {
    const fake = stubApi([fakeTask(1, 'todo')]);
    renderBoard();
    const { user, panel } = await openTime();

    await user.type(within(panel).getByLabelText('Horas'), '1');
    await user.type(within(panel).getByLabelText('Minutos'), '30');
    await user.click(within(panel).getByRole('button', { name: 'Añadir tiempo' }));

    await vi.waitFor(() => {
      const call = fake.calls.find((c) => c.key === `POST /tasks/${id(1)}/time-entries`);
      expect(call?.body).toMatchObject({ durationSeconds: 5400 });
    });
    expect(await within(panel).findByText('Tiempo añadido')).toBeTruthy();
  });

  it('añade inicio y fin y valida que el fin sea posterior', async () => {
    const fake = stubApi([fakeTask(1, 'todo')]);
    renderBoard();
    const { user, panel } = await openTime();

    await user.click(within(panel).getByRole('radio', { name: 'Inicio y fin' }));
    fireEvent.change(within(panel).getByLabelText(/^Inicio(?! y)/u), {
      target: { value: '2026-11-09T10:00' },
    });
    fireEvent.change(within(panel).getByLabelText(/^Fin/u), {
      target: { value: '2026-11-09T09:00' },
    });
    await user.click(within(panel).getByRole('button', { name: 'Añadir tiempo' }));
    expect(within(panel).getByText('El fin debe ser posterior al inicio')).toBeTruthy();
    expect(
      fake.calls.some((c) => c.key.startsWith('POST') && c.key.endsWith('/time-entries')),
    ).toBe(false);

    fireEvent.change(within(panel).getByLabelText(/^Fin/u), {
      target: { value: '2026-11-09T11:00' },
    });
    await user.click(within(panel).getByRole('button', { name: 'Añadir tiempo' }));
    await vi.waitFor(() => {
      const body = fake.calls.find((c) => c.key === `POST /tasks/${id(1)}/time-entries`)?.body as {
        startedAt: string;
        endedAt: string;
      };
      expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(3_600_000);
    });
  });

  it('explica el 409 (solape) y el 422 (futuro) en español', async () => {
    let status = 409;
    stubApi([fakeTask(1, 'todo')], {
      [`POST /tasks/${id(1)}/time-entries`]: () =>
        status === 409
          ? problem(409, 'CONFLICT', 'El intervalo se solapa con otra anotación')
          : problem(422, 'UNPROCESSABLE', 'La anotación no puede terminar en el futuro'),
    });
    renderBoard();
    const { user, panel } = await openTime();
    await user.type(within(panel).getByLabelText('Minutos'), '15');

    await user.click(within(panel).getByRole('button', { name: 'Añadir tiempo' }));
    expect((await within(panel).findByRole('alert')).textContent).toContain('se solapa');

    status = 422;
    await user.click(within(panel).getByRole('button', { name: 'Añadir tiempo' }));
    await vi.waitFor(() =>
      expect(within(panel).getByRole('alert').textContent).toContain(
        'no puede terminar en el futuro',
      ),
    );
  });
});
