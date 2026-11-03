/**
 * Estado de la sesión en la web. La fuente de verdad es `GET /auth/session` (la consulta
 * `['session']`): las pantallas deciden a dónde ir según su `state`.
 */
import { sessionResponseSchema, type SessionResponse } from '@backoffice/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, isApiError, setCsrfToken } from '../api/client.ts';

export const SESSION_QUERY_KEY = ['session'] as const;

/** Lugar de la aplicación que corresponde a cada estado de la sesión. */
export type SessionPlace = 'anonymous' | 'pending' | 'locked' | 'active';

/** Estado de la sesión: `null` si no hay sesión (o ha caducado o se ha cerrado). */
export function placeOf(session: SessionResponse | null): SessionPlace {
  return session === null ? 'anonymous' : session.state;
}

/** Ruta de la pantalla que corresponde a cada estado. */
export const HOME_OF: Record<SessionPlace, string> = {
  anonymous: '/entrar',
  pending: '/entrar/segundo-factor',
  locked: '/desbloquear',
  active: '/',
};

async function fetchSession(): Promise<SessionResponse | null> {
  try {
    const session = await api('/auth/session', { schema: sessionResponseSchema });
    setCsrfToken(session.csrfToken);
    return session;
  } catch (error) {
    if (isApiError(error, 'UNAUTHENTICATED')) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

/**
 * Sesión actual. Se vuelve a pedir al volver a la pestaña: así la pantalla de desbloqueo aparece
 * en cuanto la sesión se bloquea por inactividad. No se consulta periódicamente: eso mantendría la
 * sesión activa sin que el usuario la use y anularía el bloqueo por inactividad.
 */
export function useSession() {
  return useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: fetchSession, staleTime: 30_000 });
}

/** Guarda una sesión recibida en la respuesta de un inicio de sesión, desbloqueo o reautenticación. */
export function storeSession(queryClient: QueryClient, session: SessionResponse): void {
  setCsrfToken(session.csrfToken);
  queryClient.setQueryData(SESSION_QUERY_KEY, session);
}

/**
 * Olvida todo lo que la web sabe de la sesión: el token CSRF y la caché de consultas (que puede
 * contener datos financieros). Se usa al salir y cuando la API dice que no hay sesión.
 */
export function forgetSession(queryClient: QueryClient): void {
  setCsrfToken(null);
  // No se usa `queryClient.clear()`: eliminaría también la consulta de la sesión, a la que están
  // suscritas las guardas, y no verían el cambio a «sin sesión» (la pantalla no cambiaría).
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
}

/** Cierra la sesión en la API y en la web. Aunque la API falle, se olvida en la web. */
export function useLogout(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      forgetSession(queryClient);
    }
  }, [queryClient]);
}

/** Indica si la sesión tiene una reautenticación reciente (ventana de 10 min de la API). */
export function hasRecentReauth(session: SessionResponse, now: number = Date.now()): boolean {
  return session.reauthenticatedUntil !== null && Date.parse(session.reauthenticatedUntil) > now;
}

/**
 * Devuelve `value` si es una ruta interna de la aplicación; si no, `/`. Evita que el parámetro
 * `volver` se use para redirigir a otro sitio (redirección abierta, ASVS 3.7.2).
 */
export function safeInternalPath(value: string | null): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  return value;
}
