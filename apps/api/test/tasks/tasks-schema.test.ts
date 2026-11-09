/**
 * Restricciones de la migración 0006 (`tasks` y `task_time_entries`) contra un PostgreSQL real. Cada test
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
  await db.deleteFrom('tasks').execute();
});

/** Inserta con valores construidos a mano para poder romper cada regla; la base de datos valida. */
function insertTask(values: Record<string, unknown> = {}) {
  return db
    .insertInto('tasks')
    .values({ title: 'Tarea', status: 'todo', position: 0, ...values } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
}

async function expectViolation(
  action: Promise<unknown>,
  code: '23514' | '23505' | '23P01',
  constraint: string,
): Promise<void> {
  await expect(action).rejects.toMatchObject({ code, constraint });
}

const at = (iso: string): Date => new Date(iso);

describe('tasks', () => {
  it('acepta una tarea válida; la fecha límite vuelve como texto YYYY-MM-DD', async () => {
    const row = await db
      .insertInto('tasks')
      .values({ title: 'Renovar el seguro', status: 'todo', position: 0, due_on: '2026-12-31' })
      .returning(['due_on', 'completed_at', 'description_md'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ due_on: '2026-12-31', completed_at: null, description_md: null });
  });

  it.each(['', 'x'.repeat(201)])('el título tiene de 1 a 200 caracteres', async (title) => {
    await expectViolation(insertTask({ title }), '23514', 'tasks_title_check');
  });

  it('la descripción admite hasta 10 000 caracteres', async () => {
    await insertTask({ description_md: 'x'.repeat(10_000) });
    await expectViolation(
      insertTask({ position: 1, description_md: 'x'.repeat(10_001) }),
      '23514',
      'tasks_description_md_check',
    );
  });

  it('la columna es una de las cuatro', async () => {
    await expectViolation(insertTask({ status: 'archived' }), '23514', 'tasks_status_check');
  });

  it('la posición no es negativa', async () => {
    await expectViolation(insertTask({ position: -1 }), '23514', 'tasks_position_check');
  });

  it('completed_at existe si y solo si la tarea está en «Terminado»', async () => {
    await expectViolation(
      insertTask({ status: 'done', completed_at: null }),
      '23514',
      'tasks_completed_matches_status',
    );
    await expectViolation(
      insertTask({ status: 'todo', completed_at: at('2026-11-03T09:00:00Z') }),
      '23514',
      'tasks_completed_matches_status',
    );
    await insertTask({ status: 'done', completed_at: at('2026-11-03T09:00:00Z') });
  });

  describe('unicidad (columna, posición) diferible', () => {
    it('rechaza dos tareas en la misma posición de la misma columna', async () => {
      await insertTask({ position: 0 });
      // INITIALLY DEFERRED: la restricción se comprueba al confirmar. Fuera de una transacción, cada
      // sentencia se confirma sola y falla igualmente.
      await expectViolation(insertTask({ position: 0 }), '23505', 'tasks_status_position_key');
    });

    it('una transacción con posiciones repetidas falla al confirmar, no antes', async () => {
      await insertTask({ position: 0 });
      let insertedInsideTransaction = false;
      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('tasks')
            .values({ title: 'Otra', status: 'todo', position: 0 })
            .execute();
          // La sentencia no ha fallado: la unicidad se comprueba en el COMMIT.
          insertedInsideTransaction = true;
        }),
      ).rejects.toMatchObject({ code: '23505', constraint: 'tasks_status_position_key' });
      expect(insertedInsideTransaction).toBe(true);
      expect(await db.selectFrom('tasks').select('id').execute()).toHaveLength(1);
    });

    it('admite la misma posición en columnas distintas', async () => {
      await insertTask({ status: 'todo', position: 0 });
      await insertTask({ status: 'in_progress', position: 0 });
    });

    it('permite intercambiar posiciones dentro de una transacción', async () => {
      const a = await insertTask({ position: 0 });
      const b = await insertTask({ position: 1 });
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('tasks').set({ position: 1 }).where('id', '=', a.id).execute();
        await trx.updateTable('tasks').set({ position: 0 }).where('id', '=', b.id).execute();
      });
      const rows = await db
        .selectFrom('tasks')
        .select(['id', 'position'])
        .orderBy('position')
        .execute();
      expect(rows).toEqual([
        { id: b.id, position: 0 },
        { id: a.id, position: 1 },
      ]);
    });

    it('una sola sentencia puede desplazar todas las posiciones sin chocar consigo misma', async () => {
      await insertTask({ position: 0 });
      await insertTask({ position: 1 });
      await insertTask({ position: 2 });
      await sql`UPDATE tasks SET position = position + 1`.execute(db);
      const rows = await db.selectFrom('tasks').select('position').orderBy('position').execute();
      expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
    });

    it('con SET CONSTRAINTS … IMMEDIATE se comprueba sentencia a sentencia', async () => {
      await insertTask({ position: 0 });
      await expect(
        db.transaction().execute(async (trx) => {
          await sql`SET CONSTRAINTS tasks_status_position_key IMMEDIATE`.execute(trx);
          await trx
            .insertInto('tasks')
            .values({ title: 'Otra', status: 'todo', position: 0 })
            .execute();
        }),
      ).rejects.toMatchObject({ code: '23505', constraint: 'tasks_status_position_key' });
    });
  });
});

