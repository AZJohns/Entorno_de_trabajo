/**
 * Límites de peticiones del inicio de sesión y de los segundos factores (ASVS 6.3.1, 2.4.1).
 * Valores y motivos en docs/seguridad/limites.md.
 *
 * Almacén en memoria: hay una sola instancia de la API y perder los contadores al reiniciar es
 * aceptable. La IP de la petición depende de TRUST_PROXY_HOPS (configuración).
 *
 * No hay bloqueo de cuenta: con un solo usuario, bloquear la cuenta permitiría a cualquiera dejar
 * fuera al propietario (ASVS 6.1.1). Los intentos de segundo factor se limitan además por sesión.
 */
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from './errors.ts';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function limiter(options: {
  windowMs: number;
  limit: number;
  keyGenerator?: () => string;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(options.keyGenerator === undefined ? {} : { keyGenerator: options.keyGenerator }),
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 429, 'Demasiados intentos. Espera unos minutos.'));
    },
  });
}

/** Límites del módulo de autenticación. Se crean por aplicación (cada test parte de cero). */
export interface AuthRateLimiters {
  /** Login: 5 intentos por IP cada 15 min. */
  readonly loginPerIp: RequestHandler;
  /** Login: 20 intentos por hora en total, para frenar un ataque repartido entre muchas IP. */
  readonly loginGlobal: RequestHandler;
  /** Segundo factor, desbloqueo y reautenticación: 10 intentos por IP cada 15 min. */
  readonly factorPerIp: RequestHandler;
}

/** Crea los límites de peticiones de la autenticación. */
export function createAuthRateLimiters(): AuthRateLimiters {
  return {
    loginPerIp: limiter({ windowMs: FIFTEEN_MINUTES, limit: 5 }),
    loginGlobal: limiter({ windowMs: ONE_HOUR, limit: 20, keyGenerator: () => 'global' }),
    factorPerIp: limiter({ windowMs: FIFTEEN_MINUTES, limit: 10 }),
  };
}
