/**
 * Acceso a la tabla `task_reminders`. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción: la reclamación de avisos vencidos corre en la misma transacción
 * que crea las notificaciones.
 */
import type { Kysely, Selectable } from 'kysely';
import type { Database, TaskRemindersTable } from '../../db/schema.ts';

export interface ReminderRecord {
  readonly id: string;
  readonly taskId: string;
  readonly remindAt: Date;
  /** `null` mientras está pendiente. */
  readonly sentAt: Date | null;
}

/** Un aviso reclamado, con el título de su tarea para redactar la notificación. */
export interface ClaimedReminder {
  readonly id: string;
  readonly taskId: string;
  readonly remindAt: Date;
  readonly taskTitle: string;
}

function toReminder(row: Selectable<TaskRemindersTable>): ReminderRecord {
  return { id: row.id, taskId: row.task_id, remindAt: row.remind_at, sentAt: row.sent_at };
}

export class ReminderRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /** Avisos de una tarea por fecha del aviso. */
  async listByTask(taskId: string): Promise<ReminderRecord[]> {
    const rows = await this.#db
      .selectFrom('task_reminders')
      .selectAll()
      .where('task_id', '=', taskId)
      .orderBy('remind_at')
      .orderBy('id')
      .execute();
    return rows.map(toReminder);
  }

  async insert(taskId: string, remindAt: Date): Promise<ReminderRecord> {
    const row = await this.#db
      .insertInto('task_reminders')
      .values({ task_id: taskId, remind_at: remindAt })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toReminder(row);
  }

  /** Borra un aviso de esa tarea. `false` si no existe (o es de otra tarea). */
  async delete(taskId: string, reminderId: string): Promise<boolean> {
    const result = await this.#db
      .deleteFrom('task_reminders')
      .where('id', '=', reminderId)
      .where('task_id', '=', taskId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /**
   * Reclama los avisos vencidos y pendientes y los marca como enviados, en UNA sola sentencia.
   *
   * `FOR UPDATE SKIP LOCKED` hace que dos procesos a la vez no se pisen: el segundo se salta las filas
   * que el primero tiene bloqueadas y reclama otras (o ninguna). El bloqueo dura hasta el fin de la
   * transacción del llamante, que es donde se crean las notificaciones: por eso «reclamado» y
   * «entregado» ocurren juntos o no ocurren (si el proceso muere, se deshace y el aviso sigue pendiente).
   *
   * Aunque el planificador de PostgreSQL devolviera más filas que `limit`, todas se actualizan y se
   * devuelven en el `RETURNING`, así que ninguna queda marcada sin entregar.
   *
   * @param now Instante actual (el del reloj de la aplicación): se compara con `remind_at` y se guarda
   *   como `sent_at`.
   */
  async claimDue(now: Date, limit: number): Promise<ClaimedReminder[]> {
    const claimed = await this.#db
      .updateTable('task_reminders')
      .set({ sent_at: now })
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('task_reminders')
          .select('id')
          .where('sent_at', 'is', null)
          .where('remind_at', '<=', now)
          .orderBy('remind_at')
          .orderBy('id')
          .limit(limit)
          .forUpdate()
          .skipLocked(),
      )
      .returning(['id', 'task_id', 'remind_at'])
      .execute();
    if (claimed.length === 0) return [];
    const tasks = await this.#db
      .selectFrom('tasks')
      .select(['id', 'title'])
      .where(
        'id',
        'in',
        claimed.map((row) => row.task_id),
      )
      .execute();
    const titles = new Map(tasks.map((task) => [task.id, task.title]));
    return claimed.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      remindAt: row.remind_at,
      // La tarea no puede faltar (FK con cascada y la misma transacción), pero no se inventa un texto.
      taskTitle: titles.get(row.task_id) ?? '',
    }));
  }

  /** Anota un fallo del planificador (diagnóstico): cuenta el intento y guarda el motivo. */
  async recordFailure(ids: readonly string[], message: string): Promise<void> {
    if (ids.length === 0) return;
    await this.#db
      .updateTable('task_reminders')
      .set((eb) => ({ attempts: eb('attempts', '+', 1), last_error: message.slice(0, 500) }))
      .where('id', 'in', ids)
      .where('sent_at', 'is', null)
      .execute();
  }
}
