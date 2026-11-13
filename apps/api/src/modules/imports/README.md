# Módulo `imports` — importación del Excel del plan

Lee el Excel del plan financiero (plantilla v2), lo valida y guarda una vista previa. Contrato de la plantilla: `docs/plantilla-excel.md`. Diseño: `docs/plan.md` §2.5, §2.10, §3 y, para lo decidido en esta parte, §3.9.

**Estado (fase 3b.1, PR 2 de 3):** lector, validación de los 4 niveles y vista previa (PR 1), más las decisiones sobre categorías y la confirmación en una sola transacción: foto del plan, `category_budgets`, correspondencias persistentes, idempotencia contra la foto vigente y caducidad (PR 2). La pantalla web es el PR 3.

## Responsabilidad

- Recibir el `.xlsx` en memoria, **comprobar el archivo**, leer las cinco hojas de entrada y devolver **solo entradas** (nunca totales, proyecciones ni estados calculados) con todos los problemas encontrados.
- Guardar el resultado como un lote (`import_batches`): vista previa (`preview`), estructura inválida (`failed`), y los estados `discarded`, `expired` y `confirmed`.
- **Confirmar**: escribir, en una sola transacción, la foto del plan con sus filas (`finance/plan`), el presupuesto por categoría (`finance/budget`) y las correspondencias de categorías, y cerrar el lote. Este módulo no escribe SQL en las tablas del plan ni de los presupuestos: usa `PlanService` y `BudgetService` por `finance/index.ts` (`withDb(trx)`).
- **No guarda el archivo**, no evalúa fórmulas ni ejecuta nada de su contenido.

## Estructura

| Archivo | Contenido | E/S |
|---|---|---|
| `domain/zip.ts` | Lector de ZIP: número de entradas y tamaño declarado antes de descomprimir; descompresión con `maxOutputLength`; CRC-32; sin ZIP64 ni cifrado | No |
| `domain/xml.ts` | XML estricto (SAX): rechaza `<!DOCTYPE`/`<!ENTITY`, solo entidades predefinidas, profundidad ≤ 64 | No |
| `domain/workbook.ts` | Libro OOXML: hojas, cadenas compartidas, formatos de fecha, sistema 1904, fórmulas (texto) y fórmulas compartidas expandidas | No |
| `domain/formula.ts` | `translateFormula` (fórmulas compartidas) y `parseFormula` (formas cerradas REF, SUMRANGE, PRODUCT2 y ZERO, §5); nunca evalúa | No |
| `domain/file.ts` | Nivel 1: tamaño, extensión, firma ZIP, estructura OOXML, límites, macros y vínculos externos | No |
| `domain/template.ts` | Configuración de la plantilla v2 en un solo sitio: hojas, cabeceras, etiquetas de resumen y límites | No |
| `domain/layout.ts` | Fin de la tabla de cada hoja y bloque de resumen (§2.1) | No |
| `domain/cells.ts` | Lectura de celdas por tipo (§4): importe, meses, fecha, texto, lista, Sí/No | No |
| `domain/extract.ts` | Extracción y validación de las cinco hojas (§6) y comprobaciones cruzadas (§7) | No |
| `domain/parse-plan.ts` | Orquesta los niveles 1 a 4: `parsePlanExcel(bytes, opciones)` → `rejected`, `failed` o `preview` | No |
| `domain/content-hash.ts`, `domain/summary.ts` | Hash canónico del contenido; recuentos de la vista previa | No |
| `domain/decisions.ts` | Decisiones aplicadas al leer (`effectivePlan`, `effectiveIssues`) y presupuesto por categoría (`budgetsByCategory`) | No |
| `imports.repository.ts` | Consultas sobre `import_batches` (los `jsonb` se validan con los esquemas compartidos al leer); lectura con bloqueo de fila (`findForUpdate`) | Base de datos |
| `imports.service.ts` | Correspondencia de categorías, alta del lote, lectura, lista, descarte, decisiones y confirmación transaccional; traduce el nivel 1 a 413/415/422 | — |
| `imports.controller.ts`, `imports.routes.ts` | HTTP: validación con `@backoffice/shared` (`packages/shared/src/imports/schemas.ts`), lectura binaria del cuerpo y guardas | — |
| `index.ts` | API pública: `createImportsModule({ db, clock, categories, budgets, plan, requireReauth })` → `{ imports, router }`, y `createImportsMaintenance({ db, clock })` → `{ expireStalePreviews }` (lo usa el trabajo `caducidad-de-importaciones` de `jobs/`) | — |

