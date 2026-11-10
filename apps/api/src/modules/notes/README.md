# Módulo `notes` — notas y etiquetas

Notas en Markdown con etiquetas y búsqueda de texto completo en español. Diseño: `docs/plan.md` §2.8 y §2.10 (las decisiones de esta fase están en §2.8, «Decisiones de la fase 5a»).

**Estado (fase 5, PR 5a de 2):** modelo de datos, API y búsqueda. Las pantallas son del PR 5b.

## Responsabilidad

- Guardar notas (título y cuerpo en Markdown) y sus etiquetas (N:M).
- Buscar en título y cuerpo, por relevancia y con fragmentos resaltados; filtrar por etiqueta; paginar.
- **No renderiza Markdown ni HTML**: la API devuelve texto. Pintarlo con seguridad es de la web (5b).

## Estructura

| Archivo | Contenido | E/S |
|---|---|---|
| `domain/search.ts` | `buildPrefixQuery` (texto del usuario → entrada de `to_tsquery`), `splitHeadline` (fragmento de `ts_headline` → tramos de texto) y las marcas privadas | No |
| `domain/tags.ts` | `uniqueTagNames`: quita repetidos sin distinguir mayúsculas | No |
| `domain/cursor.ts` | Cursor opaco de la paginación por clave | No |
| `notes.repository.ts` | Consultas sobre `notes`: CRUD, lista por última edición y búsqueda (`to_tsquery`, `ts_rank_cd`, `ts_headline`) | Base de datos |
| `tags.repository.ts` | Consultas sobre `tags` y `note_tags`: lista con recuento, renombrar y `replaceForNote` | Base de datos |
| `notes.service.ts` | Alta, lectura, edición (con la sustitución de etiquetas), borrado y lista; transacciones | — |
| `tags.service.ts` | Lista y renombrado; traduce el conflicto de nombre a 409 | — |
| `notes.controller.ts`, `notes.routes.ts` | HTTP: validación con los esquemas de `@backoffice/shared` (`packages/shared/src/notes/schemas.ts`) y respuestas | — |
| `index.ts` | API pública: `createNotesModule({ db, clock })` → `{ notes, tags, router }` | — |

## Endpoints (`/api/v1`, sesión activa; sin reautenticación)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/notes?q=&tag=&limit=&cursor=` | 200 `{ items, nextCursor }` (`limit` 1–100, 50 por defecto) |
| POST | `/notes` | 201 nota |
| GET, PATCH, DELETE | `/notes/:id` | 200 nota · 204 |
| GET | `/tags` | 200 `{ items: [{ id, name, noteCount }] }` |
| PATCH | `/tags/:id` | 200 etiqueta |

- Una nota completa: `{ id, title, bodyMd, tags: [{ id, name }], createdAt, updatedAt }`.
- Un elemento de la lista: igual pero sin `bodyMd`, con `preview` (200 primeros caracteres) y `snippet` (`null` sin búsqueda; con ella, `[{ text, match }]`).
- `tags` en el PATCH **sustituye** el conjunto completo; sin `tags`, no se tocan.

Códigos de error (mismo criterio que el libro y las tareas):

| Código | Cuándo |
|---|---|
| 400 | Cuerpo, consulta o identificador no válidos (título vacío o de más de 200 caracteres, cuerpo de más de 100 000, más de 20 etiquetas, etiqueta vacía, de más de 40 caracteres o con caracteres de control, campo desconocido, `q` sin ninguna letra ni cifra o de más de 200 caracteres, `limit` fuera de rango); cursor mal formado o **de la lista de otro orden** (el de la lista sin búsqueda no vale con `q`) |
| 404 | La nota o la etiqueta de la URL no existe |
| 409 | **Solo** al renombrar una etiqueta a un nombre ya usado por **otra** (sin distinguir mayúsculas). Cambiar únicamente las mayúsculas de la propia es válido |
| 422 | **No se produce hoy.** Es «cuerpo válido pero incoherente con los datos» (cuenta o categoría inexistente en el libro). Una nota no referencia filas de otras tablas: las etiquetas se crean si no existen |

