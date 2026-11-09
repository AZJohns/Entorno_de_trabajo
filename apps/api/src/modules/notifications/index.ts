/**
 * API pública del módulo de notificaciones. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import type { NotificationChannel } from './channel.ts';
import { createNotificationsController } from './notifications.controller.ts';
import { createNotificationsRouter } from './notifications.routes.ts';
import { NotificationsService } from './notifications.service.ts';

export type { NotificationChannel } from './channel.ts';
export type { NotificationRecord } from './notifications.repository.ts';
export type { NotificationInput, NotificationsService } from './notifications.service.ts';

/** Dependencias del módulo. */
export interface NotificationsModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Canales externos (push, fase 2). Por defecto, ninguno. */
  readonly channels?: readonly NotificationChannel[];
  /** Dónde se anotan los fallos de un canal. Por defecto, ninguno. */
  readonly onChannelError?: (channel: string, error: unknown) => void;
}

/** Crea el módulo: el servicio y su router (se monta bajo `/api/v1`). */
export function createNotificationsModule(deps: NotificationsModuleDeps) {
  const service = new NotificationsService({
    db: deps.db,
    clock: deps.clock,
    channels: deps.channels ?? [],
    onChannelError:
      deps.onChannelError ??
      (() => {
        /* sin registro: la aplicación pasa el suyo */
      }),
  });
  const router = createNotificationsRouter(createNotificationsController(service));
  return { service, router };
}
