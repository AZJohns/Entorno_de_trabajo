/**
 * Campana del menú con el número de notificaciones sin leer. El número va escrito (no solo un color) y
 * el enlace lo anuncia completo a los lectores de pantalla. Pide el contador al cambiar de pantalla; ver
 * `queries.ts` para saber por qué no se consulta periódicamente.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router';
import { UNREAD_KEY, useUnreadCount } from './queries.ts';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const unread = useUnreadCount();

  // Cambiar de pantalla es actividad de la persona: es el momento de refrescar el contador.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
  }, [pathname, queryClient]);

  const count = unread.data ?? 0;
  const label = count === 0 ? 'Notificaciones' : `Notificaciones, ${String(count)} sin leer`;
  return (
    <NavLink
      to="/notificaciones"
      aria-label={label}
      className="relative inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
    >
      <span aria-hidden="true">🔔</span>
      {count > 0 && (
        <span
          data-testid="unread-count"
          className="min-w-5 rounded-full bg-red-700 px-1.5 text-center text-xs font-semibold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  );
}
