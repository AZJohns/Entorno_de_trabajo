/**
 * API pública del módulo de finanzas. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import {
  createExportController,
  createLedgerController,
  createReportsController,
  type RecordExport,
} from './ledger/ledger.controller.ts';
import { createBudgetController } from './budget/budget.controller.ts';
import { addBudgetRoutes } from './budget/budget.routes.ts';
import { BudgetService } from './budget/budget.service.ts';
import { createLedgerRouter } from './ledger/ledger.routes.ts';
import { LedgerService } from './ledger/ledger.service.ts';
import { PlanService } from './plan/plan.service.ts';
import { ReportsService } from './ledger/reports.service.ts';

export type { BudgetService } from './budget/budget.service.ts';
export type { LedgerService } from './ledger/ledger.service.ts';
export type { NewPlanSnapshot, PlanService, PlanSnapshotSummary } from './plan/plan.service.ts';

/** Dependencias del módulo. */
export interface FinanceModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Guarda de las rutas S+ (reautenticación reciente); la aplica el módulo de autenticación. */
  readonly requireReauth: RequestHandler;
  /** Deja constancia en la auditoría de una exportación. */
  readonly recordExport: RecordExport;
}

/**
 * Crea el módulo: los servicios del libro, del presupuesto y de la capa del plan, y su router (se monta
 * bajo `/api/v1`). `budgets` y `plan` son la puerta de entrada de otros módulos (la importación de la fase
 * 3b): ambos se pueden usar dentro de una transacción ajena con `withDb`.
 */
export function createFinanceModule(deps: FinanceModuleDeps) {
  const ledger = new LedgerService(deps);
  const budgets = new BudgetService(deps);
  const plan = new PlanService(deps);
  const router = createLedgerRouter(
    createLedgerController(ledger),
    createReportsController(new ReportsService(deps.db)),
    createExportController(ledger, deps.recordExport),
    deps.requireReauth,
  );
  addBudgetRoutes(router, createBudgetController(budgets));
  return { ledger, budgets, plan, router };
}
