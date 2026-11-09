/**
 * Tiempo dedicado en la API: cronómetro (`/tasks/:id/timer/*`) y anotación manual
 * (`/tasks/:id/time-entries`), contra la base de datos real. Cubre que solo hay un cronómetro en marcha,
 * los intervalos inválidos (400, 422) y los solapes (409), y que el total se calcula al leer. El reloj es
 * simulado (empieza el 2026-11-03 a las 09:00 UTC y `loggedIn` lo adelanta 30 s). Datos inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  taskResponseSchema,
  timeEntryListResponseSchema,
  timeEntryResponseSchema,
  type TaskResponse,
} from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import type { TestClient } from '../support/client.ts';
import { expectProblem } from '../support/ledger.ts';
import { TASKS, addTask, resetTasks } from '../support/tasks.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const SECOND = 1000;
const MINUTE = 60 * SECOND;

beforeEach(async () => {
  await resetTasks(getCtx().database.db);
});

const startTimer = (client: TestClient, task: TaskResponse) =>
  client.post(`${TASKS}/${task.id}/timer/start`);
const stopTimer = (client: TestClient, task: TaskResponse) =>
  client.post(`${TASKS}/${task.id}/timer/stop`);
const addManual = (client: TestClient, task: TaskResponse, body: Record<string, unknown>) =>
  client.post(`${TASKS}/${task.id}/time-entries`, body);

async function readTask(client: TestClient, task: TaskResponse): Promise<TaskResponse> {
  const res = await client.get(`${TASKS}/${task.id}`);
  expect(res.status).toBe(200);
  return taskResponseSchema.parse(res.body);
}

async function listEntries(client: TestClient, task: TaskResponse) {
  const res = await client.get(`${TASKS}/${task.id}/time-entries`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return timeEntryListResponseSchema.parse(res.body).items;
}

const runningCount = async (): Promise<number> =>
  (
    await getCtx()
      .database.db.selectFrom('task_time_entries')
      .select('id')
      .where('ended_at', 'is', null)
      .execute()
  ).length;

describe('cronómetro', () => {
  it('arranca, cuenta hasta ahora y al parar guarda el intervalo', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const task = await addTask(client, 'A');

    const startedAt = ctx.t.clock.now().toISOString();
    const started = await startTimer(client, task);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(timeEntryResponseSchema.parse(started.body)).toMatchObject({
      taskId: task.id,
      startedAt,
      endedAt: null,
      durationSeconds: 0,
    });

    ctx.t.clock.advance(90 * SECOND);
    expect(await readTask(client, task)).toMatchObject({
      timeSpentSeconds: 90,
      timerStartedAt: startedAt,
    });

    const stopped = await stopTimer(client, task);
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
    expect(timeEntryResponseSchema.parse(stopped.body)).toMatchObject({
      startedAt,
      endedAt: ctx.t.clock.now().toISOString(),
      durationSeconds: 90,
    });

    // Parado, el total deja de crecer.
    ctx.t.clock.advance(10 * MINUTE);
    expect(await readTask(client, task)).toMatchObject({
      timeSpentSeconds: 90,
      timerStartedAt: null,
    });
  });

  it('solo puede haber un cronómetro en marcha: el segundo, de la misma tarea o de otra, da 409', async () => {
    const client = await getCtx().loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    expect((await startTimer(client, a)).status).toBe(201);
    expectProblem(await startTimer(client, a), 409, 'CONFLICT');
    expectProblem(await startTimer(client, b), 409, 'CONFLICT');
    expect(await runningCount()).toBe(1);
    expect(await listEntries(client, b)).toEqual([]);
  });

  it('tras parar se puede arrancar otro, en la misma tarea o en otra', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    await startTimer(client, a);
    ctx.t.clock.advance(MINUTE);
    await stopTimer(client, a);
    expect((await startTimer(client, b)).status).toBe(201);
    ctx.t.clock.advance(MINUTE);
    await stopTimer(client, b);
    expect((await startTimer(client, a)).status).toBe(201);
    expect(await runningCount()).toBe(1);
  });

  it('dos arranques a la vez: uno gana (201) y el otro recibe 409', async () => {
    const client = await getCtx().loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    const results = await Promise.all([startTimer(client, a), startTimer(client, b)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await runningCount()).toBe(1);
  });

  it('parar sin cronómetro en marcha, o el de otra tarea, da 409', async () => {
    const client = await getCtx().loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    expectProblem(await stopTimer(client, a), 409, 'CONFLICT');
    await startTimer(client, a);
    expectProblem(await stopTimer(client, b), 409, 'CONFLICT');
    expect(await runningCount()).toBe(1);
    // Dos paradas seguidas: la segunda ya no tiene nada que parar.
    getCtx().t.clock.advance(MINUTE);
    expect((await stopTimer(client, a)).status).toBe(200);
    expectProblem(await stopTimer(client, a), 409, 'CONFLICT');
  });

  it('parar en el mismo instante en que se arrancó guarda un intervalo válido de 1 ms', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    const started = timeEntryResponseSchema.parse((await startTimer(client, task)).body);
    const stopped = await stopTimer(client, task);
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
    const entry = timeEntryResponseSchema.parse(stopped.body);
    expect(Date.parse(entry.endedAt ?? '') - Date.parse(started.startedAt)).toBe(1);
    expect(entry.durationSeconds).toBe(0);
  });

  it('404 si la tarea no existe; 400 si el identificador no es un UUID', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.post(`${TASKS}/${MISSING_ID}/timer/start`), 404, 'NOT_FOUND');
    expectProblem(await client.post(`${TASKS}/${MISSING_ID}/timer/stop`), 404, 'NOT_FOUND');
    expectProblem(await client.post(`${TASKS}/uno/timer/start`), 400, 'VALIDATION_ERROR');
  });

  it('el cronómetro sigue en marcha aunque la tarea se mueva a «Terminado»', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    await startTimer(client, task);
    expect((await client.post(`${TASKS}/${task.id}/move`, { status: 'done' })).status).toBe(200);
    expect((await readTask(client, task)).timerStartedAt).not.toBeNull();
  });

  it('borrar la tarea con el cronómetro en marcha lo libera', async () => {
    const client = await getCtx().loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    await startTimer(client, a);
    expect((await client.delete(`${TASKS}/${a.id}`)).status).toBe(204);
    expect(await runningCount()).toBe(0);
    expect((await startTimer(client, b)).status).toBe(201);
  });
});

describe('anotación manual', () => {
  it('con inicio y fin', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    const res = await addManual(client, task, {
      startedAt: '2026-11-03T07:00:00Z',
      endedAt: '2026-11-03T07:45:30Z',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      taskId: task.id,
      startedAt: '2026-11-03T07:00:00.000Z',
      endedAt: '2026-11-03T07:45:30.000Z',
      durationSeconds: 2730,
    });
  });

  it('con inicio y duración: se guarda como intervalo', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    const res = await addManual(client, task, {
      startedAt: '2026-11-03T07:00:00Z',
      durationSeconds: 1800,
    });
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      endedAt: '2026-11-03T07:30:00.000Z',
      durationSeconds: 1800,
    });
    const rows = await getCtx().database.db.selectFrom('task_time_entries').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ended_at?.toISOString()).toBe('2026-11-03T07:30:00.000Z');
  });

  it('entiende desplazamientos horarios: se comparan instantes, no textos', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    // 10:00+02:00 son las 08:00Z, así que 08:30Z es media hora después aunque «08:30Z» < «10:00+02:00» como texto.
    const res = await addManual(client, task, {
      startedAt: '2026-11-03T10:00:00+02:00',
      endedAt: '2026-11-03T08:30:00Z',
    });
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      startedAt: '2026-11-03T08:00:00.000Z',
      durationSeconds: 1800,
    });
    // Y al revés: 09:00+02:00 son las 07:00Z, anterior a 07:30Z.
    expectProblem(
      await addManual(client, task, {
        startedAt: '2026-11-03T09:30:00+02:00',
        endedAt: '2026-11-03T07:00:00Z',
      }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('el total de la tarea suma las anotaciones y el cronómetro, y se calcula al leer', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const task = await addTask(client, 'A');
    await addManual(client, task, { startedAt: '2026-11-03T06:00:00Z', durationSeconds: 600 });
    await addManual(client, task, { startedAt: '2026-11-03T07:00:00Z', durationSeconds: 1800 });
    expect((await readTask(client, task)).timeSpentSeconds).toBe(2400);

    await startTimer(client, task);
    ctx.t.clock.advance(2 * MINUTE);
    expect((await readTask(client, task)).timeSpentSeconds).toBe(2520);

    // El tablero trae el mismo total.
    const board = (await client.get(TASKS)).body as {
      columns: { tasks: { id: string; timeSpentSeconds: number }[] }[];
    };
    const onBoard = board.columns.flatMap((column) => column.tasks).find((t) => t.id === task.id);
    expect(onBoard?.timeSpentSeconds).toBe(2520);
  });

  it('lista las entradas de la más reciente a la más antigua, con el cronómetro en marcha', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const task = await addTask(client, 'A');
    await addManual(client, task, { startedAt: '2026-11-03T06:00:00Z', durationSeconds: 60 });
    await addManual(client, task, { startedAt: '2026-11-03T07:00:00Z', durationSeconds: 120 });
    await startTimer(client, task);
    ctx.t.clock.advance(30 * SECOND);
    const entries = await listEntries(client, task);
    expect(entries.map((entry) => entry.durationSeconds)).toEqual([30, 120, 60]);
    expect(entries[0]?.endedAt).toBeNull();
    expectProblem(await client.get(`${TASKS}/${MISSING_ID}/time-entries`), 404, 'NOT_FOUND');
  });

  describe('intervalos inválidos', () => {
    it.each([
      [
        'fin igual al inicio',
        { startedAt: '2026-11-03T07:00:00Z', endedAt: '2026-11-03T07:00:00Z' },
      ],
      [
        'fin antes del inicio',
        { startedAt: '2026-11-03T07:00:00Z', endedAt: '2026-11-03T06:00:00Z' },
      ],
      ['duración cero', { startedAt: '2026-11-03T07:00:00Z', durationSeconds: 0 }],
      ['duración negativa', { startedAt: '2026-11-03T07:00:00Z', durationSeconds: -60 }],
      ['duración con decimales', { startedAt: '2026-11-03T07:00:00Z', durationSeconds: 1.5 }],
      [
        'fin y duración a la vez',
        {
          startedAt: '2026-11-03T07:00:00Z',
          endedAt: '2026-11-03T08:00:00Z',
          durationSeconds: 3600,
        },
      ],
      ['ni fin ni duración', { startedAt: '2026-11-03T07:00:00Z' }],
      ['sin inicio', { endedAt: '2026-11-03T07:00:00Z' }],
      ['inicio sin zona horaria', { startedAt: '2026-11-03T07:00:00', durationSeconds: 60 }],
      ['inicio que no es una fecha', { startedAt: 'ayer', durationSeconds: 60 }],
      ['inicio anterior a 1970', { startedAt: '1969-12-31T23:00:00Z', durationSeconds: 60 }],
      ['más de 7 días', { startedAt: '2026-10-01T07:00:00Z', durationSeconds: 7 * 86_400 + 1 }],
      [
        'más de 7 días con fin',
        { startedAt: '2026-10-01T07:00:00Z', endedAt: '2026-10-09T07:00:00Z' },
      ],
      ['campo desconocido', { startedAt: '2026-11-03T07:00:00Z', durationSeconds: 60, extra: 1 }],
    ])('400: %s', async (_name, body) => {
      const client = await getCtx().loggedIn();
      const task = await addTask(client, 'A');
      expectProblem(await addManual(client, task, body), 400, 'VALIDATION_ERROR');
      expect(await listEntries(client, task)).toEqual([]);
    });

    it('exactamente 7 días es el máximo admitido', async () => {
      const client = await getCtx().loggedIn();
      const task = await addTask(client, 'A');
      const res = await addManual(client, task, {
        startedAt: '2026-10-01T07:00:00Z',
        durationSeconds: 7 * 86_400,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it('422 si termina en el futuro; terminar justo ahora se admite', async () => {
      const ctx = getCtx();
      const client = await ctx.loggedIn();
      const task = await addTask(client, 'A');
      const now = ctx.t.clock.now();
      expectProblem(
        await addManual(client, task, {
          startedAt: new Date(now.getTime() - MINUTE).toISOString(),
          endedAt: new Date(now.getTime() + SECOND).toISOString(),
        }),
        422,
        'UNPROCESSABLE',
      );
      expectProblem(
        await addManual(client, task, { startedAt: now.toISOString(), durationSeconds: 60 }),
        422,
        'UNPROCESSABLE',
      );
      const ok = await addManual(client, task, {
        startedAt: new Date(now.getTime() - MINUTE).toISOString(),
        endedAt: now.toISOString(),
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });

    it('404 si la tarea no existe', async () => {
      const client = await getCtx().loggedIn();
      expectProblem(
        await client.post(`${TASKS}/${MISSING_ID}/time-entries`, {
          startedAt: '2026-11-03T07:00:00Z',
          durationSeconds: 60,
        }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('solapes (409)', () => {
    const entry = (from: string, to: string) => ({
      startedAt: `2026-11-03T${from}:00Z`,
      endedAt: `2026-11-03T${to}:00Z`,
    });

    it.each([
      ['parcial por detrás', '03:30', '04:30'],
      ['parcial por delante', '02:30', '03:30'],
      ['contenida', '03:10', '03:20'],
      ['que la contiene', '02:00', '04:59'],
      ['idéntica', '03:00', '04:00'],
    ])('rechaza una anotación %s de otra', async (_name, from, to) => {
      const client = await getCtx().loggedIn();
      const task = await addTask(client, 'A');
      expect((await addManual(client, task, entry('03:00', '04:00'))).status).toBe(201);
      expectProblem(await addManual(client, task, entry(from, to)), 409, 'CONFLICT');
      expect(await listEntries(client, task)).toHaveLength(1);
    });

    it('también si es de otra tarea: una persona no trabaja en dos a la vez', async () => {
      const client = await getCtx().loggedIn();
      const a = await addTask(client, 'A');
      const b = await addTask(client, 'B');
      await addManual(client, a, entry('03:00', '04:00'));
      expectProblem(await addManual(client, b, entry('03:30', '03:45')), 409, 'CONFLICT');
    });

    it('las anotaciones contiguas no se solapan', async () => {
      const client = await getCtx().loggedIn();
      const a = await addTask(client, 'A');
      const b = await addTask(client, 'B');
      expect((await addManual(client, a, entry('03:00', '04:00'))).status).toBe(201);
      expect((await addManual(client, b, entry('04:00', '04:30'))).status).toBe(201);
      expect((await addManual(client, a, entry('02:00', '03:00'))).status).toBe(201);
    });

    it('con el cronómetro en marcha: lo anterior a su inicio se admite y lo posterior da 409', async () => {
      const ctx = getCtx();
      const client = await ctx.loggedIn();
      const task = await addTask(client, 'A');
      const other = await addTask(client, 'B');
      const startedAt = ctx.t.clock.now();
      await startTimer(client, task);
      ctx.t.clock.advance(5 * MINUTE);

      const at = (offsetMs: number): string =>
        new Date(startedAt.getTime() + offsetMs).toISOString();
      // Dentro del tramo que el cronómetro lleva en marcha, de la misma tarea o de otra.
      expectProblem(
        await addManual(client, task, { startedAt: at(10 * SECOND), endedAt: at(20 * SECOND) }),
        409,
        'CONFLICT',
      );
      expectProblem(
        await addManual(client, other, { startedAt: at(-MINUTE), endedAt: at(SECOND) }),
        409,
        'CONFLICT',
      );
      // Justo antes, y terminando exactamente en su inicio.
      expect(
        (await addManual(client, other, { startedAt: at(-2 * MINUTE), endedAt: at(0) })).status,
      ).toBe(201);
      expect(await runningCount()).toBe(1);
    });

    it('quedó libre al borrar la entrada que lo ocupaba', async () => {
      const client = await getCtx().loggedIn();
      const task = await addTask(client, 'A');
      const first = timeEntryResponseSchema.parse(
        (await addManual(client, task, entry('03:00', '04:00'))).body,
      );
      expect((await client.delete(`/api/v1/time-entries/${first.id}`)).status).toBe(204);
      expect((await addManual(client, task, entry('03:30', '04:30'))).status).toBe(201);
    });
  });
});

describe('borrar entradas', () => {
  it('borra una entrada y baja el total; 404 si no existe; 400 si no es un UUID', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    const kept = timeEntryResponseSchema.parse(
      (await addManual(client, task, { startedAt: '2026-11-03T06:00:00Z', durationSeconds: 60 }))
        .body,
    );
    const removed = timeEntryResponseSchema.parse(
      (await addManual(client, task, { startedAt: '2026-11-03T07:00:00Z', durationSeconds: 600 }))
        .body,
    );
    expect((await readTask(client, task)).timeSpentSeconds).toBe(660);
    expect((await client.delete(`/api/v1/time-entries/${removed.id}`)).status).toBe(204);
    expect((await readTask(client, task)).timeSpentSeconds).toBe(60);
    expect((await listEntries(client, task)).map((e) => e.id)).toEqual([kept.id]);
    expectProblem(await client.delete(`/api/v1/time-entries/${removed.id}`), 404, 'NOT_FOUND');
    expectProblem(await client.delete('/api/v1/time-entries/uno'), 400, 'VALIDATION_ERROR');
  });

  it('borrar el cronómetro en marcha lo descarta y permite arrancar otro', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    const running = timeEntryResponseSchema.parse((await startTimer(client, task)).body);
    expect((await client.delete(`/api/v1/time-entries/${running.id}`)).status).toBe(204);
    expect(await runningCount()).toBe(0);
    expect((await readTask(client, task)).timerStartedAt).toBeNull();
    expect((await startTimer(client, task)).status).toBe(201);
  });

  it('borrar la tarea borra su tiempo', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    await addManual(client, task, { startedAt: '2026-11-03T06:00:00Z', durationSeconds: 60 });
    await client.delete(`${TASKS}/${task.id}`);
    expect(
      await getCtx().database.db.selectFrom('task_time_entries').select('id').execute(),
    ).toEqual([]);
  });
});