Los catálogos (unidades, naturalezas, estados, tipos de registro…) y `includedInBase` (§9.1) están en `packages/shared/src/plan/catalogs.ts`: los usará también el cálculo del plan.

## Endpoints (`/api/v1`)

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| POST | `/imports/plan-excel?month=YYYY-MM&fileName=` | **S+** (reautenticación reciente) | 201 `{ id, status, issues, summary }`; **200** con el lote existente si ese contenido ya es la foto vigente del mes (no se crea nada) |
| GET | `/imports?month=` | S | 200 `{ items }` (hasta 50, más recientes primero, sin las entradas) |
| GET | `/imports/:id` | S | 200 vista previa completa (`extracted` es `null` si ya no hay entradas) |
| PATCH | `/imports/:id/decisions` | S | `{ categoryMappings: [{ categoryKey, categoryId \| null }] }` → 200 con la vista previa (`ImportDetailResponse`, ya con las decisiones aplicadas) |
| POST | `/imports/:id/confirm` | S | 201 `{ snapshotId, budgets: { created, omitted } }`; **200** `{ snapshotId, budgets: null }` si ya estaba confirmada (o si el contenido ya es la foto vigente) |
| DELETE | `/imports/:id` | S | 204; idempotente |

El cuerpo es **el archivo en binario** (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel.sheet.macroenabled.12` u `application/octet-stream`), nunca multipart ni JSON. `fileName` solo sirve para comprobar la extensión y mostrar el nombre (se sanea: sin ruta ni caracteres de control, ≤ 255).

Códigos de error:

| Código | Cuándo |
|---|---|
| 400 | Mes o nombre de archivo no válidos, identificador mal formado |
| 403 | `REAUTH_REQUIRED`: la subida exige reautenticación en los últimos 10 min (se comprueba **antes** de leer el cuerpo) |
| 404 | El lote no existe |
| 409 | Lo impide el estado del lote o del libro; la razón va en `errors[].path` (ver abajo). Descartar un lote ya confirmado |
| 413 | `FILE_TOO_LARGE` (> 5 MB). **No crea lote** |
| 415 | `FILE_NOT_OOXML` (no es un ZIP de Excel, o la extensión no es `.xlsx`/`.xlsm`), o el cuerpo no es binario (sin cuerpo, `text/plain`, JSON). **No crea lote** |
| 422 | `FILE_ZIP_LIMITS`, `FILE_HAS_MACROS` o `FILE_EXTERNAL_LINKS`. **No crea lote**. En `PATCH decisions`: una decisión incoherente (ver abajo) |

En el nivel 1, `errors[].path` lleva el código del catálogo de problemas. Un libro con la estructura inválida (nivel 2: hoja que falta, cabecera distinta, plantilla v1) **sí crea un lote** `failed` con sus problemas (201); uno con errores de celda o de semántica (niveles 3 y 4), un lote `preview` con `summary.canConfirm = false`.

### Decisiones y confirmación (PR 2)

Razones de los 409 (`errors[].path`): `IMPORT_NOT_PREVIEW` (confirmado, descartado o fallido), `IMPORT_EXPIRED`, `IMPORT_HAS_ERRORS` (errores sin resolver; detalla hasta 20), `CONTENT_ALREADY_IMPORTED` (ese contenido ya fue una foto del mes y se sustituyó), `BUDGET_MANUAL_EXISTS` (una por categoría que ya tiene un presupuesto creado a mano ese mes) y, sin código propio, una categoría archivada. 422 en `PATCH decisions`: la clave no está en el lote o se repite, o la categoría no existe, es de ingreso o está archivada. Orden: 400 → 404 → 409 → 422.

```
POST /imports/plan-excel ─▶ failed
        └─▶ preview ──PATCH decisions──▶ preview ──POST confirm──▶ confirmed
                │                                                   (foto active; la anterior → superseded)
                ├─▶ discarded    (DELETE)
                └─▶ expired      (24 h; lo marca el trabajo caducidad-de-importaciones)
```

## Tablas

`import_batches` (migración `0009_import_batches`; diseño en `docs/plan.md` §2.5; la `0010` añade `CHECK` de que un lote confirmado no conserva `extracted`). Las tablas del plan (`plan_snapshots`, `plan_items`, `plan_budget_lines`, `plan_events`, `plan_goals`, `plan_scenarios`, `plan_scenario_items`, `plan_category_mappings`) son de `finance` (`finance/plan/`, migración `0010_plan_import`). Restricciones en la base de datos: una vista previa lleva entradas y hash de contenido; `confirmed_at` existe si y solo si el lote está confirmado; el mes es el primer día; el SHA-256 y el hash miden 32 bytes; no se confirma dos veces el mismo contenido en el mismo mes. Los `jsonb` se insertan como texto JSON (con `pg`, un array se convertiría en un array de PostgreSQL).

## Decisiones

- **Lector propio, sin dependencias** (`docs/dependencias.md`): el límite de descompresión tiene que ser sobre lo que realmente se descomprime, y el XML no puede tener DTD.
- **Rutas fijas de `sharedStrings` y `styles`**: el lector abre `xl/sharedStrings.xml` y `xl/styles.xml` por su ruta, sin seguir las relaciones del libro (como sí hace Excel, y por eso LibreOffice no mostraba los textos de una fixture sin esas relaciones). Solo las hojas se localizan por relación. Es aceptable porque Excel escribe siempre estas partes en esas rutas, así que no se pierde ningún archivo válido; el motivo de fondo es de seguridad: leer solo nombres que fija el código evita que un `Target` del archivo (rutas con `..`, absolutas o a otra entrada del ZIP) decida qué parte se abre. El coste es que un libro con esas partes en otra ruta se leería sin textos ni formatos de fecha; no hay ningún productor conocido que lo haga. Por eso `fixture.test.ts` comprueba aparte, sin usar este lector, que el paquete es válido: tipos de contenido y partes alcanzables por relaciones.
- **Fórmulas**: se leen como texto; solo se reconocen las formas cerradas de §5. El valor en caché de una celda calculada no se usa para nada (la 3b.2 lo comparará con el recálculo: `CACHED_VALUE_DIFF`). Las fórmulas compartidas de Excel se expanden en cada celda desplazando las referencias relativas del texto de la maestra.
- **Se recogen todos los problemas** antes de responder; nunca se importa parcialmente. Los problemas llevan hoja y celda en A1 y mensaje en español.
- **Categorías**: primero la correspondencia guardada (`plan_category_mappings`) si su categoría sigue siendo de gasto y activa y, si no, el nombre normalizado de la categoría de Presupuesto contra las categorías de gasto **activas**; sin correspondencia es `CATEGORY_UNMAPPED` (bloquea la confirmación). Nombres ambiguos no se resuelven.
- **Decisiones**: `PATCH decisions` es un parche (`null` retira una decisión). No reescribe `extracted` ni `issues`: se guardan en `decisions` y se aplican al leer, así que retirarlas devuelve el lote a como se subió. Al confirmar se guardan en `plan_category_mappings` para los meses siguientes.
- **Una vista previa caduca a las 24 h**: ya cuenta como caducada al leerla (no enseña las entradas, ni se puede confirmar o decidir sobre ella); el trabajo periódico la marca `expired` y vacía las entradas.
- **Idempotencia**: el `content_hash` (sin metadatos, sin valores en caché, sin la elección de categorías) se compara con la foto del mes. Mismo contenido que la vigente: subida y confirmación devuelven 200 y no crean nada. Confirmar dos veces el mismo lote da 200 con el mismo `snapshotId` (`docs/plan.md` §3.6). Un contenido que ya fue una foto sustituida no se reactiva (409).
- **Una sola transacción** (ASVS 2.3.3): bloqueo del mes (`pg_advisory_xact_lock`) → bloqueo de la fila del lote (`FOR UPDATE`) → foto nueva (la anterior pasa a `superseded`) y filas → `category_budgets` → correspondencias → lote `confirmed`. Si falla un paso no queda nada.
- **Presupuesto por categoría** (`docs/plan.md` §3.10): suma, en céntimos enteros, de las líneas cuyo estado cuenta en el plan base; una categoría que suma 0 no crea presupuesto (`budgets.omitted`; pregunta 40, resuelta). Al confirmar un mes que ya tiene foto, los presupuestos que creó la importación anterior **se sustituyen** (se actualizan, se borran los de categorías que ya no están o suman 0 y se crean los nuevos) y los creados a mano **no se tocan**: si chocan, 409 `BUDGET_MANUAL_EXISTS` y no se escribe nada (pregunta 39, resuelta). Un presupuesto importado y editado a mano con `PATCH /budgets/:id` pasa a manual, así que reimportar ese mes da 409 hasta resolverlo. La respuesta lleva `budgets: { created, updated, deleted, omitted }`.
- **Límites** (`docs/seguridad/limites.md`): 5 MB; 50 MB descomprimidos y 200 entradas; 100.000 celdas por hoja; 5.000 filas por tabla; 2.000 problemas por archivo. Los tres últimos son propios y se notifican como `FILE_ZIP_LIMITS`.
- Lo que el contrato no fija (código de la extensión incorrecta, severidad de la unidad en Metas, los tres avisos de eventos) está en `docs/plan.md` §3.9 y en `docs/plantilla-excel.md` §11.

## Tests (`apps/api/test/imports/`)

| Archivo | Cubre |
|---|---|
| `issue-catalog.test.ts` | **Un caso por cada código** del catálogo (§11), salvo `CACHED_VALUE_DIFF`; falla si aparece un código sin caso |
| `parse-plan.test.ts` | La fixture válida (lo extraído y los avisos esperados), fin de tabla, normalización, tipos, fórmulas, seguridad del archivo, hash de contenido |
| `zip.test.ts`, `xml.test.ts`, `formula.test.ts`, `workbook.test.ts` | Las piezas por separado, con archivos sintéticos hostiles (zip bomb, XXE, «billion laughs»…) |
| `api-imports.test.ts`, `imports-schema.test.ts` | La API y la base de datos reales |
| `api-confirm.test.ts` | Confirmar y `PATCH decisions` de punta a punta: filas del plan y presupuestos, importes exactos, rollback con un fallo forzado en PostgreSQL, doble confirmación secuencial y concurrente, sustitución de la foto, idempotencia, caducidad y los 400/404/409/422 |
| `expiry.test.ts` | La caducidad a las 24 h con un reloj controlado: el límite exacto (1 ms antes vigente, a las 24 h `expired`), el trabajo `caducidad-de-importaciones` registrado en `createJobs` y que no toca lotes descartados ni fallidos |
| `plan-schema.test.ts` | Las restricciones `CHECK`, `UNIQUE` y las claves ajenas de la migración `0010`, directamente en la base de datos |
| `decisions.test.ts` | `budgetsByCategory` (agrupar, estados fuera del plan base, total 0, precisión) y las decisiones aplicadas al leer |
| `fixture.test.ts` | `plan-ficticio-v2.xlsx` coincide con lo que genera `test/fixtures/plan-workbook.ts` y es un paquete OOXML válido (tipos de contenido y partes alcanzables por relaciones), sin depender de nuestro lector |

Fixtures: `apps/api/test/fixtures/` (todo FICTICIO; nunca se parte de un archivo real). `pnpm --filter @backoffice/api fixtures:build` regenera el `.xlsx`. Resultados esperados: `plan-ficticio-v2.expected.md`.
