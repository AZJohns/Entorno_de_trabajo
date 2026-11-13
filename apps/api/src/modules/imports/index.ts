/**
 * API pública del módulo de importaciones. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import type { LedgerService } from '../finance/index.ts';
import { createImportsController } from './imports.controller.ts';
import { createImportsRouter } from './imports.routes.ts';
import { ImportsService } from './imports.service.ts';

export type { ImportsService } from './imports.service.ts';
export { UPLOAD_PATH } from './imports.routes.ts';

/** Dependencias del módulo. */
export interface ImportsModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Categorías del libro (servicio público de `finance`). */
  readonly categories: Pick<LedgerService, 'listCategories'>;
  /** Guarda de las rutas S+ (reautenticación reciente); la aplica el módulo de autenticación. */
  readonly requireReauth: RequestHandler;
}

/** Crea el módulo: el servicio de importaciones y su router (se monta bajo `/api/v1`). */
export function createImportsModule(deps: ImportsModuleDeps) {
  const imports = new ImportsService(deps);
  const router = createImportsRouter(createImportsController(imports), deps.requireReauth);
  return { imports, router };
}
