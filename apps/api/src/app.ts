/**
 * Crea la aplicación Express sin ponerla a escuchar, para poder probarla con supertest.
 */
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { errorHandler, notFoundHandler } from './http/errors.ts';
import { createHttpLogger } from './http/logger.ts';

/** Dependencias externas de la aplicación (se inyectan para poder sustituirlas en los tests). */
export interface AppDependencies {
  readonly logger: Logger;
}

/** Límite del cuerpo JSON: la API no recibe documentos grandes por JSON. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Construye la aplicación con todas sus rutas bajo `/api/v1`.
 */
export function createApp({ logger }: AppDependencies): Express {
  const app = express();
  // No se anuncia la tecnología del servidor.
  app.disable('x-powered-by');
  app.use(createHttpLogger(logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const api = express.Router();
  // Comprobación de disponibilidad: sin versión ni detalles internos (ASVS 13.4.5).
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
