/**
 * API pública del módulo de tareas. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import { createTasksController, createTimeEntriesController } from './tasks.controller.ts';
import { createTasksRouter } from './tasks.routes.ts';
import { TasksService } from './tasks.service.ts';
import { TimeEntriesService } from './time-entries.service.ts';

export type { TasksService } from './tasks.service.ts';
export type { TimeEntriesService } from './time-entries.service.ts';

/** Dependencias del módulo. */
export interface TasksModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Crea el módulo: los servicios del tablero y del tiempo, y su router (se monta bajo `/api/v1`). */
export function createTasksModule(deps: TasksModuleDeps) {
  const tasks = new TasksService(deps);
  const timeEntries = new TimeEntriesService(deps);
  const router = createTasksRouter(
    createTasksController(tasks),
    createTimeEntriesController(timeEntries),
  );
  return { tasks, timeEntries, router };
}
