# Módulo `tasks` — tareas, tiempo dedicado y recordatorios

Tablero de cuatro columnas (Por hacer, En curso, En prueba, Terminado) con fecha límite opcional, tiempo dedicado y recordatorios. Diseño: `docs/plan.md` §2.6 y §2.10.

**Estado (fase 4, PR 4c de 3): terminada.** Modelo de datos y API (4a), pantallas (4b) y recordatorios con su planificador (4c). Los recordatorios se entregan como notificación **dentro de la app**; el envío por push pasa a la fase 2.

## Responsabilidad

- Guardar las tareas y su orden en el tablero.
- Guardar el tiempo dedicado como intervalos (cronómetro y anotación manual) y calcular los totales al leer. **No se guarda ningún dato derivado.**
- Guardar los recordatorios de cada tarea y **entregarlos una sola vez** a su hora, a través del módulo `notifications` (solo por su `index.ts`).

## Estructura

| Archivo | Contenido | E/S |
|---|---|---|
| `domain/ordering.ts` | `placeTask` (coloca una tarea en una columna, delante o detrás de otra), `placementChanges` (qué filas hay que escribir), `removeTask` | No |
| `domain/time.ts` | `elapsedSeconds`, `totalSeconds` y `stopInstant` | No |
| `tasks.repository.ts` | Consultas de Kysely sobre `tasks`; el bloqueo del tablero y la escritura de posiciones | Base de datos |
| `time-entries.repository.ts` | Consultas sobre `task_time_entries`, con el tiempo agregado por tarea | Base de datos |
| `tasks.service.ts` | Alta, edición, borrado, tablero y movimiento; transacciones y bloqueo | — |
| `time-entries.service.ts` | Cronómetro y anotación manual; traduce los conflictos de la base de datos | — |
| `domain/local-time.ts` | `resolveLocalDateTime`: hora local de una zona → instante, con huecos y horas repetidas | No |
| `reminders.repository.ts` | Consultas sobre `task_reminders`; `claimDue` (reclamación con `SKIP LOCKED`) y `recordFailure` | Base de datos |
| `reminders.service.ts` | Alta, lista y borrado de recordatorios; `deliverDue`, la entrega transaccional | — |
| `tasks.controller.ts`, `tasks.routes.ts` | HTTP: validación con los esquemas de `@backoffice/shared` (`packages/shared/src/tasks/schemas.ts`) y respuestas | — |
| `index.ts` | API pública: `createTasksModule({ db, clock, notifications, timeZone? })` → `{ tasks, timeEntries, reminders, router }` | — |

## Endpoints (`/api/v1`, sesión activa; sin reautenticación)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/tasks?status=` | 200 `{ columns: [{ status, tasks }] }` |
| POST | `/tasks` | 201 tarea, al final de la columna |
| GET, PATCH, DELETE | `/tasks/:id` | 200 tarea · 204 |
| POST | `/tasks/:id/move` | 200 `{ task, columns }` con el nuevo orden de las columnas afectadas |
| GET, POST | `/tasks/:id/time-entries` | 200 `{ items }` · 201 entrada |
| POST | `/tasks/:id/timer/start`, `/tasks/:id/timer/stop` | 201 · 200 entrada |
| DELETE | `/time-entries/:id` | 204 |
| GET, POST | `/tasks/:id/reminders` | 200 `{ items }` · 201 recordatorio `{ id, taskId, remindAt, sentAt }` |
| DELETE | `/tasks/:id/reminders/:reminderId` | 204 |

Cada tarea incluye `timeSpentSeconds` (total, calculado al leer; cuenta hasta ahora si el cronómetro está en marcha) y `timerStartedAt` (para que la web muestre el contador).

Códigos de error (mismo criterio que el libro):

