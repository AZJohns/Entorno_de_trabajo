/**
 * Middlewares de sesión: cargan la sesión de la cookie, comprueban el token CSRF y aplican el nivel de
 * acceso que exige cada ruta.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readCookie, SESSION_COOKIE } from '../../http/cookies.ts';
import { AppError } from '../../http/errors.ts';
import { isUnsafeMethod } from '../../http/security.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AuthService, SessionContext } from './auth.service.ts';
import { csrfTokenFor, safeEqual } from './crypto/tokens.ts';
import { hasRecentReauth } from './domain/session-rules.ts';

const SESSION_KEY = 'authSession';

/**
 * Nivel de acceso de una ruta.
 * - `public`: sin sesión (solo el login y /health).
 * - `session`: cualquier sesión válida, también bloqueada o pendiente (consultar la sesión, salir).
 * - `mfa_pending`: tras la contraseña, a falta del segundo factor.
 * - `locked`: sesión bloqueada por inactividad (solo para desbloquearla).
 * - `active`: sesión completa y activa.
 * - `active_reauth`: además, reautenticación completa en los últimos 10 minutos (ASVS 7.5.1).
 */
export type Access = 'public' | 'session' | 'mfa_pending' | 'locked' | 'active' | 'active_reauth';

/** Sesión cargada para esta petición, o `null` si no hay una válida. */
export function getSession(res: Response): SessionContext | null {
  return (res.locals[SESSION_KEY] as SessionContext | null | undefined) ?? null;
}

/** Sesión de la petición; lanza 401 si no la hay (para los controladores de rutas protegidas). */
export function requireSessionContext(res: Response): SessionContext {
  const session = getSession(res);
  if (session === null) throw new AppError('UNAUTHENTICATED', 401, 'Sesión no iniciada');
  return session;
}

/** Crea los middlewares de sesión a partir del servicio. */
export function createSessionMiddleware(service: AuthService, clock: Clock) {
  /** Lee la cookie y carga la sesión (si es válida). No rechaza nada: eso lo hacen las guardas. */
  const loadSession: RequestHandler = async (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    res.locals[SESSION_KEY] =
      token === undefined || token === '' ? null : await service.loadSession(token);
    next();
  };

  /**
   * Token CSRF sincronizado (ASVS 3.5.1): toda petición que modifica datos con una sesión debe llevar
   * en `X-CSRF-Token` el token derivado de esa sesión. Se suma a la comprobación de `Origin`.
   */
  const verifyCsrf: RequestHandler = (req, res, next) => {
    const session = getSession(res);
    if (!isUnsafeMethod(req.method) || session === null) {
      next();
      return;
    }
    const header = req.get('x-csrf-token') ?? '';
    if (!safeEqual(header, csrfTokenFor(session.token))) {
      next(new AppError('CSRF_FAILED', 403, 'Falta el token CSRF o no es válido'));
      return;
    }
    next();
  };

  /** Guarda de acceso de una ruta. */
  function guard(access: Access): RequestHandler {
    return async (_req: Request, res: Response, next: NextFunction) => {
      if (access === 'public') {
        next();
        return;
      }
      const session = getSession(res);
      if (session === null) throw new AppError('UNAUTHENTICATED', 401, 'Sesión no iniciada');
      switch (access) {
        case 'session':
          break;
        case 'mfa_pending':
          if (session.state !== 'pending') {
            throw new AppError('UNAUTHENTICATED', 401, 'No hay un inicio de sesión en curso');
          }
          break;
        case 'locked':
          if (session.state === 'active') {
            throw new AppError('CONFLICT', 409, 'La sesión no está bloqueada');
          }
          if (session.state !== 'locked') {
            throw new AppError('UNAUTHENTICATED', 401, 'Sesión no iniciada');
          }
          break;
        case 'active':
        case 'active_reauth':
          if (session.state === 'pending') {
            throw new AppError('UNAUTHENTICATED', 401, 'Falta el segundo factor');
          }
          if (session.state === 'locked') {
            throw new AppError('SESSION_LOCKED', 401, 'Sesión bloqueada por inactividad');
          }
          if (
            access === 'active_reauth' &&
            !hasRecentReauth(session.reauthenticatedAt, clock.now())
          ) {
            throw new AppError(
              'REAUTH_REQUIRED',
              403,
              'Vuelve a introducir tu contraseña y tu código',
            );
          }
          // Actividad: reinicia el plazo de inactividad de 1 h.
          await service.touch(session);
          break;
      }
      next();
    };
  }

  return { loadSession, verifyCsrf, guard };
}
