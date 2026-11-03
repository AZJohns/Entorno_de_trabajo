/**
 * API pública del módulo de autenticación. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import { createAuthRateLimiters } from '../../http/rate-limit.ts';
import type { Clock } from '../../lib/clock.ts';
import { createAuthController } from './auth.controller.ts';
import { createSessionMiddleware } from './auth.middleware.ts';
import { createAuthRouter } from './auth.routes.ts';
import { AuthService } from './auth.service.ts';
import { loadCommonPasswords } from './infra/common-passwords.ts';
import type { PasswordBreachChecker } from './infra/hibp.ts';

export type { Access } from './auth.middleware.ts';
export { getSession } from './auth.middleware.ts';
export { AuthService, type InitialCredentials, type SessionContext } from './auth.service.ts';
export { createHibpChecker, type PasswordBreachChecker } from './infra/hibp.ts';

/** Palabras del contexto que ninguna contraseña puede contener (además del nombre de usuario). */
export const CONTEXT_WORDS: readonly string[] = [
  'backoffice',
  'entorno',
  'trabajo',
  'password',
  'contraseña',
];

/** Dependencias del módulo. */
export interface AuthModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly totpKey: Buffer;
  readonly totpKeyVersion: number;
  readonly breachChecker: PasswordBreachChecker;
}

/** Crea el servicio de autenticación (también lo usan los scripts de servidor). */
export function createAuthService(deps: AuthModuleDeps): AuthService {
  return new AuthService({
    ...deps,
    commonPasswords: loadCommonPasswords(),
    contextWords: CONTEXT_WORDS,
    issuer: 'Backoffice',
  });
}

/** Crea el módulo: servicio, middlewares de sesión y router de `/auth`. */
export function createAuthModule(deps: AuthModuleDeps) {
  const service = createAuthService(deps);
  const middleware = createSessionMiddleware(service, deps.clock);
  const controller = createAuthController(service, deps.clock);
  const router = createAuthRouter(controller, middleware.guard, createAuthRateLimiters());
  return { service, router, ...middleware };
}
