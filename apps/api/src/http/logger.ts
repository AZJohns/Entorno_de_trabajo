/**
 * Logger estructurado (pino, JSON) y su integración con Express (pino-http).
 *
 * Reglas (ASVS 16.2 y 14.2.1):
 * - Nunca se registran cookies, cabeceras de autorización, contraseñas, códigos ni tokens: `redact`
 *   los sustituye por "[REDACTED]".
 * - No se registran cuerpos de petición.
 * - La URL se registra **sin la query string**, que puede contener texto de búsqueda.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type DestinationStream, type Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

/** Rutas que pino sustituye por "[REDACTED]" en cualquier línea de log. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.totp',
  '*.code',
  '*.recoveryCode',
  '*.token',
] as const;

/**
 * Crea el logger raíz.
 *
 * @param level Nivel mínimo de log.
 * @param destination Destino opcional (los tests lo usan para capturar la salida).
 */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      // Marca de tiempo ISO 8601 en UTC (ASVS 16.2.2).
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
    },
    destination,
  );
}

function pathWithoutQuery(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

/**
 * Middleware que registra cada petición y le asigna un `requestId`.
 *
 * El identificador lo genera siempre el servidor: no se acepta uno enviado por el cliente, para que
 * no se puedan falsear las trazas.
 */
export function createHttpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    serializers: {
      req: (req: IncomingMessage & { id?: string }) => ({
        id: req.id,
        method: req.method,
        url: pathWithoutQuery(req.url),
        headers: req.headers,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
  });
}
