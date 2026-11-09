/**
 * Entrega de los recordatorios (`RemindersService.deliverDue`), contra PostgreSQL real: cada aviso se
 * entrega UNA sola vez aunque haya dos reclamaciones a la vez, aunque el proceso muera a mitad (la
 * conexión se mata con `pg_terminate_backend`) o aunque falle la creación de la notificación. También
 * comprueba el instante exacto de entrega en los cambios de horario de marzo y octubre, el segundo cerrojo
 * (índice único de `notifications`) y el reparto a canales externos tras confirmar. Títulos inventados.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from '../../src/db/schema.ts';
import { createNotificationsModule } from '../../src/modules/notifications/index.ts';
import type {
  NotificationChannel,
  NotificationRecord,
} from '../../src/modules/notifications/index.ts';
import {
  RemindersService,
  type ReminderNotifier,
} from '../../src/modules/tasks/reminders.service.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';
import { FakeClock } from '../support/clock.ts';

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
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('tasks').execute();
});

const NOW = new Date('2027-01-10T12:00:00Z');

/** Servicio de recordatorios con un reloj y un notificador dados (por defecto, el módulo real). */
function build(
  options: {
    clock?: FakeClock;
    notifier?: ReminderNotifier;
    channels?: NotificationChannel[];
    db?: Kysely<Database>;
  } = {},
) {
  const clock = options.clock ?? new FakeClock(NOW);
  const notifications = createNotificationsModule({ db, clock, channels: options.channels ?? [] });
  const service = new RemindersService({
    db: options.db ?? db,
    clock,
    notifications: options.notifier ?? notifications.service,
    timeZone: 'Europe/Madrid',
  });
  return { clock, service, notifications: notifications.service };
}

