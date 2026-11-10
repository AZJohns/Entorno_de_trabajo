/**
 * Controladores HTTP de las notificaciones: validan el identificador, llaman al servicio y dan forma a
 * la respuesta. Sin lógica de negocio ni SQL.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type {
  NotificationListResponse,
  NotificationResponse,
  UnreadCountResponse,
} from '@backoffice/shared';
import type { NotificationRecord } from './notifications.repository.ts';
import type { NotificationsService } from './notifications.service.ts';

const idSchema = z.uuid();

export function notificationDto(notification: NotificationRecord): NotificationResponse {
  return {
    id: notification.id,
    kind: notification.kind,
    referenceId: notification.referenceId,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
  };
}

export function createNotificationsController(service: NotificationsService) {
  const list: RequestHandler = async (_req, res) => {
    const { items, unreadCount } = await service.list();
    const body: NotificationListResponse = { items: items.map(notificationDto), unreadCount };
    res.json(body);
  };
  const unreadCount: RequestHandler = async (_req, res) => {
    const body: UnreadCountResponse = { count: await service.unreadCount() };
    res.json(body);
  };
  const markRead: RequestHandler = async (req, res) => {
    res.json(notificationDto(await service.markRead(idSchema.parse(req.params['id']))));
  };
  const markAllRead: RequestHandler = async (_req, res) => {
    await service.markAllRead();
    res.status(204).end();
  };
  return { list, unreadCount, markRead, markAllRead };
}