| Código | Cuándo |
|---|---|
| 400 | Cuerpo, consulta o identificador no válidos; `beforeId` y `afterId` a la vez; fin de una anotación no posterior al inicio; fin y duración a la vez (o ninguno); más de 7 días; fecha sin zona horaria |
| 404 | La tarea, la entrada o el recordatorio de la URL no existe (o el recordatorio es de otra tarea) |
| 422 | El cuerpo es válido pero incoherente: la referencia de un movimiento es la propia tarea o **no está en la columna de destino** (no existe, o está en otra); una anotación que **termina en el futuro**; un recordatorio cuya **hora local no existe** (hueco de marzo) o que **no es posterior a ahora** |
| 409 | El estado actual lo impide: **ya hay un cronómetro en marcha** (de cualquier tarea); no hay cronómetro que parar en esa tarea; la anotación **se solapa** con otra o con el cronómetro en marcha; la tarea **ya tiene un recordatorio a esa hora** |

## Tablas

Migración `0006_tasks`: `tasks` y `task_time_entries`. Migración `0007_reminders_notifications`: `task_reminders` (y `notifications`, del módulo `notifications`). Las restricciones están en las migraciones, con su porqué; las de `tasks` y tiempo se prueban una a una en `test/tasks/tasks-schema.test.ts`.

## Decisiones

### Orden: enteros consecutivos con unicidad diferible (frente a índices fraccionarios)

`position` es el índice de la tarea en su columna: 0..n-1, sin huecos ni repetidos. `UNIQUE (status, position) DEFERRABLE INITIALLY DEFERRED` impide repetidos, pero se comprueba **al confirmar la transacción**, no fila a fila. Sin ello, mover una tarea (que desplaza a las demás) chocaría consigo mismo en posiciones intermedias según el orden en que PostgreSQL visite las filas.

| | Enteros consecutivos (elegido) | Índices fraccionarios (LexoRank, claves de texto) |
|---|---|---|
| Escrituras por movimiento | Las filas desplazadas (en la práctica, unas pocas: solo se reescriben las que cambian) | Una |
| Concurrencia | Hay que serializar los movimientos (bloqueo) | Casi no hace falta: dos movimientos tocan filas distintas |
| Mantenimiento | Ninguno | Reequilibrar cuando las claves crecen demasiado |
| Legibilidad | `position = 3` es «la cuarta» | Claves opacas (`a0V`, `a0Vm`…) |
| Comprobar el invariante | Exacto: posiciones == 0..n-1 en cada columna | Solo el orden relativo |

Para un solo usuario y decenas de tareas por columna, el coste extra de renumerar es despreciable y se gana legibilidad y un invariante comprobable. Los fraccionarios compensarían con columnas enormes o varios editores a la vez; no es el caso. Que las posiciones sean *consecutivas* no lo garantiza una restricción (la base de datos solo impide repetidos): lo mantiene el servicio y lo comprueban los tests tras cada movimiento.

**Concurrencia.** Alta, borrado y movimiento toman primero `pg_advisory_xact_lock` sobre el tablero, que se libera al terminar la transacción. Dos movimientos a la vez se ejecutan uno tras otro y cada uno ve el orden que dejó el anterior; sin el bloqueo, ambos leerían la misma columna y uno fallaría al confirmar por posiciones repetidas. Es un solo bloqueo para todo el tablero (no por columna): un movimiento puede afectar a dos columnas y, con un usuario, no hay contención que evitar.

**Movimiento.** `placeTask` saca la tarea de su columna y la inserta en la de destino, así que mover dentro de una columna y entre columnas es la misma operación. El ancla (`beforeId` o `afterId`) se busca en la columna de destino *sin* la tarea movida. `placementChanges` compara el orden antes y después y devuelve solo las filas que cambian; el repositorio las escribe en una sola sentencia `UPDATE … FROM unnest(…)`. Esa misma sentencia ajusta `completed_at` (al entrar en «Terminado» se marca, al salir se borra, dentro se conserva), porque el CHECK que lo liga a `status` no es diferible. `updated_at` solo cambia si cambia la columna.