let nextPosition = 0;
async function addTask(title: string): Promise<string> {
  const row = await db
    .insertInto('tasks')
    .values({ title, status: 'todo', position: nextPosition++ })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Inserta recordatorios directamente (el servicio no admite pasados). */
async function addReminders(taskId: string, instants: readonly string[]): Promise<string[]> {
  const rows = await db
    .insertInto('task_reminders')
    .values(instants.map((instant) => ({ task_id: taskId, remind_at: new Date(instant) })))
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

const notificationsOf = () =>
  db.selectFrom('notifications').selectAll().orderBy('created_at').execute();
const remindersOf = () => db.selectFrom('task_reminders').selectAll().execute();

/** Promesa que se resuelve desde fuera (para parar una transacción en un punto concreto). */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Espera a que la conexión esté ejecutando el `pg_sleep`, para matarla con una consulta en curso. */
async function waitUntilSleeping(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await sql<{ found: number }>`
      SELECT 1 AS found FROM pg_stat_activity
      WHERE pid = ${pid} AND state = 'active' AND query LIKE '%pg_sleep%'
    `.execute(db);
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La conexión no llegó a ejecutar pg_sleep');
}

describe('entrega básica', () => {
  it('entrega los vencidos, marca sent_at y crea la notificación con el título de la tarea', async () => {
    const { service } = build();
    const task = await addTask('Pagar la cuota');
    const [due, future] = await addReminders(task, [
      '2027-01-10T11:59:00Z',
      '2027-01-10T12:01:00Z',
    ]);

    expect(await service.deliverDue()).toBe(1);

    const rows = await remindersOf();
    expect(rows.find((row) => row.id === due)?.sent_at).toEqual(NOW);
    expect(rows.find((row) => row.id === future)?.sent_at).toBeNull();
    expect(await notificationsOf()).toMatchObject([
      {
        kind: 'task_reminder',
        reference_id: due,
        title: 'Recordatorio de tarea',
        body: 'Pagar la cuota',
        read_at: null,
      },
    ]);
  });

  it('un aviso ya entregado no se vuelve a entregar', async () => {
    const { service } = build();
    await addReminders(await addTask('Una vez'), ['2027-01-10T11:00:00Z']);
    expect(await service.deliverDue()).toBe(1);
    expect(await service.deliverDue()).toBe(0);
    expect(await service.deliverDue()).toBe(0);
    expect(await notificationsOf()).toHaveLength(1);
  });

  it('sin avisos vencidos no hace nada', async () => {
    const { service } = build();
    await addReminders(await addTask('Futuro'), ['2027-01-10T12:00:01Z']);
    expect(await service.deliverDue()).toBe(0);
    expect(await notificationsOf()).toEqual([]);
  });

  it('el instante exacto del aviso ya cuenta como vencido', async () => {
    const { service } = build();
    await addReminders(await addTask('Justo'), ['2027-01-10T12:00:00Z']);
    expect(await service.deliverDue()).toBe(1);
  });

  it('la notificación sobrevive al borrado de la tarea (no hay clave ajena)', async () => {
    const { service } = build();
    const task = await addTask('Efímera');
    await addReminders(task, ['2027-01-10T11:00:00Z']);
    await service.deliverDue();
    await db.deleteFrom('tasks').where('id', '=', task).execute();
    expect(await remindersOf()).toEqual([]);
    expect(await notificationsOf()).toHaveLength(1);
  });

  it('con más avisos que el tamaño del lote, varios ciclos los entregan todos sin repetir', async () => {
    const { service } = build();
    const task = await addTask('Muchos');
    const instants = Array.from({ length: 120 }, (_, i) =>
      new Date(NOW.getTime() - (i + 1) * 1000).toISOString(),
    );
    await addReminders(task, instants);
    const delivered = [
      await service.deliverDue(),
      await service.deliverDue(),
      await service.deliverDue(),
    ];
    expect(delivered).toEqual([50, 50, 20]);
    expect(await service.deliverDue()).toBe(0);
    expect(await notificationsOf()).toHaveLength(120);
  });
});

describe('entrega única con reclamaciones simultáneas', () => {
  it('mientras un proceso tiene los avisos reclamados, otro se salta esas filas (SKIP LOCKED)', async () => {
    const reached = deferred();
    const release = deferred();
    const real = build();
    const gated: ReminderNotifier = {
      notify: async (trx, inputs) => {
        reached.resolve();
        await release.promise;
        return real.notifications.notify(trx, inputs);
      },
      dispatch: (created) => real.notifications.dispatch(created),
    };
    await addReminders(await addTask('Compartida'), [
      '2027-01-10T10:00:00Z',
      '2027-01-10T10:01:00Z',
      '2027-01-10T10:02:00Z',
    ]);

    const first = build({ notifier: gated }).service.deliverDue();
    await reached.promise; // el primero ya tiene las tres filas bloqueadas, sin confirmar
    const second = await real.service.deliverDue();
    expect(second).toBe(0);
    release.resolve();
    expect(await first).toBe(3);

    expect(await notificationsOf()).toHaveLength(3);
    expect((await remindersOf()).every((row) => row.sent_at !== null)).toBe(true);
  });

  it('dos ciclos lanzados a la vez entregan cada aviso exactamente una vez', async () => {
    const { service } = build();
    const task = await addTask('Carrera');
    const instants = Array.from({ length: 40 }, (_, i) =>
      new Date(NOW.getTime() - (i + 1) * 1000).toISOString(),
    );
    const ids = await addReminders(task, instants);

    const results = await Promise.all(Array.from({ length: 4 }, () => service.deliverDue()));

    expect(results.reduce((sum, delivered) => sum + delivered, 0)).toBe(40);
    const notifications = await notificationsOf();
    expect(notifications).toHaveLength(40);
    expect(new Set(notifications.map((row) => row.reference_id))).toEqual(new Set(ids));
  });
});

describe('reinicio o fallo a mitad', () => {
  it('si la conexión muere tras reclamar, no queda nada a medias y el siguiente ciclo lo entrega una vez', async () => {
    const reached = deferred();
    let pid = 0;
    const real = build();
    const dying: ReminderNotifier = {
      notify: async (trx) => {
        const { rows } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx);
        pid = rows[0]?.pid ?? 0;
        reached.resolve();
        // El proceso «se queda trabajando» con una consulta en curso hasta que se mata su conexión.
        await sql`SELECT pg_sleep(60)`.execute(trx);
        throw new Error('no debería llegar aquí');
      },
      dispatch: (created) => real.notifications.dispatch(created),
    };
    const [reminder] = await addReminders(await addTask('Se cae el proceso'), [
      '2027-01-10T11:00:00Z',
    ]);

    // El «proceso que muere» tiene su propio pool. Cuando el servidor corta una conexión en uso, `pg`
    // emite `error` en el cliente (no en el pool); sin manejador sería una excepción sin capturar.
    const pool = new pg.Pool({ connectionString: database.url });
    pool.on('connect', (client) => client.on('error', () => undefined));
    const doomedDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    const crashed = build({ notifier: dying, db: doomedDb })
      .service.deliverDue()
      .then(
        () => 'terminó',
        () => 'falló',
      );
    await reached.promise; // reclamado (sent_at escrito) pero sin confirmar
    await waitUntilSleeping(pid);
    await sql`SELECT pg_terminate_backend(${pid})`.execute(db);
    expect(await crashed).toBe('falló');
    await doomedDb.destroy();

    // La transacción se deshizo: ni aviso marcado ni notificación.
    expect((await remindersOf()).find((row) => row.id === reminder)?.sent_at).toBeNull();
    expect(await notificationsOf()).toEqual([]);

    // Tras el «reinicio», el siguiente ciclo entrega el aviso, una sola vez.
    expect(await real.service.deliverDue()).toBe(1);
    expect(await real.service.deliverDue()).toBe(0);
    expect(await notificationsOf()).toHaveLength(1);
  });

  it('si falla la creación de la notificación, el aviso sigue pendiente, se anota el intento y se entrega después', async () => {
    const real = build();
    let failures = 1;
    const flaky: ReminderNotifier = {
      notify: async (trx, inputs) => {
        // Escribe de verdad y falla después: lo escrito debe deshacerse.
        const created = await real.notifications.notify(trx, inputs);
        if (failures-- > 0) throw new Error('fallo simulado');
        return created;
      },
      dispatch: (created) => real.notifications.dispatch(created),
    };
    const [reminder] = await addReminders(await addTask('Con fallo'), ['2027-01-10T11:00:00Z']);
    const { service } = build({ notifier: flaky });

    await expect(service.deliverDue()).rejects.toThrow('fallo simulado');
    let row = (await remindersOf()).find((r) => r.id === reminder);
    expect(row).toMatchObject({ sent_at: null, attempts: 1, last_error: 'fallo simulado' });
    expect(await notificationsOf()).toEqual([]);

    expect(await service.deliverDue()).toBe(1);
    row = (await remindersOf()).find((r) => r.id === reminder);
    expect(row?.sent_at).toEqual(NOW);
    expect(await notificationsOf()).toHaveLength(1);
  });
});

describe('segundo cerrojo: el índice único de notifications', () => {
  it('crear dos veces la notificación del mismo origen no la duplica', async () => {
    const { notifications } = build();
    const input = {
      kind: 'task_reminder',
      referenceId: '00000000-0000-4000-8000-0000000000aa',
      title: 'T',
      body: 'B',
    };
    const first = await notifications.notify(db, [input]);
    const second = await notifications.notify(db, [input]);
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(await notificationsOf()).toHaveLength(1);
  });

  it('el mismo origen con otro tipo sí es otra notificación; sin origen no se deduplica', async () => {
    const { notifications } = build();
    const referenceId = '00000000-0000-4000-8000-0000000000aa';
    await notifications.notify(db, [
      { kind: 'task_reminder', referenceId, title: 'T', body: '' },
      { kind: 'otro_tipo', referenceId, title: 'T', body: '' },
      { kind: 'task_reminder', referenceId: null, title: 'T', body: '' },
      { kind: 'task_reminder', referenceId: null, title: 'T', body: '' },
    ]);
    expect(await notificationsOf()).toHaveLength(4);
  });
});

describe('cambios de horario: el aviso se entrega en el instante correcto', () => {
  /** Crea el recordatorio por el servicio (hora local de Madrid) y entrega en dos instantes. */
  async function deliveredAt(local: string, nowBefore: string, nowAt: string, from: string) {
    const clock = new FakeClock(new Date(from));
    const { service } = build({ clock });
    const task = await addTask(`Aviso ${local}`);
    await service.create(task, { remindAtLocal: local });
    clock.advance(Date.parse(nowBefore) - clock.now().getTime());
    const before = await service.deliverDue();
    clock.advance(Date.parse(nowAt) - clock.now().getTime());
    const at = await service.deliverDue();
    return { before, at };
  }

  it('marzo: 03:30 tras el hueco es 01:30 UTC, no 02:30', async () => {
    expect(
      await deliveredAt(
        '2027-03-28T03:30',
        '2027-03-28T01:29:59Z',
        '2027-03-28T01:30:00Z',
        '2027-03-01T00:00:00Z',
      ),
    ).toEqual({ before: 0, at: 1 });
  });

  it('marzo: 01:30, antes del hueco, es 00:30 UTC', async () => {
    expect(
      await deliveredAt(
        '2027-03-28T01:30',
        '2027-03-28T00:29:59Z',
        '2027-03-28T00:30:00Z',
        '2027-03-01T00:00:00Z',
      ),
    ).toEqual({ before: 0, at: 1 });
  });

  it('octubre: 02:30 (repetida) se entrega a su primera ocurrencia, 00:30 UTC, y no otra vez a la segunda', async () => {
    const clock = new FakeClock(new Date('2027-10-01T00:00:00Z'));
    const { service } = build({ clock });
    const task = await addTask('Octubre');
    await service.create(task, { remindAtLocal: '2027-10-31T02:30' });

    clock.advance(Date.parse('2027-10-31T00:29:59Z') - clock.now().getTime());
    expect(await service.deliverDue()).toBe(0);
    clock.advance(1000);
    expect(await service.deliverDue()).toBe(1);
    // La segunda vez que el reloj de Madrid marca 02:30 es a las 01:30 UTC: no hay nada más que entregar.
    clock.advance(Date.parse('2027-10-31T01:30:00Z') - clock.now().getTime());
    expect(await service.deliverDue()).toBe(0);
    expect(await notificationsOf()).toHaveLength(1);
  });

  it('octubre: 03:00 se entrega a las 02:00 UTC', async () => {
    expect(
      await deliveredAt(
        '2027-10-31T03:00',
        '2027-10-31T01:59:59Z',
        '2027-10-31T02:00:00Z',
        '2027-10-01T00:00:00Z',
      ),
    ).toEqual({ before: 0, at: 1 });
  });
});

describe('canales externos (preparados para el push de la fase 2)', () => {
  const channelFor = (
    sent: NotificationRecord[],
    name = 'canal-de-prueba',
  ): NotificationChannel => ({
    name,
    send: (notification) => {
      sent.push(notification);
      return Promise.resolve();
    },
  });

  it('se reparte cada notificación a los canales una vez, tras confirmar', async () => {
    const sent: NotificationRecord[] = [];
    const { service } = build({ channels: [channelFor(sent)] });
    await addReminders(await addTask('Con canal'), ['2027-01-10T11:00:00Z']);
    await service.deliverDue();
    await service.deliverDue();
    expect(sent.map((n) => n.body)).toEqual(['Con canal']);
    // Cuando el canal la recibe, la notificación ya está confirmada en la base de datos.
    expect(await notificationsOf()).toHaveLength(1);
  });

  it('un canal que falla no deshace ni repite el aviso, y no impide a los demás', async () => {
    const errors: string[] = [];
    const sent: NotificationRecord[] = [];
    const clock = new FakeClock(NOW);
    const module = createNotificationsModule({
      db,
      clock,
      channels: [
        { name: 'roto', send: () => Promise.reject(new Error('sin red')) },
        channelFor(sent, 'bueno'),
      ],
      onChannelError: (channel) => errors.push(channel),
    });
    const service = new RemindersService({
      db,
      clock,
      notifications: module.service,
      timeZone: 'Europe/Madrid',
    });
    await addReminders(await addTask('Canal roto'), ['2027-01-10T11:00:00Z']);

    expect(await service.deliverDue()).toBe(1);
    expect(errors).toEqual(['roto']);
    expect(sent).toHaveLength(1);
    expect(await service.deliverDue()).toBe(0);
    expect(await notificationsOf()).toHaveLength(1);
  });
});
