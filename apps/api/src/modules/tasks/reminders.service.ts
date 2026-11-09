/**
 * Recordatorios de una tarea y su entrega (docs/plan.md §2.6, fase 4c). No conoce `req` ni `res`.
 *
 * Códigos de error (la base de datos impone además las restricciones de la migración 0007):
 * - 404: la tarea o el recordatorio de la URL no existe.
 * - 422 (`UNPROCESSABLE`): el cuerpo es válido pero incoherente con el calendario o el reloj: la hora
 *   local no existe (hueco del cambio de horario de marzo) o el aviso no es posterior a ahora.
 * - 409 (`CONFLICT`): la tarea ya tiene un recordatorio exactamente a esa hora.
 *
 * Entrega («una sola vez»). `deliverDue` reclama los avisos vencidos, los marca como enviados y crea sus
 * notificaciones en UNA transacción:
 * - Si el proceso muere a mitad (reinicio, corte de red), PostgreSQL deshace la transacción: el aviso
 *   sigue pendiente y el siguiente ciclo lo entrega. No se pierde (nunca hay un «reclamado a medias»).
 * - Si dos procesos corren a la vez, `FOR UPDATE SKIP LOCKED` hace que cada aviso lo reclame uno solo.
 * - Si aun así se creara dos veces, el índice único `(kind, reference_id)` de `notifications` lo impide.
 * Es entrega «exactamente una vez» DENTRO de la app. El push de la fase 2 (envío externo) será «al menos
 * una vez»: va después de confirmar (`NotificationsService.dispatch`) y un fallo suyo no repite el aviso.
 */
import type { Kysely } from 'kysely';
import type { CreateReminderRequest } from '@backoffice/shared';
import { isUniqueViolation } from '../../db/errors.ts';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import type { NotificationRecord, NotificationsService } from '../notifications/index.ts';
import { resolveLocalDateTime } from './domain/local-time.ts';
import { ReminderRepository, type ReminderRecord } from './reminders.repository.ts';
import { TaskRepository } from './tasks.repository.ts';
import { notFound } from './tasks.service.ts';

/** Lo que el servicio necesita del módulo de notificaciones (su API pública). */
export type ReminderNotifier = Pick<NotificationsService, 'notify' | 'dispatch'>;

export interface RemindersServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly notifications: ReminderNotifier;
  /** Zona en la que se escribe la hora local de los avisos. */
  readonly timeZone: string;
}

/** Cuántos avisos se entregan por ciclo; si hay más, el siguiente ciclo sigue con el resto. */
const BATCH_SIZE = 50;

const UNIQUE_REMINDER = 'task_reminders_task_remind_at_key';

export class RemindersService {
  readonly #deps: RemindersServiceDeps;

  constructor(deps: RemindersServiceDeps) {
    this.#deps = deps;
  }

  async #assertTask(taskId: string): Promise<void> {
    if ((await new TaskRepository(this.#deps.db).find(taskId)) === undefined) throw notFound();
  }

  /** Recordatorios de una tarea, por hora de aviso (entregados y pendientes). */
  async list(taskId: string): Promise<ReminderRecord[]> {
    await this.#assertTask(taskId);
    return new ReminderRepository(this.#deps.db).listByTask(taskId);
  }

  /**
   * Crea un recordatorio a partir de la fecha y hora locales. 422 si esa hora no existe (hueco de
   * marzo) o si el instante no es posterior a ahora; 409 si ya hay uno igual. Las horas repetidas de
   * octubre se resuelven a la primera ocurrencia (`domain/local-time.ts`).
   */
  async create(taskId: string, input: CreateReminderRequest): Promise<ReminderRecord> {
    await this.#assertTask(taskId);
    const resolved = resolveLocalDateTime(input.remindAtLocal, this.#deps.timeZone);
    if (resolved.kind === 'gap') {
      throw unprocessable(
        'Esa hora no existe ese día por el cambio de horario. Elige una hora anterior o posterior.',
      );
    }
    if (resolved.instant.getTime() <= this.#deps.clock.now().getTime()) {
      throw unprocessable('El recordatorio debe ser posterior a la hora actual');
    }
    try {
      return await new ReminderRepository(this.#deps.db).insert(taskId, resolved.instant);
    } catch (error) {
      if (isUniqueViolation(error, UNIQUE_REMINDER)) {
        throw new AppError('CONFLICT', 409, 'La tarea ya tiene un recordatorio a esa hora');
      }
      throw error;
    }
  }

  /** Borra un recordatorio (pendiente o ya entregado). */
  async delete(taskId: string, reminderId: string): Promise<void> {
    await this.#assertTask(taskId);
    if (!(await new ReminderRepository(this.#deps.db).delete(taskId, reminderId))) {
      throw new AppError('NOT_FOUND', 404, 'El recordatorio no existe');
    }
  }

  /**
   * Entrega los avisos vencidos: los marca como enviados y crea su notificación en una sola
   * transacción (ver la cabecera del archivo). Devuelve cuántos entregó. Si falla, la transacción se
   * deshace, los avisos siguen pendientes, se anota el intento (`attempts`, `last_error`) y se relanza
   * el error para que lo registre quien llama.
   */
  async deliverDue(): Promise<number> {
    const now = this.#deps.clock.now();
    let attempted: string[] = [];
    let created: NotificationRecord[];
    try {
      created = await this.#deps.db.transaction().execute(async (trx) => {
        const claimed = await new ReminderRepository(trx).claimDue(now, BATCH_SIZE);
        attempted = claimed.map((reminder) => reminder.id);
        return this.#deps.notifications.notify(
          trx,
          claimed.map((reminder) => ({
            kind: 'task_reminder',
            referenceId: reminder.id,
            title: 'Recordatorio de tarea',
            body: reminder.taskTitle,
          })),
        );
      });
    } catch (error) {
      await this.#recordFailure(attempted, error);
      throw error;
    }
    // Ya confirmado: los canales externos (push, fase 2) no pueden deshacer ni repetir el aviso.
    await this.#deps.notifications.dispatch(created);
    return attempted.length;
  }

  /** Anota el fallo como diagnóstico. Es de mejor esfuerzo: si la base de datos no responde, no oculta el error original. */
  async #recordFailure(ids: readonly string[], error: unknown): Promise<void> {
    try {
      await new ReminderRepository(this.#deps.db).recordFailure(
        ids,
        error instanceof Error ? error.message : 'Error desconocido',
      );
    } catch {
      /* el error original es el que importa */
    }
  }
}

function unprocessable(message: string): AppError {
  return new AppError('UNPROCESSABLE', 422, message, [{ path: 'remindAtLocal', message }]);
}
