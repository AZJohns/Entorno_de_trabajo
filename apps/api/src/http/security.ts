/**
 * Middlewares de seguridad comunes a toda la API (docs/plan.md §6.2, ASVS V3 y V14).
 */
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { AppError } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Indica si el método puede modificar datos (y por tanto exige las comprobaciones de CSRF). */
export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Cabeceras de seguridad con helmet (ASVS 3.4): CSP estricta, HSTS de 1 año con subdominios,
 * `nosniff`, `Referrer-Policy: no-referrer` y prohibición de incrustar la página en marcos.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/** Ninguna respuesta de la API se guarda en cachés del navegador ni intermedias (ASVS 14.3.2, 14.2.2). */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/**
 * Las peticiones que modifican datos solo se aceptan desde el propio origen (ASVS 3.5.1).
 *
 * Se compara `Origin` con el origen público configurado. Si el navegador no envía `Origin`, se acepta
 * `Sec-Fetch-Site: same-origin`. Sin ninguna de las dos (p. ej., curl), se rechaza: los clientes que
 * no son el navegador (el atajo de iPhone, fase 2) usarán su propio mecanismo de autenticación.
 */
export function requireSameOrigin(publicOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (!isUnsafeMethod(req.method)) {
      next();
      return;
    }
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const allowed = origin === undefined ? fetchSite === 'same-origin' : origin === publicOrigin;
    next(
      allowed ? undefined : new AppError('CSRF_FAILED', 403, 'Origen de la petición no permitido'),
    );
  };
}

/**
 * Las peticiones con cuerpo deben ser JSON (ASVS 3.5.2: un formulario de otra web no puede enviar
 * `application/json` sin una petición previa de CORS, que este servidor no autoriza).
 */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody =
    req.get('transfer-encoding') !== undefined || Number(req.get('content-length') ?? '0') > 0;
  if (isUnsafeMethod(req.method) && hasBody && req.is('application/json') === false) {
    next(new AppError('UNSUPPORTED_MEDIA_TYPE', 415, 'El cuerpo debe ser application/json'));
    return;
  }
  next();
};
