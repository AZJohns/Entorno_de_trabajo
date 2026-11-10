/**
 * Tareas en la API (`/tasks`): contra la base de datos real. Cubre el alta, la edición, el borrado, el
 * tablero, los códigos de error (400, 404, 422) y, sobre todo, el orden: tras CADA movimiento (dentro
 * de una columna, entre columnas y varios a la vez) las posiciones de cada columna son exactamente
 * 0..n-1, comprobado leyendo la base de datos. Títulos inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TASK_STATUSES, taskResponseSchema, type TaskStatus } from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import { expectProblem } from '../support/ledger.ts';
import {
  TASKS,
  addTask,
  addTasks,
  expectConsecutivePositions,
  moveOk,
  moveTask,
  readBoard,
  resetTasks,
  titlesByColumn,
} from '../support/tasks.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetTasks(getCtx().database.db);
});

describe('alta', () => {
  it('crea la tarea en «Por hacer» y al final de la columna', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = await addTasks(client, ['A', 'B', 'C']);
    expect([a?.position, b?.position, c?.position]).toEqual([0, 1, 2]);
    expect(a).toMatchObject({
      title: 'A',
      status: 'todo',
      descriptionMd: null,
      dueOn: null,
      completedAt: null,
      timeSpentSeconds: 0,
      timerStartedAt: null,
    });
    await expectConsecutivePositions(getCtx().database.db);
  });

  it('cada columna numera desde 0', async () => {
    const client = await getCtx().loggedIn();
    await addTasks(client, ['A', 'B']);
    const other = await addTask(client, 'C', { status: 'testing' });
    expect(other.position).toBe(0);
  });

  it('guarda descripción y fecha límite; el texto vacío es «sin descripción»', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, '  Pagar la cuota  ', {
      descriptionMd: '**Antes** del viernes',
      dueOn: '2026-12-04',
    });
    expect(task).toMatchObject({
      title: 'Pagar la cuota',
      descriptionMd: '**Antes** del viernes',
      dueOn: '2026-12-04',
    });
    expect((await addTask(client, 'Otra', { descriptionMd: '   ' })).descriptionMd).toBeNull();
  });

  it('una tarea que nace en «Terminado» ya tiene fecha de finalización', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Hecha', { status: 'done' });
    expect(task.completedAt).toBe(getCtx().t.clock.now().toISOString());
  });

  it.each([
    ['título vacío', { title: '   ' }],
    ['título demasiado largo', { title: 'x'.repeat(201) }],
    ['sin título', {}],
    ['columna desconocida', { title: 'A', status: 'archivada' }],
    ['fecha inexistente', { title: 'A', dueOn: '2026-02-30' }],
    ['posición impuesta por el cliente', { title: 'A', position: 0 }],
    ['campo desconocido', { title: 'A', extra: true }],
  ])('400 con datos no válidos: %s', async (_name, body) => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.post(TASKS, body), 400, 'VALIDATION_ERROR');
    expect(await getCtx().database.db.selectFrom('tasks').select('id').execute()).toEqual([]);
  });
});

describe('lectura, edición y borrado', () => {
  it('lee una tarea; 404 si no existe y 400 si el identificador no es un UUID', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    const res = await client.get(`${TASKS}/${task.id}`);
    expect(res.status).toBe(200);
    expect(taskResponseSchema.parse(res.body)).toEqual(task);
    expectProblem(await client.get(`${TASKS}/${MISSING_ID}`), 404, 'NOT_FOUND');
    expectProblem(await client.get(`${TASKS}/no-es-un-uuid`), 400, 'VALIDATION_ERROR');
  });

  it('edita título, descripción y fecha límite sin tocar el resto', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const [a, b] = await addTasks(client, ['A', 'B']);
    ctx.t.clock.advance(60_000);
    const res = await client.patch(`${TASKS}/${b?.id ?? ''}`, {
      title: 'B renombrada',
      descriptionMd: 'Notas',
      dueOn: '2027-01-15',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(taskResponseSchema.parse(res.body)).toMatchObject({
      title: 'B renombrada',
      descriptionMd: 'Notas',
      dueOn: '2027-01-15',
      status: 'todo',
      position: 1,
      updatedAt: ctx.t.clock.now().toISOString(),
    });
    const fields = { title: 'A', dueOn: null, descriptionMd: null };
    expect(await client.get(`${TASKS}/${a?.id ?? ''}`)).toMatchObject({
      body: { ...fields, position: 0 },
    });
  });

  it('descriptionMd y dueOn a null los borran', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A', { descriptionMd: 'x', dueOn: '2026-12-04' });
    const res = await client.patch(`${TASKS}/${task.id}`, { descriptionMd: null, dueOn: null });
    expect(taskResponseSchema.parse(res.body)).toMatchObject({ descriptionMd: null, dueOn: null });
  });

  it.each([
    ['sin ningún campo', {}],
    ['con la columna (se mueve con /move)', { status: 'done' }],
    ['con la posición', { position: 3 }],
    ['título vacío', { title: '' }],
  ])('400 al editar %s', async (_name, body) => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    expectProblem(await client.patch(`${TASKS}/${task.id}`, body), 400, 'VALIDATION_ERROR');
  });

  it('404 al editar o borrar una tarea que no existe', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.patch(`${TASKS}/${MISSING_ID}`, { title: 'X' }), 404, 'NOT_FOUND');
    expectProblem(await client.delete(`${TASKS}/${MISSING_ID}`), 404, 'NOT_FOUND');
  });

  it('borrar una tarea cierra el hueco de su columna y no toca las demás', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = await addTasks(client, ['A', 'B', 'C']);
    await addTasks(client, ['X', 'Y'], 'testing');
    expect((await client.delete(`${TASKS}/${b?.id ?? ''}`)).status).toBe(204);
    expect(await titlesByColumn(client)).toMatchObject({ todo: ['A', 'C'], testing: ['X', 'Y'] });
    await expectConsecutivePositions(getCtx().database.db);
    expect((await client.get(`${TASKS}/${a?.id ?? ''}`)).body).toMatchObject({ position: 0 });
    expect((await client.get(`${TASKS}/${c?.id ?? ''}`)).body).toMatchObject({ position: 1 });
  });

  it('borrar la primera, la última y la única deja las posiciones consecutivas', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = await addTasks(client, ['A', 'B', 'C']);
    for (const task of [a, c, b]) {
      expect((await client.delete(`${TASKS}/${task?.id ?? ''}`)).status).toBe(204);
      await expectConsecutivePositions(getCtx().database.db);
    }
    expect(await titlesByColumn(client)).toEqual({
      todo: [],
      in_progress: [],
      testing: [],
      done: [],
    });
  });
});

describe('tablero', () => {
  it('devuelve las cuatro columnas en orden, cada una ordenada por posición', async () => {
    const client = await getCtx().loggedIn();
    await addTasks(client, ['A', 'B']);
    await addTasks(client, ['C'], 'done');
    const board = await readBoard(client);
    expect(board.columns.map((column) => column.status)).toEqual([...TASK_STATUSES]);
    expect(await titlesByColumn(client)).toEqual({
      todo: ['A', 'B'],
      in_progress: [],
      testing: [],
      done: ['C'],
    });
  });

  it('?status= devuelve solo esa columna', async () => {
    const client = await getCtx().loggedIn();
    await addTasks(client, ['A', 'B']);
    await addTasks(client, ['C'], 'done');
    const res = await client.get(`${TASKS}?status=done`);
    expect(res.status).toBe(200);
    const columns = (res.body as { columns: { status: string; tasks: { title: string }[] }[] })
      .columns;
    expect(columns).toHaveLength(1);
    expect(columns[0]?.status).toBe('done');
    expect(columns[0]?.tasks.map((task) => task.title)).toEqual(['C']);
  });

  it('400 con una columna desconocida o un parámetro desconocido', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(`${TASKS}?status=archivada`), 400, 'VALIDATION_ERROR');
    expectProblem(await client.get(`${TASKS}?orden=desc`), 400, 'VALIDATION_ERROR');
  });
});

describe('mover dentro de una columna', () => {
  it('delante de otra tarea, detrás de otra y al final', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c, d] = await addTasks(client, ['A', 'B', 'C', 'D']);
    const db = getCtx().database.db;

    await moveOk(client, d?.id ?? '', { status: 'todo', beforeId: a?.id });
    expect((await titlesByColumn(client)).todo).toEqual(['D', 'A', 'B', 'C']);
    await expectConsecutivePositions(db);

    await moveOk(client, d?.id ?? '', { status: 'todo', afterId: b?.id });
    expect((await titlesByColumn(client)).todo).toEqual(['A', 'B', 'D', 'C']);
    await expectConsecutivePositions(db);

    await moveOk(client, a?.id ?? '', { status: 'todo' });
    expect((await titlesByColumn(client)).todo).toEqual(['B', 'D', 'C', 'A']);
    await expectConsecutivePositions(db);

    await moveOk(client, c?.id ?? '', { status: 'todo', beforeId: b?.id });
    expect((await titlesByColumn(client)).todo).toEqual(['C', 'B', 'D', 'A']);
    await expectConsecutivePositions(db);
  });

  it('la respuesta trae el nuevo orden de la columna (una sola) y la tarea movida', async () => {
    const client = await getCtx().loggedIn();
    const [a, , c] = await addTasks(client, ['A', 'B', 'C']);
    const result = await moveOk(client, c?.id ?? '', { status: 'todo', beforeId: a?.id });
    expect(result.task).toMatchObject({ title: 'C', position: 0 });
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0]?.status).toBe('todo');
    expect(result.columns[0]?.tasks.map((task) => [task.title, task.position])).toEqual([
      ['C', 0],
      ['A', 1],
      ['B', 2],
    ]);
  });

  it('dejarla donde está no cambia nada', async () => {
    const client = await getCtx().loggedIn();
    const [a, b] = await addTasks(client, ['A', 'B', 'C']);
    await moveOk(client, b?.id ?? '', { status: 'todo', afterId: a?.id });
    expect((await titlesByColumn(client)).todo).toEqual(['A', 'B', 'C']);
    await moveOk(client, b?.id ?? '', { status: 'todo' });
    expect((await titlesByColumn(client)).todo).toEqual(['A', 'C', 'B']);
    await expectConsecutivePositions(getCtx().database.db);
  });

  it('una columna con una sola tarea', async () => {
    const client = await getCtx().loggedIn();
    const [a] = await addTasks(client, ['A']);
    const result = await moveOk(client, a?.id ?? '', { status: 'todo' });
    expect(result.task.position).toBe(0);
  });
});

describe('mover entre columnas', () => {
  it('entra en medio de la columna de destino y cierra el hueco de la de origen', async () => {
    const client = await getCtx().loggedIn();
    const [, b] = await addTasks(client, ['A', 'B', 'C']);
    const [, y] = await addTasks(client, ['X', 'Y'], 'in_progress');
    const result = await moveOk(client, b?.id ?? '', { status: 'in_progress', beforeId: y?.id });
    expect(await titlesByColumn(client)).toMatchObject({
      todo: ['A', 'C'],
      in_progress: ['X', 'B', 'Y'],
    });
    await expectConsecutivePositions(getCtx().database.db);
    // La respuesta trae las dos columnas afectadas, en el orden del tablero.
    expect(result.columns.map((column) => column.status)).toEqual(['todo', 'in_progress']);
    expect(result.task).toMatchObject({ title: 'B', status: 'in_progress', position: 1 });
  });

  it('al final de una columna vacía y de la primera a la última columna', async () => {
    const client = await getCtx().loggedIn();
    const [a, b] = await addTasks(client, ['A', 'B']);
    await moveOk(client, a?.id ?? '', { status: 'testing' });
    await moveOk(client, b?.id ?? '', { status: 'done' });
    expect(await titlesByColumn(client)).toEqual({
      todo: [],
      in_progress: [],
      testing: ['A'],
      done: ['B'],
    });
    await expectConsecutivePositions(getCtx().database.db);
  });

  it('detrás de una tarea de la columna de destino', async () => {
    const client = await getCtx().loggedIn();
    const [a] = await addTasks(client, ['A']);
    const [x] = await addTasks(client, ['X', 'Y'], 'testing');
    await moveOk(client, a?.id ?? '', { status: 'testing', afterId: x?.id });
    expect((await titlesByColumn(client)).testing).toEqual(['X', 'A', 'Y']);
    await expectConsecutivePositions(getCtx().database.db);
  });

  it('entrar en «Terminado» marca completedAt, salir lo borra y moverse dentro lo conserva', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const [a, b] = await addTasks(client, ['A', 'B']);
    const finishedAt = ctx.t.clock.now().toISOString();
    expect((await moveOk(client, a?.id ?? '', { status: 'done' })).task.completedAt).toBe(
      finishedAt,
    );
    await moveOk(client, b?.id ?? '', { status: 'done' });

    ctx.t.clock.advance(30 * 60_000);
    const within = await moveOk(client, a?.id ?? '', { status: 'done' });
    expect(within.task.completedAt).toBe(finishedAt);

    const out = await moveOk(client, a?.id ?? '', { status: 'testing' });
    expect(out.task.completedAt).toBeNull();
    expect(out.task.updatedAt).toBe(ctx.t.clock.now().toISOString());
    await expectConsecutivePositions(ctx.database.db);
  });

  it('mover no cambia el updatedAt de las tareas que solo se renumeran', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const [a, b] = await addTasks(client, ['A', 'B']);
    const before = (await client.get(`${TASKS}/${b?.id ?? ''}`)).body as { updatedAt: string };
    ctx.t.clock.advance(60_000);
    await moveOk(client, a?.id ?? '', { status: 'in_progress' });
    const after = (await client.get(`${TASKS}/${b?.id ?? ''}`)).body as {
      position: number;
      updatedAt: string;
    };
    expect(after.position).toBe(0);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});

describe('mover: errores', () => {
  it('404 si la tarea no existe', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await moveTask(client, MISSING_ID, { status: 'done' }), 404, 'NOT_FOUND');
  });

  it('422 si la tarea de referencia es la propia tarea', async () => {
    const client = await getCtx().loggedIn();
    const [a] = await addTasks(client, ['A', 'B']);
    expectProblem(
      await moveTask(client, a?.id ?? '', { status: 'todo', beforeId: a?.id }),
      422,
      'UNPROCESSABLE',
    );
  });

  it('422 si la referencia no existe o está en otra columna; nada cambia', async () => {
    const client = await getCtx().loggedIn();
    const [a] = await addTasks(client, ['A', 'B']);
    const [x] = await addTasks(client, ['X'], 'testing');
    expectProblem(
      await moveTask(client, a?.id ?? '', { status: 'todo', afterId: MISSING_ID }),
      422,
      'UNPROCESSABLE',
    );
    expectProblem(
      await moveTask(client, a?.id ?? '', { status: 'todo', beforeId: x?.id }),
      422,
      'UNPROCESSABLE',
    );
    // Se mueve a otra columna pero la referencia pertenece a la de origen.
    expectProblem(
      await moveTask(client, a?.id ?? '', { status: 'testing', afterId: a?.id }),
      422,
      'UNPROCESSABLE',
    );
    expect(await titlesByColumn(client)).toMatchObject({ todo: ['A', 'B'], testing: ['X'] });
    await expectConsecutivePositions(getCtx().database.db);
  });

  it.each([
    ['sin columna', {}],
    ['columna desconocida', { status: 'archivada' }],
    ['beforeId que no es un UUID', { status: 'todo', beforeId: 'uno' }],
    ['beforeId y afterId a la vez', { status: 'todo', beforeId: MISSING_ID, afterId: MISSING_ID }],
    ['posición impuesta', { status: 'todo', position: 0 }],
  ])('400 con %s', async (_name, body) => {
    const client = await getCtx().loggedIn();
    const [a] = await addTasks(client, ['A']);
    expectProblem(await moveTask(client, a?.id ?? '', body), 400, 'VALIDATION_ERROR');
  });
});

describe('invariante tras muchos movimientos', () => {
  /** Generador pseudoaleatorio determinista (LCG): el test es reproducible. */
  function lcg(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
  }

  it('90 movimientos aleatorios coinciden con un modelo y dejan 0..n-1 en cada paso', async () => {
    const client = await getCtx().loggedIn();
    const db = getCtx().database.db;
    const titles = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const created: Record<string, string> = {};
    // Modelo: columnas como listas de títulos.
    const model: Record<TaskStatus, string[]> = {
      todo: [],
      in_progress: [],
      testing: [],
      done: [],
    };
    const spread: TaskStatus[] = [
      'todo',
      'todo',
      'todo',
      'in_progress',
      'in_progress',
      'testing',
      'done',
      'done',
    ];
    for (const [index, title] of titles.entries()) {
      const status = spread[index] ?? 'todo';
      created[title] = (await addTask(client, title, { status })).id;
      model[status].push(title);
    }

    const random = lcg(42);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    for (let step = 0; step < 90; step += 1) {
      const title = pick(titles);
      const target = pick(TASK_STATUSES);
      const without = model[target].filter((candidate) => candidate !== title);
      const body: Record<string, unknown> = { status: target };
      let index = without.length;
      const mode = pick(['end', 'before', 'after'] as const);
      if (mode !== 'end' && without.length > 0) {
        const anchor = pick(without);
        const at = without.indexOf(anchor);
        if (mode === 'before') {
          body['beforeId'] = created[anchor];
          index = at;
        } else {
          body['afterId'] = created[anchor];
          index = at + 1;
        }
      }
      for (const status of TASK_STATUSES) {
        model[status] = model[status].filter((candidate) => candidate !== title);
      }
      model[target].splice(index, 0, title);

      await moveOk(client, created[title] ?? '', body);
      await expectConsecutivePositions(db);
      expect(await titlesByColumn(client), `paso ${String(step)}`).toEqual(model);
    }
    // Cada paso hace varias consultas (mover, comprobar posiciones, listar): con la suite completa
    // en paralelo el total llegó a 5,5 s, por encima del límite por defecto de 5 s. El margen es
    // solo de tiempo: no se relaja ninguna comprobación.
  }, 30_000);
});

