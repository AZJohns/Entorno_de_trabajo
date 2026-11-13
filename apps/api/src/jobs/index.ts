/**
 * Trabajos programados de la API (infraestructura: depende de los módulos, no al revés; docs/plan.md §1.4).
 *
 * Construye sus propios servicios sobre la misma base de datos: los servicios no guardan estado en
 * memoria, así que no hace falta compartir instancias con `createApp`.
 */
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from '../db/schema.ts';
import type { Clock } from '../lib/clock.ts';
import { createImportsMaintenance } from '../modules/imports/index.ts';
import { createNotificationsModule } from '../modules/notifications/index.ts';
import { createTasksModule } from '../modules/tasks/index.ts';
import type { Job } from './scheduler.ts';

/** Cada cuánto se comprueban los recordatorios vencidos. */
export const JOBS_INTERVAL_MS = 60_000;

export interface JobsDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Los trabajos de la aplicación. */
export function createJobs(deps: JobsDeps): Job[] {
  const notifications = createNotificationsModule({
    db: deps.db,
    clock: deps.clock,
    onChannelError: (channel, error) => {
      deps.logger.error({ err: error, channel }, 'Falló un canal de notificaciones');
    },
  });
  const tasks = createTasksModule({
    db: deps.db,
    clock: deps.clock,
    notifications: notifications.service,
  });
  const importsMaintenance = createImportsMaintenance({ db: deps.db, clock: deps.clock });
  return [
    {
      name: 'caducidad-de-importaciones',
      async run() {
        // Solo el recuento: sin nombres de archivo ni contenido en los logs.
        const expired = await importsMaintenance.expireStalePreviews();
        if (expired > 0) deps.logger.info({ expired }, 'Vistas previas de importación caducadas');
      },
    },
    {
      name: 'recordatorios-de-tareas',
      async run() {
        const delivered = await tasks.reminders.deliverDue();
        // Solo el recuento: ni títulos ni contenido de las tareas en los logs.
        if (delivered > 0) deps.logger.info({ delivered }, 'Recordatorios entregados');
      },
    },
  ];
}
