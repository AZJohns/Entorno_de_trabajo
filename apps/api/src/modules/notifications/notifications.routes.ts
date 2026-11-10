/**
 * Rutas de las notificaciones (`/api/v1/notifications`). No declaran guarda propia: las protege la
 * guarda por defecto de la aplicación (sesión activa y CSRF en los métodos que modifican datos). El test
 * de permisos recorre todas las que se registran aquí.
 */
import { Router } from 'express';
import type { createNotificationsController } from './notifications.controller.ts';

export function createNotificationsRouter(
  notifications: ReturnType<typeof createNotificationsController>,
): Router {
  const router = Router();
  router.get('/notifications', notifications.list);
  router.get('/notifications/unread-count', notifications.unreadCount);
  router.post('/notifications/read-all', notifications.markAllRead);
  router.post('/notifications/:id/read', notifications.markRead);
  return router;
}