describe('task_time_entries', () => {
  function insertEntry(taskId: string, startedAt: string, endedAt: string | null) {
    return db
      .insertInto('task_time_entries')
      .values({
        task_id: taskId,
        started_at: at(startedAt),
        ended_at: endedAt === null ? null : at(endedAt),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  it('acepta un intervalo cerrado y uno en marcha', async () => {
    const task = (await insertTask()).id;
    await insertEntry(task, '2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z');
    await insertEntry(task, '2026-11-03T09:00:00Z', null);
  });

  it('el fin debe ser posterior al inicio', async () => {
    const task = (await insertTask()).id;
    await expectViolation(
      insertEntry(task, '2026-11-03T09:00:00Z', '2026-11-03T09:00:00Z'),
      '23514',
      'task_time_entries_interval_check',
    );
    await expectViolation(
      insertEntry(task, '2026-11-03T09:00:00Z', '2026-11-03T08:00:00Z'),
      '23514',
      'task_time_entries_interval_check',
    );
  });

  it('una entrada de una tarea inexistente se rechaza (clave ajena)', async () => {
    await expect(
      insertEntry('00000000-0000-4000-8000-000000000000', '2026-11-03T08:00:00Z', null),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('borrar la tarea borra su tiempo en cascada', async () => {
    const task = (await insertTask()).id;
    await insertEntry(task, '2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z');
    await db.deleteFrom('tasks').where('id', '=', task).execute();
    expect(await db.selectFrom('task_time_entries').select('id').execute()).toEqual([]);
  });

  describe('sin solapes, entre tareas distintas incluso', () => {
    it('rechaza intervalos que se pisan (parcial, contenido, igual)', async () => {
      const a = (await insertTask()).id;
      const b = (await insertTask({ position: 1 })).id;
      await insertEntry(a, '2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z');
      for (const [from, to] of [
        ['2026-11-03T08:30:00Z', '2026-11-03T09:30:00Z'],
        ['2026-11-03T07:30:00Z', '2026-11-03T08:30:00Z'],
        ['2026-11-03T08:10:00Z', '2026-11-03T08:20:00Z'],
        ['2026-11-03T07:00:00Z', '2026-11-03T10:00:00Z'],
        ['2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z'],
      ] as const) {
        await expectViolation(insertEntry(b, from, to), '23P01', 'task_time_entries_no_overlap');
      }
    });

    it('admite intervalos contiguos: el fin de uno puede ser el inicio de otro', async () => {
      const task = (await insertTask()).id;
      await insertEntry(task, '2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z');
      await insertEntry(task, '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z');
      await insertEntry(task, '2026-11-03T07:00:00Z', '2026-11-03T08:00:00Z');
    });

    it('un cronómetro en marcha pisa todo lo posterior a su inicio', async () => {
      const task = (await insertTask()).id;
      await insertEntry(task, '2026-11-03T09:00:00Z', null);
      await expectViolation(
        insertEntry(task, '2026-11-03T12:00:00Z', '2026-11-03T13:00:00Z'),
        '23P01',
        'task_time_entries_no_overlap',
      );
      await insertEntry(task, '2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z');
    });
  });

  describe('un solo cronómetro en marcha', () => {
    it('rechaza un segundo cronómetro, de la misma tarea o de otra', async () => {
      const a = (await insertTask()).id;
      const b = (await insertTask({ position: 1 })).id;
      await insertEntry(a, '2026-11-03T09:00:00Z', null);
      for (const task of [a, b]) {
        // La exclusión de solapes también se viola: PostgreSQL informa de la que compruebe antes.
        await expect(insertEntry(task, '2026-11-03T10:00:00Z', null)).rejects.toSatisfy(
          (error: { code?: string }) => error.code === '23505' || error.code === '23P01',
        );
      }
    });

    it('el índice único parcial lo impone por sí solo (sin la exclusión)', async () => {
      const a = (await insertTask()).id;
      const b = (await insertTask({ position: 1 })).id;
      await expect(
        db.transaction().execute(async (trx) => {
          await sql`ALTER TABLE task_time_entries DROP CONSTRAINT task_time_entries_no_overlap`.execute(
            trx,
          );
          await trx
            .insertInto('task_time_entries')
            .values({ task_id: a, started_at: at('2026-11-03T09:00:00Z') })
            .execute();
          await trx
            .insertInto('task_time_entries')
            .values({ task_id: b, started_at: at('2026-11-03T10:00:00Z') })
            .execute();
        }),
      ).rejects.toMatchObject({ code: '23505', constraint: 'task_time_entries_one_running_idx' });
      // La transacción se deshizo, también el DROP de la restricción.
      const exclusion = await sql<{ n: string }>`
        SELECT count(*) AS n FROM pg_constraint WHERE conname = 'task_time_entries_no_overlap'
      `.execute(db);
      expect(exclusion.rows[0]?.n).toBe('1');
    });

    it('al parar el cronómetro se puede arrancar otro', async () => {
      const task = (await insertTask()).id;
      const running = await insertEntry(task, '2026-11-03T09:00:00Z', null);
      await db
        .updateTable('task_time_entries')
        .set({ ended_at: at('2026-11-03T09:30:00Z') })
        .where('id', '=', running.id)
        .execute();
      await insertEntry(task, '2026-11-03T10:00:00Z', null);
    });
  });
});
