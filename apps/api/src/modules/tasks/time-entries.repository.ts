/**
 * Acceso a la tabla `task_time_entries`. Solo consultas: ninguna decisión de negocio.
 *
 * Cada fila es un intervalo; `endedAt === null` es el cronómetro en marcha (a lo sumo uno en toda la
 * aplicación, lo garantiza un índice único parcial).
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import type { Database, TaskTimeEntriesTable } from '../../db/schema.ts';

export interface TimeEntryRecord {
  readonly id: string;
  readonly taskId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

/** Tiempo ya registrado de una tarea, para calcular el total al leer (`domain/time.ts`). */
export interface TimeStats {
  /** Suma de los segundos de las entradas cerradas (cada una redondeada hacia abajo). */
  readonly closedSeconds: number;
  /** Inicio del cronómetro en marcha de la tarea, o `null`. */
  readonly runningSince: Date | null;
}

type EntryRow = Selectable<TaskTimeEntriesTable>;

function toEntry(row: EntryRow): TimeEntryRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export class TimeEntryRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /** Entradas de una tarea, de la más reciente a la más antigua. */
  async listByTask(taskId: string): Promise<TimeEntryRecord[]> {
    const rows = await this.#db
      .selectFrom('task_time_entries')
      .selectAll()
      .where('task_id', '=', taskId)
      .orderBy('started_at', 'desc')
      .execute();
    return rows.map(toEntry);
  }

  async insert(taskId: string, startedAt: Date, endedAt: Date | null): Promise<TimeEntryRecord> {
    const row = await this.#db
      .insertInto('task_time_entries')
      .values({ task_id: taskId, started_at: startedAt, ended_at: endedAt })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toEntry(row);
  }

  /** El cronómetro en marcha, de la tarea que sea. */
  async findRunning(): Promise<TimeEntryRecord | undefined> {
    const row = await this.#db
      .selectFrom('task_time_entries')
      .selectAll()
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    return row === undefined ? undefined : toEntry(row);
  }

  /**
   * Cierra el cronómetro `id` poniéndole fin. La condición `ended_at IS NULL` evita pisar una entrada
   * ya cerrada si dos paradas coinciden.
   *
   * @returns `undefined` si ya no estaba en marcha.
   */
  async close(id: string, endedAt: Date): Promise<TimeEntryRecord | undefined> {
    const row = await this.#db
      .updateTable('task_time_entries')
      .set({ ended_at: endedAt })
      .where('id', '=', id)
      .where('ended_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toEntry(row);
  }

  /** @returns `false` si no existía. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db
      .deleteFrom('task_time_entries')
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /**
   * Tiempo registrado por tarea, agregado en la base de datos. Las tareas sin entradas no aparecen.
   * Los segundos se redondean hacia abajo entrada a entrada (ver `domain/time.ts`).
   */
  async statsByTask(taskIds?: readonly string[]): Promise<Map<string, TimeStats>> {
    if (taskIds?.length === 0) return new Map();
    let query = this.#db.selectFrom('task_time_entries').select([
      'task_id',
      sql<string>`COALESCE(
          SUM(FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)))) FILTER (WHERE ended_at IS NOT NULL),
          0
        )`.as('closed_seconds'),
      sql<Date | null>`MAX(started_at) FILTER (WHERE ended_at IS NULL)`.as('running_since'),
    ]);
    if (taskIds !== undefined) query = query.where('task_id', 'in', taskIds);
    const rows = await query.groupBy('task_id').execute();
    return new Map(
      rows.map((row) => [
        row.task_id,
        // Segundos enteros (no importes): la suma llega como texto desde `numeric`.
        { closedSeconds: Number(row.closed_seconds), runningSince: row.running_since },
      ]),
    );
  }
}