**`beforeId` o `afterId`, no ambos.** `docs/plan.md` listaba los dos como opcionales. Con ambos podrían contradecirse (dos tareas no adyacentes), así que se admite uno solo (400 si llegan los dos) y, sin ninguno, la tarea va al final.

### Fecha límite: `date`, no `timestamptz`

`due_on` es un día del calendario («para el viernes»): no tiene hora ni zona. Un `timestamptz` guardaría un instante, y el día que muestra cambiaría con la zona del que lo lee o con el cambio de horario de marzo y octubre. Un `date` no se mueve. Si una tarea está vencida se decide al leer, comparando con «hoy» en la zona del usuario (`users.timezone`). El instante en que avisar es del recordatorio (`timestamptz`, fase 4c).

### Tiempo dedicado: intervalos, un cronómetro, sin solapes

- **Todo son intervalos** `[started_at, ended_at)`. El cronómetro es un intervalo sin fin (`ended_at IS NULL`); la anotación manual es un intervalo cerrado (inicio y fin, o inicio y duración convertida en fin).
- **El total no se guarda**: `timeSpentSeconds` es la suma de los segundos de las entradas cerradas más lo que lleva el cronómetro en marcha. Cada entrada se redondea hacia abajo, así que el total es exactamente la suma de las duraciones que se listan.
- **Un solo cronómetro en marcha** en toda la aplicación: índice único parcial `((true)) WHERE ended_at IS NULL`. El servicio lo comprueba antes para dar un mensaje preciso y traduce el error de la base de datos si dos arranques coinciden (409).
- **Sin solapes, de ninguna tarea**: restricción de exclusión `EXCLUDE USING gist (tstzrange(started_at, ended_at, '[)') WITH &&)`. Una persona no dedica el mismo minuto a dos tareas, y así el total no cuenta tiempo dos veces. Un cronómetro en marcha es un rango sin fin, así que también impide anotar tiempo posterior a su inicio. Los intervalos contiguos son válidos. Esta exclusión ya impediría por sí sola un segundo cronómetro; se mantiene también el índice único como invariante explícito (se prueba aislado, quitando la exclusión dentro de una transacción que se deshace). Como las dos saltan a la vez, PostgreSQL informa de la primera que compruebe: el servicio traduce ambas a 409.
- **Instantes**: la API recibe y devuelve ISO 8601. Al validar se comparan instantes, no textos (`10:00+02:00` es anterior a `09:00Z`). Las anotaciones manuales no pueden terminar en el futuro (422) ni superar 7 días: es un tope de cordura contra errores al teclear, que además evita desbordar el `Date` de JavaScript; el cronómetro no lo tiene, porque registra lo que ha pasado.
- **Parar un cronómetro** pone `ended_at = ahora`, pero la base de datos exige `fin > inicio`: si el reloj no ha avanzado (o ha retrocedido) se usa `inicio + 1 ms` en vez de rechazar la parada (`stopInstant`).
- **Mover una tarea a «Terminado» no para el cronómetro**; se para a mano. Borrar una tarea borra su tiempo en cascada, también el cronómetro en marcha.

### Recordatorios: la hora local se convierte en la API

El usuario elige una fecha y hora **de Madrid**; la base de datos guarda un instante (`timestamptz`). La web envía `remindAtLocal` (`YYYY-MM-DDTHH:mm`, sin zona) y `domain/local-time.ts` la convierte con `Intl` de Node (datos de zonas horarias completos), **sin dependencia**. Se hace aquí y no en el navegador para que la regla de los cambios de horario exista en un solo sitio, con tests, y no dependa de la zona ni de la versión del navegador de quien escribe el aviso.

