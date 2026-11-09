/**
 * Rutas del presupuesto (`/api/v1/budgets`). Se añaden al router del libro (no a un sub-router) para que
 * el test de permisos las vea junto a las demás. No declaran guarda propia: las protege la guarda por
 * defecto de la aplicación (sesión activa y CSRF en los métodos que modifican datos).
 */
import type { Router } from 'express';
import type { createBudgetController } from './budget.controller.ts';

type Controller = ReturnType<typeof createBudgetController>;

export function addBudgetRoutes(router: Router, c: Controller): void {
  router.get('/budgets', c.list);
  router.post('/budgets', c.create);
  // Antes de «/budgets/:id»: «copy-previous» no es un id.
  router.post('/budgets/copy-previous', c.copyPrevious);
  router.patch('/budgets/:id', c.update);
  router.delete('/budgets/:id', c.remove);
}
