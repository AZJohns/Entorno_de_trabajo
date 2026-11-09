/**
 * Canales de entrega ADICIONALES al de dentro de la app.
 *
 * La notificación dentro de la app es la propia fila de `notifications`: se crea en la transacción de
 * quien la origina y por eso no es un canal. Un canal es un envío externo (el push de la fase 2) y, al
 * ser E/S de red, NO puede ir dentro de esa transacción: se ejecuta DESPUÉS de confirmarla
 * (`NotificationsService.dispatch`). Un fallo del canal no deshace ni repite la notificación.
 *
 * Fase 4c: no hay ninguna implementación. La fase 2 añadirá `WebPushChannel` (VAPID, suscripciones,
 * docs/plan.md §2.7) y lo pasará a `createNotificationsModule({ channels })`.
 */
import type { NotificationRecord } from './notifications.repository.ts';

export interface NotificationChannel {
  /** Nombre para los logs (p. ej. `web-push`). */
  readonly name: string;
  /** Envía una notificación ya guardada. Si lanza, el servicio lo registra y sigue con el resto. */
  send(notification: NotificationRecord): Promise<void>;
}