## Tablas

Migración `0008_notes`: `notes`, `tags` y `note_tags`. Las restricciones (longitudes, etiquetas únicas sin distinguir mayúsculas, claves) están en la migración, con su porqué; se prueban una a una en `test/notes/notes-schema.test.ts`.

## Decisiones

### Búsqueda: `tsvector` generado, `es_unaccent`, GIN

`search_vector` es una columna **generada y almacenada**: PostgreSQL la recalcula al escribir, así que no puede quedar desfasada. Título con peso A y cuerpo con peso B, con la configuración `es_unaccent` (migración `0001`): lematiza («presupuestos» → «presupuest») y no distingue acentos («acción» = «accion»). El índice GIN sirve también para las búsquedas por prefijo.

### Palabras a medias: prefijo `:*` y no `pg_trgm`

Cada término se convierte en `término:*` y se unen con `&`. Reutiliza el índice, la configuración y la lematización de la búsqueda normal; `pg_trgm` exigiría otra extensión, otro índice (grande) y no lematizaría. Cubre lo que importa, escribir el comienzo de una palabra. **Límites**: no encuentra un trozo del medio de una palabra, no tolera erratas y descarta las palabras vacías («de», «la»: una búsqueda solo de ellas da lista vacía, no un error). `buildPrefixQuery` solo conserva letras y cifras de cada término, así que ningún operador de `tsquery` llega a la consulta, y el resultado va como parámetro.

### Resaltado: texto, nunca HTML

`ts_headline` devuelve el texto original con marcas alrededor de las coincidencias; su valor por defecto es `<b>…</b>`, y el texto original puede contener cualquier HTML (`<script>`, `<img onerror>`). Insertar eso en la página sería XSS. Por eso:

1. Se piden marcas privadas (U+E000 / U+E001), no HTML, y el SQL las quita antes del cuerpo por si la nota las contuviera.
2. La API devuelve **tramos de texto** `{ text, match }`: las marcas ya no existen en la respuesta.
3. La web pinta cada tramo como nodo de texto, con `<mark>` si `match`. **Nunca** con `dangerouslySetInnerHTML` (prohibido por lint).

PostgreSQL puede recortar el fragmento y quitar alguna etiqueta HTML que su analizador reconoce; lo que queda llega como texto y la protección es pintarlo como texto, no el saneado. Los tests (`api-notes-search.test.ts`, «fragmentos resaltados») fijan que solo `presupuesto` queda marcado, que no se añade marcado propio y que las marcas privadas no salen.

### Etiquetas: índice sobre `lower(name)` y sustitución atómica

Únicas sin distinguir mayúsculas con un índice único sobre `lower(name)` (no `citext`: sin extensión ni tipo nuevos, y la columna conserva la grafía; límite: `lower()` depende de la configuración regional de la base de datos). Una etiqueta existente conserva su grafía.

Sustituir el conjunto es una transacción con la nota bloqueada: crea las que faltan (`ON CONFLICT (lower(name)) DO NOTHING`, seguro con peticiones simultáneas), borra los enlaces que sobran y añade los que faltan. Todo o nada, también con el título y el cuerpo de la misma petición; dos sustituciones simultáneas no se mezclan (`test/notes/tags-replace.test.ts`).

### Paginación por clave

Cursor opaco: `(updated_at, id)` sin búsqueda y `(relevancia, updated_at, id)` con ella. No por desplazamiento: añadir o borrar notas entre páginas no repite ni salta filas. `updated_at` lo escribe siempre el servicio con el reloj de la aplicación (milisegundos); el `now()` de PostgreSQL llega a microsegundos y no cabría en el cursor.

## Pendiente

- `DELETE /tags/:id`: las etiquetas que se quedan sin notas **no se borran** (se listan con `noteCount: 0`). No se limpian solas en la edición: borrarlas dentro de la transacción podría llevarse el enlace que otra petición acaba de crear.
- `archived_at` y el filtro `?archived=` del plan: no estaban en el alcance del PR 5a.
- Pantallas, vista previa del Markdown y tests de XSS del renderizado: PR 5b.
