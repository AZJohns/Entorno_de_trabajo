/**
 * Acceso a la tabla `notifications`. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción para que quien crea notificaciones (p. ej. el planificador de
 * recordatorios) las inserte en SU transacción.
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import type { Database, NotificationsTable } from '../../db/schema.ts';

export interface NotificationRecord {
  readonly id: string;
  readonly kind: string;
  readonly referenceId: string | null;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

/** Valores de una notificación nueva. */
export interface NewNotification {
  readonly kind: string;
  readonly referenceId: string | null;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
}

function toNotification(row: Selectable<NotificationsTable>): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    referenceId: row.reference_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export class NotificationRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * Inserta las notificaciones nuevas y devuelve SOLO las que se crearon. Si ya existe una del mismo
   * `(kind, reference_id)`, se omite (índice único parcial): crear la misma notificación dos veces no
   * la duplica.
   */
  async insertMany(items: readonly NewNotification[]): Promise<NotificationRecord[]> {
    if (items.length === 0) return [];
    const rows = await this.#db
      .insertInto('notifications')
      .values(
        items.map((item) => ({
          kind: item.kind,
          reference_id: item.referenceId,
          title: item.title,
          body: item.body,
          created_at: item.createdAt,
        })),
      )
      .onConflict((conflict) =>
        conflict
          .columns(['kind', 'reference_id'])
          .where('reference_id', 'is not', null)
          .doNothing(),
      )
      .returningAll()
      .execute();
    return rows.map(toNotification);
  }

  /** Las más recientes primero. */
  async listLatest(limit: number): Promise<NotificationRecord[]> {
    const rows = await this.#db
      .selectFrom('notifications')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(limit)
      .execute();
    return rows.map(toNotification);
  }

  async countUnread(): Promise<number> {
    const row = await this.#db
      .selectFrom('notifications')
      .select(sql<string>`count(*)`.as('count'))
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async find(id: string): Promise<NotificationRecord | undefined> {
    const row = await this.#db
      .selectFrom('notifications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toNotification(row);
  }

  /** Marca como leída una notificación no leída. `undefined` si no existe o ya estaba leída. */
  async markRead(id: string, at: Date): Promise<NotificationRecord | undefined> {
    const row = await this.#db
      .updateTable('notifications')
      .set({ read_at: at })
      .where('id', '=', id)
      .where('read_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toNotification(row);
  }

  /** Marca como leídas todas las pendientes. Devuelve cuántas cambiaron. */
  async markAllRead(at: Date): Promise<number> {
    const result = await this.#db
      .updateTable('notifications')
      .set({ read_at: at })
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