describe('peticiones a la vez', () => {
  it('varios movimientos concurrentes terminan todos y dejan 0..n-1 sin repetidos', async () => {
    const client = await getCtx().loggedIn();
    const db = getCtx().database.db;
    const todo = await addTasks(client, ['A', 'B', 'C', 'D', 'E', 'F']);
    const doing = await addTasks(client, ['X', 'Y'], 'in_progress');
    const testing = await addTasks(client, ['P', 'Q'], 'testing');
    const id = (list: typeof todo, index: number): string => list[index]?.id ?? '';

    // Las tareas de referencia (X, Y, F) no se mueven: así todas las peticiones son válidas pase lo que
    // pase con el resto y el resultado esperado es 200 en todas.
    const results = await Promise.all([
      moveTask(client, id(todo, 0), { status: 'in_progress', beforeId: id(doing, 0) }),
      moveTask(client, id(todo, 1), { status: 'in_progress', afterId: id(doing, 1) }),
      moveTask(client, id(todo, 2), { status: 'todo' }),
      moveTask(client, id(todo, 3), { status: 'done' }),
      moveTask(client, id(todo, 4), { status: 'todo', beforeId: id(todo, 5) }),
      moveTask(client, id(testing, 0), { status: 'todo' }),
      moveTask(client, id(testing, 1), { status: 'in_progress' }),
    ]);
    for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(200);

    const columns = await expectConsecutivePositions(db);
    const all = Object.values(columns).flat();
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });

  it('dos movimientos de la misma columna a la vez conservan las dos posiciones', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = await addTasks(client, ['A', 'B', 'C']);
    const [first, second] = await Promise.all([
      moveTask(client, a?.id ?? '', { status: 'todo' }),
      moveTask(client, b?.id ?? '', { status: 'todo' }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const columns = await expectConsecutivePositions(getCtx().database.db);
    expect([...columns.todo].sort()).toEqual([a?.id, b?.id, c?.id].sort());
    // El orden depende de cuál entró primero, pero C quedó delante: ambas pasaron al final.
    expect(columns.todo[0]).toBe(c?.id);
  });

  it('altas a la vez en la misma columna no repiten posición', async () => {
    const client = await getCtx().loggedIn();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) => client.post(TASKS, { title: `T${String(index)}` })),
    );
    for (const res of responses) expect(res.status, JSON.stringify(res.body)).toBe(201);
    const columns = await expectConsecutivePositions(getCtx().database.db);
    expect(columns.todo).toHaveLength(10);
  });

  it('un borrado y un movimiento a la vez dejan el tablero consistente', async () => {
    const client = await getCtx().loggedIn();
    const [a, b, c] = await addTasks(client, ['A', 'B', 'C']);
    const [removed, moved] = await Promise.all([
      client.delete(`${TASKS}/${a?.id ?? ''}`),
      moveTask(client, c?.id ?? '', { status: 'todo', beforeId: b?.id }),
    ]);
    expect(removed.status).toBe(204);
    expect(moved.status).toBe(200);
    expect((await expectConsecutivePositions(getCtx().database.db)).todo).toEqual([c?.id, b?.id]);
  });
});
