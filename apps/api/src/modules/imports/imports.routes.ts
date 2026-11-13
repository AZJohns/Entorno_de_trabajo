/**
 * Rutas de la importación (`/api/v1/imports`). La subida es S+ (reautenticación reciente); el resto, S
 * (también `PATCH decisions` y `POST confirm`, como en docs/plan.md §2.10; las dos modifican y llevan CSRF). No
 * declaran guarda de sesión propia: la pone la guarda por defecto de la aplicación (denegar por defecto).
 */
import express, { Router, type RequestHandler } from 'express';
import { AppError } from '../../http/errors.ts';
import type { createImportsController } from './imports.controller.ts';
import { MAX_FILE_BYTES } from './domain/template.ts';

/** Ruta de la subida (sin `/api/v1`): la comparte `app.ts` para no exigirle `application/json`. */
export const UPLOAD_PATH = '/imports/plan-excel';

/** Tipos de contenido admitidos para el cuerpo binario. Nunca `text/plain` ni formularios. */
const UPLOAD_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // En minúsculas: `type-is` pasa a minúsculas el tipo de la petición, no los de esta lista.
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/octet-stream',
];

const rawBody = express.raw({ type: UPLOAD_TYPES, limit: MAX_FILE_BYTES });

const TOO_LARGE_MESSAGE = 'El archivo supera el tamaño máximo de 5 MB';

/**
 * Lee el cuerpo en memoria (nunca en disco) con el límite de tamaño. Un archivo mayor se rechaza con el
 * código del catálogo (`FILE_TOO_LARGE`) en lugar del 413 genérico de `body-parser`.
 */
const readUpload: RequestHandler = (req, res, next) => {
  rawBody(req, res, (error?: unknown) => {
    const tooLarge =
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large';
    next(
      tooLarge
        ? new AppError('PAYLOAD_TOO_LARGE', 413, TOO_LARGE_MESSAGE, [
            { path: 'FILE_TOO_LARGE', message: TOO_LARGE_MESSAGE },
          ])
        : error,
    );
  });
};

export function createImportsRouter(
  controller: ReturnType<typeof createImportsController>,
  requireReauth: RequestHandler,
): Router {
  const router = Router();
  // Primero la reautenticación y solo después se lee el cuerpo: sin ella no se procesa ni un byte.
  router.post(UPLOAD_PATH, requireReauth, readUpload, controller.upload);
  router.get('/imports', controller.list);
  router.get('/imports/:id', controller.get);
  router.delete('/imports/:id', controller.discard);
  router.patch('/imports/:id/decisions', controller.decide);
  router.post('/imports/:id/confirm', controller.confirm);
  return router;
}
