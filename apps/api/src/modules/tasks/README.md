# Módulo `tasks` — tareas y tiempo dedicado

Tablero de cuatro columnas (Por hacer, En curso, En prueba, Terminado) con fecha límite opcional y tiempo dedicado. Diseño: `docs/plan.md` §2.6 y §2.10.

**Estado (fase 4, PR 4a de 3):** modelo de datos y API. Las pantallas son el 4b y los recordatorios (`task_reminders`, push y planificador) en el 4c.

## Responsabilidad

- Guardar las tareas y su orden en el tablero.
- Guardar el tiempo dedicado como intervalos (cronómetro y anotación manual) y calcular los totales al leer. **No se guarda ningún dato derivado.**

## Estructura

| Archivo | Contenido | E/S |
|---|---|---|
| `domain/ordering.ts` | `placeTask` (coloca una tarea en una columna, delante o detrás de otra), `placementChanges` (qué filas hay que escribir), `removeTask` | No |
| `domain/time.ts` | `elapsedSeconds`, `totalSeconds` y `stopInstant` | No |
| `tasks.repository.ts` | Consultas de Kysely sobre `tasks`; el bloqueo del tablero y la escritura de posiciones | Base de datos |
| `time-entries.repository.ts` | Consultas sobre `task_time_entries`, con el tiempo agregado por tarea | Base de datos |
| `tasks.service.ts` | Alta, edición, borrado, tablero y movimiento; transacciones y bloqueo | — |
| `time-entries.service.ts` | Cronómetro y anotación manual; traduce los conflictos de la base de datos | — |
| `tasks.controller.ts`, `tasks.routes.ts` | HTTP: validación con los esquemas de `@backoffice/shared` (`packages/shared/src/tasks/schemas.ts`) y respuestas | — |
| `index.ts` | API pública: `createTasksModule({ db, clock })` → `{ tasks, timeEntries, router }` | — |

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

Cada tarea incluye `timeSpentSeconds` (total, calculado al leer; cuenta hasta ahora si el cronómetro está en marcha) y `timerStartedAt` (para que la web muestre el contador).

Códigos de error (mismo criterio que el libro):

| Código | Cuándo |
|---|---|
| 400 | Cuerpo, consulta o identificador no válidos; `beforeId` y `afterId` a la vez; fin de una anotación no posterior al inicio; fin y duración a la vez (o ninguno); más de 7 días; fecha sin zona horaria |
| 404 | La tarea o la entrada de la URL no existe |
| 422 | El cuerpo es válido pero incoherente: la referencia de un movimiento es la propia tarea o **no está en la columna de destino** (no existe, o está en otra); una anotación que **termina en el futuro** |
| 409 | El estado actual lo impide: **ya hay un cronómetro en marcha** (de cualquier tarea); no hay cronómetro que parar en esa tarea; la anotación **se solapa** con otra o con el cronómetro en marcha |

## Tablas

Migración `0006_tasks`: `tasks` y `task_time_entries`. Las restricciones están en la migración, con su porqué, y se prueban una a una en `test/tasks/tasks-schema.test.ts`.

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

## Pendiente (fases 4b y 4c)

- Recordatorios (4c). Las pantallas (4b) están en `apps/web/src/tasks/`.
- La columna «Terminado» crece sin límite. La web (4b) solo **pinta** las 10 más recientes con «Ver más», pero la API sigue devolviendo la columna entera; paginar la descarga pide un `limit` en `GET /tasks?status=done`.
- No hay edición de una entrada de tiempo: se borra y se vuelve a anotar.
