/**
 * Rutas de las tareas y del tiempo dedicado (`/api/v1/tasks`, `/api/v1/time-entries`). No declaran
 * guarda propia: las protege la guarda por defecto de la aplicación (sesión activa y CSRF en los métodos
 * que modifican datos). El test de permisos recorre todas las que se registran aquí.
 */
import { Router } from 'express';
import type {
  createRemindersController,
  createTasksController,
  createTimeEntriesController,
} from './tasks.controller.ts';

export function createTasksRouter(
  tasks: ReturnType<typeof createTasksController>,
  time: ReturnType<typeof createTimeEntriesController>,
  reminders: ReturnType<typeof createRemindersController>,
): Router {
  const router = Router();
  router.get('/tasks', tasks.list);
  router.post('/tasks', tasks.create);
  router.get('/tasks/:id', tasks.get);
  router.patch('/tasks/:id', tasks.update);
  router.delete('/tasks/:id', tasks.remove);
  router.post('/tasks/:id/move', tasks.move);
  router.get('/tasks/:id/time-entries', time.list);
  router.post('/tasks/:id/time-entries', time.addManual);
  router.post('/tasks/:id/timer/start', time.start);
  router.post('/tasks/:id/timer/stop', time.stop);
  router.delete('/time-entries/:id', time.remove);
  router.get('/tasks/:id/reminders', reminders.list);
  router.post('/tasks/:id/reminders', reminders.create);
  router.delete('/tasks/:id/reminders/:reminderId', reminders.remove);
  return router;
}
