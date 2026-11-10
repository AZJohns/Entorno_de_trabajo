/**
 * Recordatorios de una tarea en la API (`/tasks/:id/reminders`): contra la base de datos real. Cubre el
 * alta (la hora local de Madrid se guarda como instante), los cambios de horario de marzo y octubre, los
 * recordatorios en el pasado (422), los duplicados (409), el borrado y que borrar la tarea borra sus
 * recordatorios. El reloj simulado arranca el 2026-11-03 09:00 UTC; las fechas de los cambios de horario
 * son de 2027 para que estén en el futuro. Títulos inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reminderListResponseSchema, reminderResponseSchema } from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import { expectProblem } from '../support/ledger.ts';
import { TASKS, addTask, resetTasks } from '../support/tasks.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetTasks(getCtx().database.db);
});

const remindersOf = (taskId: string) => `${TASKS}/${taskId}/reminders`;

const allReminders = () => getCtx().database.db.selectFrom('task_reminders').selectAll().execute();

describe('alta', () => {
  it('guarda la hora local de Madrid como instante (invierno: UTC+1)', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Llamar al seguro');
    const res = await client.post(remindersOf(task.id), { remindAtLocal: '2026-12-10T09:30' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(reminderResponseSchema.parse(res.body)).toMatchObject({
      taskId: task.id,
      remindAt: '2026-12-10T08:30:00.000Z',
      sentAt: null,
    });
  });

  it('en verano la misma hora local es un instante distinto (UTC+2)', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Revisar el coche');
    const res = await client.post(remindersOf(task.id), { remindAtLocal: '2027-07-10T09:30' });
    expect(res.status).toBe(201);
    expect(reminderResponseSchema.parse(res.body).remindAt).toBe('2027-07-10T07:30:00.000Z');
  });

  it('una tarea que no existe → 404', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.post(remindersOf(MISSING_ID), { remindAtLocal: '2027-01-01T10:00' }),
      404,
      'NOT_FOUND',
    );
  });

  it.each([
    { why: 'falta el campo', body: {} },
    { why: 'con segundos', body: { remindAtLocal: '2027-01-01T10:00:00' } },
    { why: 'con zona', body: { remindAtLocal: '2027-01-01T10:00Z' } },
    { why: 'fecha inexistente', body: { remindAtLocal: '2027-02-30T10:00' } },
    {
      why: 'campo desconocido',
      body: { remindAtLocal: '2027-01-01T10:00', remindAt: '2027-01-01T09:00:00Z' },
    },
  ])('cuerpo no válido ($why) → 400', async ({ body }) => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Cualquiera');
    expectProblem(await client.post(remindersOf(task.id), body), 400, 'VALIDATION_ERROR');
  });
});

describe('recordatorios en el pasado → 422', () => {
  it('una hora anterior a ahora', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Ya pasó');
    // Ahora son las 09:00 UTC (10:00 en Madrid) del 3 de noviembre de 2026.
    expectProblem(
      await client.post(remindersOf(task.id), { remindAtLocal: '2026-11-03T09:00' }),
      422,
      'UNPROCESSABLE',
    );
    expectProblem(
      await client.post(remindersOf(task.id), { remindAtLocal: '2020-01-01T10:00' }),
      422,
      'UNPROCESSABLE',
    );
  });

  it('el minuto actual ya ha pasado; el siguiente vale', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Justo ahora');
    // loggedIn avanzó el reloj: son las 09:00:30 UTC = 10:00:30 en Madrid.
    expectProblem(
      await client.post(remindersOf(task.id), { remindAtLocal: '2026-11-03T10:00' }),
      422,
      'UNPROCESSABLE',
    );
    const ok = await client.post(remindersOf(task.id), { remindAtLocal: '2026-11-03T10:01' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('no se crea ninguna fila', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Ya pasó');
    await client.post(remindersOf(task.id), { remindAtLocal: '2020-01-01T10:00' });
    expect(await allReminders()).toEqual([]);
  });
});

describe('cambios de horario', () => {
  it('marzo: una hora que no existe → 422 con el motivo, sin crear nada', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Madrugón');
    const res = await client.post(remindersOf(task.id), { remindAtLocal: '2027-03-28T02:30' });
    expectProblem(res, 422, 'UNPROCESSABLE');
    expect(JSON.stringify(res.body)).toContain('cambio de horario');
    expect(await allReminders()).toEqual([]);
  });

  it('marzo: las horas a cada lado del hueco sí valen', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Madrugón');
    const before = await client.post(remindersOf(task.id), { remindAtLocal: '2027-03-28T01:59' });
    const after = await client.post(remindersOf(task.id), { remindAtLocal: '2027-03-28T03:00' });
    expect(reminderResponseSchema.parse(before.body).remindAt).toBe('2027-03-28T00:59:00.000Z');
    expect(reminderResponseSchema.parse(after.body).remindAt).toBe('2027-03-28T01:00:00.000Z');
  });

  it('octubre: una hora repetida se guarda en su primera ocurrencia (horario de verano)', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Cambio de hora');
    const res = await client.post(remindersOf(task.id), { remindAtLocal: '2027-10-31T02:30' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // 02:30 CEST (UTC+2) = 00:30 UTC. La segunda ocurrencia (CET) habría sido 01:30 UTC.
    expect(reminderResponseSchema.parse(res.body).remindAt).toBe('2027-10-31T00:30:00.000Z');
  });

  it('octubre: 03:00, que es única, es el instante de después de la repetición', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Cambio de hora');
    const res = await client.post(remindersOf(task.id), { remindAtLocal: '2027-10-31T03:00' });
    expect(reminderResponseSchema.parse(res.body).remindAt).toBe('2027-10-31T02:00:00.000Z');
  });
});

describe('duplicados', () => {
  it('la misma hora en la misma tarea → 409; en otra tarea sí se admite', async () => {
    const client = await getCtx().loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    const body = { remindAtLocal: '2027-01-20T08:00' };
    expect((await client.post(remindersOf(a.id), body)).status).toBe(201);
    expectProblem(await client.post(remindersOf(a.id), body), 409, 'CONFLICT');
    expect((await client.post(remindersOf(b.id), body)).status).toBe(201);
  });
});

describe('lista y borrado', () => {
  it('lista por hora del aviso', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Con avisos');
    const late = await client.post(remindersOf(task.id), { remindAtLocal: '2027-02-01T10:00' });
    const early = await client.post(remindersOf(task.id), { remindAtLocal: '2027-01-01T10:00' });
    const res = await client.get(remindersOf(task.id));
    expect(res.status).toBe(200);
    expect(reminderListResponseSchema.parse(res.body).items.map((item) => item.id)).toEqual([
      reminderResponseSchema.parse(early.body).id,
      reminderResponseSchema.parse(late.body).id,
    ]);
  });

  it('lista de una tarea que no existe → 404', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(remindersOf(MISSING_ID)), 404, 'NOT_FOUND');
  });

  it('borra un recordatorio (204) y un segundo borrado → 404', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'Borrable');
    const created = reminderResponseSchema.parse(
      (await client.post(remindersOf(task.id), { remindAtLocal: '2027-01-01T10:00' })).body,
    );
    const url = `${remindersOf(task.id)}/${created.id}`;
    expect((await client.delete(url)).status).toBe(204);
    expectProblem(await client.delete(url), 404, 'NOT_FOUND');
    expect(await allReminders()).toEqual([]);
  });

  it('no se puede borrar el recordatorio de una tarea por la URL de otra', async () => {
    const client = await getCtx().loggedIn();
    const a = await addTask(client, 'A');
    const b = await addTask(client, 'B');
    const created = reminderResponseSchema.parse(
      (await client.post(remindersOf(a.id), { remindAtLocal: '2027-01-01T10:00' })).body,
    );
    expectProblem(await client.delete(`${remindersOf(b.id)}/${created.id}`), 404, 'NOT_FOUND');
    expect(await allReminders()).toHaveLength(1);
  });

  it('un identificador que no es un UUID → 400', async () => {
    const client = await getCtx().loggedIn();
    const task = await addTask(client, 'A');
    expectProblem(
      await client.delete(`${remindersOf(task.id)}/no-es-uuid`),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('borrar la tarea', () => {
  it('borra también sus recordatorios (cascada), pendientes y entregados', async () => {
    const ctx = getCtx();
    const { db } = ctx.database;
    const client = await ctx.loggedIn();
    const task = await addTask(client, 'Se va');
    const other = await addTask(client, 'Se queda');
    await client.post(remindersOf(task.id), { remindAtLocal: '2027-01-01T10:00' });
    await client.post(remindersOf(task.id), { remindAtLocal: '2027-01-02T10:00' });
    await client.post(remindersOf(other.id), { remindAtLocal: '2027-01-01T10:00' });
    // Uno ya entregado.
    await db
      .updateTable('task_reminders')
      .set({ sent_at: new Date('2026-11-03T09:00:00Z') })
      .where('task_id', '=', task.id)
      .where('remind_at', '=', new Date('2027-01-01T09:00:00Z'))
      .execute();

    expect((await client.delete(`${TASKS}/${task.id}`)).status).toBe(204);

    expect((await allReminders()).map((row) => row.task_id)).toEqual([other.id]);
  });
});
