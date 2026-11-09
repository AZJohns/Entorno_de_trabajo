/**
 * Reglas de las notificaciones dentro de la app (docs/plan.md §2.7, fase 4c). No conoce `req` ni `res`.
 *
 * Códigos de error: 404 si la notificación de la URL no existe. Marcar como leída es idempotente:
 * repetirlo no cambia `read_at` ni falla.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import type { NotificationChannel } from './channel.ts';
import {
  NotificationRepository,
  type NewNotification,
  type NotificationRecord,
} from './notifications.repository.ts';

export interface NotificationsServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Canales externos (push, en la fase 2). Vacío en la fase 4c. */
  readonly channels: readonly NotificationChannel[];
  /** Dónde se anotan los fallos de un canal. */
  readonly onChannelError: (channel: string, error: unknown) => void;
}

/** Notificación pedida por otro módulo. La fecha de creación la pone el reloj del servicio. */
export type NotificationInput = Omit<NewNotification, 'createdAt'>;

/** Tope de la lista: es una bandeja de avisos, no un historial; el contador sí cuenta todas. */
export const NOTIFICATION_LIST_LIMIT = 50;

export interface NotificationList {
  readonly items: readonly NotificationRecord[];
  readonly unreadCount: number;
}

export class NotificationsService {
  readonly #deps: NotificationsServiceDeps;

  constructor(deps: NotificationsServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Crea notificaciones DENTRO de la transacción de quien las origina: si esa transacción se deshace,
   * no queda ninguna. Si ya existía una del mismo `(kind, referenceId)` no se duplica. Devuelve solo
   * las creadas; después de confirmar la transacción hay que pasarlas a `dispatch`.
   */
  async notify(
    trx: Kysely<Database>,
    inputs: readonly NotificationInput[],
  ): Promise<NotificationRecord[]> {
    const createdAt = this.#deps.clock.now();
    return new NotificationRepository(trx).insertMany(
      inputs.map((input) => ({ ...input, createdAt })),
    );
  }

  /**
   * Entrega las notificaciones ya confirmadas por los canales externos. Un canal que falla se anota y
   * no impide los demás ni lanza: el aviso ya está guardado y no debe repetirse por un fallo de envío.
   */
  async dispatch(notifications: readonly NotificationRecord[]): Promise<void> {
    for (const notification of notifications) {
      for (const channel of this.#deps.channels) {
        try {
          await channel.send(notification);
        } catch (error) {
          this.#deps.onChannelError(channel.name, error);
        }
      }
    }
  }

  async list(): Promise<NotificationList> {
    const repo = new NotificationRepository(this.#deps.db);
    const [items, unreadCount] = await Promise.all([
      repo.listLatest(NOTIFICATION_LIST_LIMIT),
      repo.countUnread(),
    ]);
    return { items, unreadCount };
  }

  async unreadCount(): Promise<number> {
    return new NotificationRepository(this.#deps.db).countUnread();
  }

  /** Marca una notificación como leída (si ya lo estaba, la devuelve tal cual). */
  async markRead(id: string): Promise<NotificationRecord> {
    const repo = new NotificationRepository(this.#deps.db);
    const updated = await repo.markRead(id, this.#deps.clock.now());
    if (updated !== undefined) return updated;
    const existing = await repo.find(id);
    if (existing === undefined) throw new AppError('NOT_FOUND', 404, 'La notificación no existe');
    return existing;
  }

  async markAllRead(): Promise<void> {
    await new NotificationRepository(this.#deps.db).markAllRead(this.#deps.clock.now());
  }
}
