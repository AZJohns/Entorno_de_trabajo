/**
 * API pública del módulo de importaciones. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import type { BudgetService, LedgerService, PlanService } from '../finance/index.ts';
import { createImportsController } from './imports.controller.ts';
import { createImportsRouter } from './imports.routes.ts';
import { ImportsRepository } from './imports.repository.ts';
import { ImportsService } from './imports.service.ts';

export type { ImportsService } from './imports.service.ts';
export { UPLOAD_PATH } from './imports.routes.ts';

/** Dependencias del módulo. */
export interface ImportsModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Categorías del libro (servicio público de `finance`). */
  readonly categories: Pick<LedgerService, 'listCategories'>;
  /** Presupuesto por categoría y mes (servicio público de `finance`): la confirmación lo rellena. */
  readonly budgets: BudgetService;
  /** Capa del plan (servicio público de `finance`): la foto del mes y las correspondencias. */
  readonly plan: PlanService;
  /** Guarda de las rutas S+ (reautenticación reciente); la aplica el módulo de autenticación. */
  readonly requireReauth: RequestHandler;
}

/** Crea el módulo: el servicio de importaciones y su router (se monta bajo `/api/v1`). */
export function createImportsModule(deps: ImportsModuleDeps) {
  const imports = new ImportsService(deps);
  const router = createImportsRouter(createImportsController(imports), deps.requireReauth);
  return { imports, router };
}

/**
 * Mantenimiento periódico de las importaciones (lo ejecuta el planificador de `jobs/`): solo necesita la base
 * de datos y el reloj, no los servicios de `finance`.
 */
export function createImportsMaintenance(deps: Pick<ImportsModuleDeps, 'db' | 'clock'>) {
  const repository = new ImportsRepository(deps.db);
  return {
    /** Caduca las vistas previas pasadas de las 24 h y vacía sus entradas. @returns cuántas. */
    expireStalePreviews: (): Promise<number> => repository.expirePreviews(deps.clock.now()),
  };
}
