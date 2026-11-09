/**
 * Esquemas de las notificaciones dentro de la app, compartidos por la web y la API (docs/plan.md §2.7).
 */
import { z } from 'zod';

/** Tipos de notificación que genera la aplicación. La base de datos solo exige un formato. */
export const NOTIFICATION_KINDS = ['task_reminder'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationResponseSchema = z.object({
  id: z.uuid(),
  /** Qué la originó; la web decide por él a dónde lleva. Un tipo que la web no conozca se muestra igual. */
  kind: z.string(),
  /** Identificador del origen (p. ej. el recordatorio), o `null`. */
  referenceId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  /** `null` mientras no se ha leído. */
  readAt: z.iso.datetime().nullable(),
});

/** Las más recientes primero, con el total de no leídas (que puede superar lo listado). */
export const notificationListResponseSchema = z.object({
  items: z.array(notificationResponseSchema),
  unreadCount: z.int().min(0),
});

export const unreadCountResponseSchema = z.object({ count: z.int().min(0) });

export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
