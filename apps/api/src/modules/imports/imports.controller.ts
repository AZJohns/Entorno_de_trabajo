/**
 * Controladores HTTP de la importación: validan la entrada con los esquemas compartidos, llaman al servicio y
 * dan forma a la respuesta. Sin lógica de negocio ni SQL.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  listImportsQuerySchema,
  updateImportDecisionsRequestSchema,
  uploadPlanExcelQuerySchema,
} from '@backoffice/shared';
import { AppError } from '../../http/errors.ts';
import type { ImportsService } from './imports.service.ts';

const idParam = (value: unknown): string => z.uuid().parse(value);

export function createImportsController(service: ImportsService) {
  const upload: RequestHandler = async (req, res) => {
    const query = uploadPlanExcelQuerySchema.parse(req.query);
    // `express.raw` deja `req.body` como Buffer solo si el tipo de contenido es uno de los admitidos.
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        415,
        'El cuerpo debe ser el archivo .xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)',
      );
    }
    const { created, response } = await service.uploadPlanExcel({
      bytes: req.body,
      fileName: query.fileName,
      month: query.month,
    });
    // 200 si ese contenido ya es la foto vigente del mes (no se crea nada); 201 si se crea el lote.
    res.status(created ? 201 : 200).json(response);
  };
  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(listImportsQuerySchema.parse(req.query).month));
  };
  const get: RequestHandler = async (req, res) => {
    res.json(await service.get(idParam(req.params['id'])));
  };
  const discard: RequestHandler = async (req, res) => {
    await service.discard(idParam(req.params['id']));
    res.status(204).end();
  };
  const decide: RequestHandler = async (req, res) => {
    const id = idParam(req.params['id']);
    res.json(await service.updateDecisions(id, updateImportDecisionsRequestSchema.parse(req.body)));
  };
  const confirm: RequestHandler = async (req, res) => {
    // 201 al confirmar; 200 con el mismo `snapshotId` si ya estaba confirmada.
    const { created, response } = await service.confirm(idParam(req.params['id']));
    res.status(created ? 201 : 200).json(response);
  };
  return { upload, list, get, discard, decide, confirm };
}
