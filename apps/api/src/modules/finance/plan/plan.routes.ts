/**
 * Rutas de lectura del plan (`/api/v1/plan/...`). Todas son GET y se añaden al router del libro (como las
 * del presupuesto) para que el test de permisos las vea junto a las demás. No declaran guarda propia: las
 * protege la guarda por defecto de la aplicación (sesión activa).
 *
 * Fuera de este PR: `/plan/months/:month/comparison` (fase 3b.3) y `/plan/category-mappings` (aplazado).
 */
import type { Router } from 'express';
import type { createPlanController } from './plan.controller.ts';

type Controller = ReturnType<typeof createPlanController>;

export function addPlanRoutes(router: Router, c: Controller): void {
  router.get('/plan/snapshots', c.listSnapshots);
  router.get('/plan/snapshots/:id', c.getSnapshot);
  router.get('/plan/months/:month', c.getMonth);
  router.get('/plan/months/:month/budget', c.budget);
  router.get('/plan/months/:month/projection', c.projection);
  router.get('/plan/months/:month/goals', c.goals);
  router.get('/plan/months/:month/scenarios', c.scenarios);
  router.get('/plan/months/:month/checks', c.checks);
  router.get('/plan/months/:month/dashboard', c.dashboard);
}
