/**
 * API pública del módulo de tareas. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { Kysely } from 'kysely';
import { REMINDER_TIME_ZONE } from '@backoffice/shared';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import type { ReminderNotifier } from './reminders.service.ts';
import { RemindersService } from './reminders.service.ts';
import {
  createRemindersController,
  createTasksController,
  createTimeEntriesController,
} from './tasks.controller.ts';
import { createTasksRouter } from './tasks.routes.ts';
import { TasksService } from './tasks.service.ts';
import { TimeEntriesService } from './time-entries.service.ts';

export type { RemindersService } from './reminders.service.ts';
export type { TasksService } from './tasks.service.ts';
export type { TimeEntriesService } from './time-entries.service.ts';

/** Dependencias del módulo. */
export interface TasksModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Módulo de notificaciones (su servicio público): destino de los avisos de los recordatorios. */
  readonly notifications: ReminderNotifier;
  /** Zona en la que se escriben los recordatorios. Por defecto, Europe/Madrid. */
  readonly timeZone?: string;
}

/** Crea el módulo: los servicios del tablero, del tiempo y de los recordatorios, y su router. */
export function createTasksModule(deps: TasksModuleDeps) {
  const tasks = new TasksService(deps);
  const timeEntries = new TimeEntriesService(deps);
  const reminders = new RemindersService({
    db: deps.db,
    clock: deps.clock,
    notifications: deps.notifications,
    timeZone: deps.timeZone ?? REMINDER_TIME_ZONE,
  });
  const router = createTasksRouter(
    createTasksController(tasks),
    createTimeEntriesController(timeEntries),
    createRemindersController(reminders),
  );
  return { tasks, timeEntries, reminders, router };
}
