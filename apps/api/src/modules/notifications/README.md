# Módulo `notifications` — notificaciones

Avisos de la aplicación al usuario. Diseño: `docs/plan.md` §2.7 y §2.10.

**Estado (fase 4, PR 4c):** canal «dentro de la app» (lista, contador y marcar como leída). El **push** (suscripciones, VAPID, `web-push`) es de la fase 2: aquí solo está preparado el punto de enganche (`NotificationChannel`), sin implementar.

## Responsabilidad

- Guardar las notificaciones y servir su lista, el contador de no leídas y su lectura.
- Ofrecer a los demás módulos una forma de **crear** notificaciones dentro de SU transacción (`notify`) y de repartirlas a canales externos una vez confirmada (`dispatch`).

No decide cuándo avisar: eso es de quien origina el aviso (hoy, `tasks` con los recordatorios).

## Estructura

| Archivo | Contenido | E/S |
|---|---|---|
| `notifications.repository.ts` | Consultas de Kysely sobre `notifications`; inserción que omite duplicados | Base de datos |
| `notifications.service.ts` | `notify`, `dispatch`, `list`, `unreadCount`, `markRead`, `markAllRead` | — |
| `channel.ts` | Interfaz `NotificationChannel` (el hueco del push de la fase 2) | No |
| `notifications.controller.ts`, `notifications.routes.ts` | HTTP: identificadores validados y respuestas con los esquemas de `@backoffice/shared` (`packages/shared/src/notifications/schemas.ts`) | — |
| `index.ts` | API pública: `createNotificationsModule({ db, clock, channels?, onChannelError? })` → `{ service, router }` | — |

Otros módulos importan solo `index.ts` (`NotificationsService`, `NotificationRecord`, `NotificationChannel`).

## Endpoints (`/api/v1`, sesión activa; sin reautenticación)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/notifications` | 200 `{ items, unreadCount }`: las 50 más recientes (más nuevas primero) y el total de no leídas |
| GET | `/notifications/unread-count` | 200 `{ count }` |
| POST | `/notifications/:id/read` | 200 notificación. Idempotente: si ya estaba leída no cambia `read_at`. 404 si no existe |
| POST | `/notifications/read-all` | 204 |

Los endpoints de suscripción, clave VAPID, prueba y preferencias (`plan.md` §2.10) son de la fase 2.

## Tablas

Migración `0007_reminders_notifications`: `notifications` (y `task_reminders`, del módulo `tasks`). Las restricciones están en la migración, con su porqué.

## Decisiones

### Crear dentro de la transacción de quien origina

`notify(trx, inputs)` recibe la transacción del llamante. El aviso y su origen (en los recordatorios, marcar `sent_at`) se confirman o se deshacen **juntos**: no hay aviso marcado sin notificación ni notificación sin aviso. Pasar un `Kysely`/transacción por la API pública cruza la frontera entre módulos solo con el tipo de la conexión, no con tablas ajenas.

### Una sola vez por origen

Índice único parcial `(kind, reference_id) WHERE reference_id IS NOT NULL` y `INSERT … ON CONFLICT DO NOTHING`. Crear dos veces la notificación del mismo origen (otro proceso, un reintento) no la duplica; `notify` devuelve solo las creadas. Es el segundo cerrojo: el primero es la reclamación con `SKIP LOCKED` de quien origina. Una notificación sin `reference_id` no se deduplica.

### `reference_id` sin clave ajena

El origen es de otro módulo (y puede borrarse: borrar una tarea borra sus recordatorios). La notificación guarda su propio texto (título y cuerpo) y sobrevive.

### Canales externos: después de confirmar

El canal «dentro de la app» es la propia fila, por eso no es un `NotificationChannel`. Un canal es un envío externo (el push) y, siendo E/S de red, **no puede ir dentro de la transacción**: se reparte con `dispatch(creadas)` DESPUÉS de confirmar. Un canal que falla se anota (`onChannelError`) y no impide los demás ni repite ni deshace el aviso: con el push la entrega es «al menos una vez», y reintentar un envío fallido es cosa del canal (fase 2). Sin canales configurados, `dispatch` no hace nada.

### Lista acotada a 50

Es una bandeja de avisos, no un historial. El contador cuenta todas las no leídas, aunque no salgan en la lista.

## Pendiente

- Retención: las notificaciones leídas crecen sin límite. Tiene sentido una limpieza periódica en el planificador (como las sesiones caducadas, `plan.md` pregunta 35); no hace falta con el volumen de un solo usuario.
- Push (fase 2): `WebPushChannel`, suscripciones y el hueco de privacidad de la pantalla de bloqueo (`plan.md` §5.7).
