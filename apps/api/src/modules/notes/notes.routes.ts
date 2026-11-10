/**
 * Rutas de las notas y las etiquetas (`/api/v1/notes`, `/api/v1/tags`). No declaran guarda propia: las
 * protege la guarda por defecto de la aplicación (sesión activa y CSRF en los métodos que modifican datos).
 * El test de permisos recorre todas las que se registran aquí.
 */
import { Router } from 'express';
import type { createNotesController, createTagsController } from './notes.controller.ts';

export function createNotesRouter(
  notes: ReturnType<typeof createNotesController>,
  tags: ReturnType<typeof createTagsController>,
): Router {
  const router = Router();
  router.get('/notes', notes.list);
  router.post('/notes', notes.create);
  router.get('/notes/:id', notes.get);
  router.patch('/notes/:id', notes.update);
  router.delete('/notes/:id', notes.remove);
  router.get('/tags', tags.list);
  router.patch('/tags/:id', tags.rename);
  return router;
}