| Caso (Madrid) | Qué pasa |
|---|---|
| Hora normal | Un instante: `2026-12-10T09:30` → `08:30Z` (invierno, +1) · `2027-07-10T09:30` → `07:30Z` (verano, +2) |
| **No existe** (último domingo de marzo, 02:00–02:59) | **422**. No hay instante que sea «02:30»; adivinar si quería antes o después movería el aviso sin que se note. `01:59` y `03:00` sí valen |
| **Se repite** (último domingo de octubre, 02:00–02:59) | Se elige la **primera** ocurrencia (horario de verano): `2027-10-31T02:30` → `00:30Z`. Se respeta la hora literal, el aviso nunca llega tarde, y la web muestra CET/CEST. La segunda es `01:30Z`; quien quiera esa franja puede pedir `03:00`, que es única |

El algoritmo prueba el desplazamiento de la zona un día antes y un día después, y acepta un candidato si en ese instante la zona tiene ese desplazamiento: ninguno → hueco, uno → único, dos → repetida. La zona es la constante `REMINDER_TIME_ZONE` (`Europe/Madrid`, `packages/shared`); con un solo usuario no se lee de `users.timezone` (que vale lo mismo por defecto) y el módulo `auth` no expone la zona.

Un recordatorio no puede ser del pasado (422; el instante exacto de ahora tampoco). `UNIQUE (task_id, remind_at)` evita dos avisos idénticos (409). Se pueden borrar tanto los pendientes como los ya entregados. Mover una tarea a «Terminado» no cancela sus recordatorios pendientes.

### Recordatorios: entrega una sola vez

`RemindersService.deliverDue` (lo llama el planificador de `src/jobs/` cada 60 s; el primer ciclo, al arrancar):

1. Abre una transacción.
2. `UPDATE task_reminders SET sent_at = ahora WHERE id IN (SELECT id … WHERE sent_at IS NULL AND remind_at <= ahora ORDER BY remind_at LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING …`.
3. Crea las notificaciones con `notifications.notify(trx, …)` **en esa misma transacción**.
4. Confirma. Después, `notifications.dispatch(creadas)` las reparte a los canales externos (hoy ninguno).

Garantías, y la prueba de cada una (`test/tasks/reminders-delivery.test.ts`):

| Situación | Resultado |
|---|---|
| Dos procesos a la vez | El segundo se salta las filas bloqueadas por el primero (`SKIP LOCKED`): cada aviso lo entrega uno solo |
| El proceso muere a mitad (se mata la conexión con `pg_terminate_backend`) | PostgreSQL deshace la transacción: `sent_at` sigue `NULL`, no hay notificación y el siguiente ciclo lo entrega, una vez. **No existe un estado «reclamado pero no entregado»**: por eso no hace falta un tiempo de espera para recuperar avisos colgados |
| Falla la creación de la notificación | Se deshace todo; se anota `attempts` y `last_error` (diagnóstico) y se relanza el error para el log. Sin tope de intentos: un aviso nunca se abandona |
| Otro proceso crea la misma notificación | El índice único `(kind, reference_id)` de `notifications` lo impide |

Es entrega «exactamente una vez» dentro de la app. El push (fase 2) será «al menos una vez»: un envío externo no puede ir en la transacción, así que va después de confirmar y su fallo no repite el aviso. Un aviso vencido durante una parada se entrega al arrancar. Si hay más de 50 vencidos, cada ciclo entrega 50 más. La notificación lleva el título de la tarea **copiado** (`body`): sobrevive a que se borre o renombre la tarea.

## Pendiente

- Push (fase 2): implementar `NotificationChannel` y decidir qué texto se ve en la pantalla de bloqueo (`plan.md` §5.7).
- Si en el futuro hay varios usuarios o zonas, la zona debe venir de `auth` (su `index.ts`), no de la constante.
- La columna «Terminado» crece sin límite. La web (4b) solo **pinta** las 10 más recientes con «Ver más», pero la API sigue devolviendo la columna entera; paginar la descarga pide un `limit` en `GET /tasks?status=done`.
- No hay edición de una entrada de tiempo: se borra y se vuelve a anotar.
