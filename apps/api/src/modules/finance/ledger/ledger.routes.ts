/**
 * Rutas del libro real (`/api/v1/...`). No declaran guarda propia: las protege la guarda por defecto
 * de la aplicación (sesión activa), igual que cualquier ruta que no sea de `/auth`.
 */
import { Router } from 'express';
import type { createLedgerController } from './ledger.controller.ts';

type Controller = ReturnType<typeof createLedgerController>;

export function createLedgerRouter(c: Controller): Router {
  const router = Router();

  router.get('/accounts', c.listAccounts);
  router.post('/accounts', c.createAccount);
  router.get('/accounts/:id', c.getAccount);
  router.patch('/accounts/:id', c.updateAccount);
  router.post('/accounts/:id/archive', c.archiveAccount);
  router.get('/accounts/:id/reconciliations', c.listReconciliations);
  router.post('/accounts/:id/reconciliations', c.createReconciliation);
  router.delete('/reconciliations/:id', c.deleteReconciliation);

  router.get('/categories', c.listCategories);
  router.post('/categories', c.createCategory);
  router.patch('/categories/:id', c.renameCategory);
  router.post('/categories/:id/archive', c.archiveCategory);

  router.get('/movements', c.listMovements);
  router.post('/movements', c.createMovement);
  // Antes de «/movements/:id»: «pending» no es un id.
  router.get('/movements/pending/count', c.pendingCount);
  router.get('/movements/:id', c.getMovement);
  router.patch('/movements/:id', c.updateMovement);
  router.delete('/movements/:id', c.deleteMovement);
  router.post('/movements/:id/confirm', c.confirmMovement);

  router.get('/transfers', c.listTransfers);
  router.post('/transfers', c.createTransfer);
  router.get('/transfers/:id', c.getTransfer);
  router.patch('/transfers/:id', c.updateTransfer);
  router.delete('/transfers/:id', c.deleteTransfer);

  return router;
}
