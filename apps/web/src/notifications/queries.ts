/**
 * Consultas y mutaciones de las notificaciones. Las respuestas se validan con los esquemas de
 * `@backoffice/shared`.
 *
 * El contador NO se consulta cada cierto tiempo: cada petición con sesión renueva el plazo de
 * inactividad de 1 hora (docs/plan.md §6.2), así que un sondeo mantendría la sesión abierta sin que
 * nadie use la app. Se actualiza cuando la persona actúa: al cambiar de pantalla (la campana lo pide), al
 * volver a la ventana (react-query) y tras marcar notificaciones. Un aviso que llega con la app abierta
 * y quieta se verá en la siguiente interacción; que llegue sin abrirla es el push de la fase 2.
 */
import {
  notificationListResponseSchema,
  notificationResponseSchema,
  unreadCountResponseSchema,
} from '@backoffice/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';

const ROOT = 'notifications';
export const UNREAD_KEY = [ROOT, 'unread'] as const;
export const LIST_KEY = [ROOT, 'list'] as const;

export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => api('/notifications/unread-count', { schema: unreadCountResponseSchema }),
    select: (result) => result.count,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => api('/notifications', { schema: notificationListResponseSchema }),
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
        schema: notificationResponseSchema,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [ROOT] }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [ROOT] }),
  });
}
