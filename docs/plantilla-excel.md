# Especificación de la plantilla Excel del plan financiero

> Documento de referencia para implementar el importador (fase 3 de `docs/plan.md`).
> Describe **solo la estructura**. Los datos reales nunca se suben al repositorio.
> Revisión 3 (2026-11-02): no quedan puntos por confirmar. Incorpora las etiquetas de los resúmenes, la ausencia de notas en Eventos y las validaciones de datos existentes (§2.1, §6.1, §13 y §14).

## 0. Cómo leer este documento

- **Confirmado**: comprobado por el propietario contra la plantilla real. Todo lo que en revisiones anteriores estaba [A CONFIRMAR] ya está resuelto (§13).
- **[DECISIÓN]**: regla de negocio fijada por el propietario.
- Los códigos internos (`income`, `eur_per_month`…) son los identificadores del código; las etiquetas en español son las del Excel.
- Versiones de la plantilla:
  - **v1**: la plantilla actual. **No se admite** (`TEMPLATE_VERSION_UNSUPPORTED`).
  - **v2**: la que admite el importador. Los cambios para pasar de v1 a v2 están en §14.

---

## 1. Principios del importador

1. **Solo se importan entradas.** Se ignora todo lo que la plantilla calcula: totales, proyección, estado y pendiente de las metas, escenarios, checks y dashboard. La app lo recalcula. Opcionalmente, compara su recálculo con los valores que Excel guarda en caché e informa de las diferencias (`CACHED_VALUE_DIFF`), pero nunca los guarda.
2. **Las filas de distintas hojas se relacionan por la referencia de la fórmula**, nunca por el texto del concepto.
3. **Nunca se evalúan fórmulas.** Solo se reconocen tres **formas cerradas** (§5): la referencia directa a `Datos!C{n}` o `Datos!F{n}`, `SUM` sobre un rango contiguo de `Datos!C` y el producto de dos referencias directas. El importador traduce cada forma a una relación con filas de Datos y es la app la que calcula. Cualquier otra fórmula en una columna de entrada es un error.
4. **Se valida todo antes de escribir.** Se recogen todos los problemas con su hoja y celda; el proceso no se detiene en el primero.
5. **Nada se guarda sin confirmar.** Subir el archivo genera una vista previa. Solo al confirmarla se guarda la foto, en una transacción.
6. **Una sola regla para cada concepto de negocio.** Qué estados cuentan en el plan base lo decide una única función (§9.1). Esa misma regla se usa para comprobar cada aviso, para que los avisos no se contradigan con los cálculos.

---

## 2. Formato del archivo

| Propiedad | Regla | Severidad |
|---|---|---|
| Extensión | `.xlsx`, la recomendada [DECISIÓN: se guarda como `.xlsx`]. También se acepta `.xlsm` mientras dure la transición | error si es otra |
| Tamaño | ≤ 5 MB. Valor inicial; se ajusta midiendo la plantilla real | error |
| Contenedor | ZIP válido: empieza por `PK\x03\x04` y contiene `[Content_Types].xml` y `xl/workbook.xml`. Se ignora el tipo MIME que declara el navegador | error |
| Límites del ZIP (protección contra *zip bombs*) | Descomprimido ≤ 50 MB y ≤ 200 entradas | error |
| Macros (`xl/vbaProject.bin`) | Se rechaza. Confirmado: el archivo real no las tiene | error |
| Vínculos externos (`xl/externalLinks/`) | Se rechaza. Confirmado: el archivo real no los tiene | error |
| Comentarios de celda (`xl/comments*.xml`, *threaded comments*) | Se ignoran | — |
| Metadatos (`docProps/`) | No se leen. El archivo real no los tiene; los que guarde Excel en la fixture se revisan antes de hacer commit (§12) | — |
| Sistema de fechas | Se respeta `date1904` | — |
| Hojas | Las 8 de §6 con su nombre exacto (normalizado, §3) | falta una: error · sobra una: aviso |
| Cabecera | **Fila 5, empezando en la columna A, en todas las hojas** (confirmado) | error si no coincide |
| Datos | **Desde la fila 6** (confirmado) | — |

### 2.1 Fin de la tabla de datos (por hoja)

El fin de la tabla **no se detecta solo por la primera fila vacía**. Así:
- En Metas no salta `ROW_AFTER_GAP` en cada importación, aunque haya dos filas vacías antes del resumen.
- Una línea nueva de Presupuesto escrita en la fila 20 no se une al resumen.

| Hoja | Disposición actual | Regla de fin de tabla | Después del fin |
|---|---|---|---|
| Datos y supuestos | Datos desde la 6 (validación de Estado hasta F43) | Primera fila con todas las columnas de entrada vacías | Cualquier contenido posterior → aviso `ROW_AFTER_GAP` (no se importa y se enumera) |
| Presupuesto | Datos 6–19 · 20 vacía · resumen 21–26 (etiqueta en A, valores en E y F) · nota A28:H30 | La tabla termina en la fila **anterior a la etiqueta de inicio del resumen** (lista fija `PRESUPUESTO_SUMMARY_START`, columna A). Las filas vacías al final de la tabla se permiten | El resumen y la nota se ignoran. Si no se encuentra la etiqueta → error `SUMMARY_NOT_FOUND` |
| Eventos y compromisos | Datos desde la 6, sin resumen **ni notas al pie** (confirmado): los datos acaban en la última fila con contenido | Igual que Datos | Igual que Datos |
| Metas | Datos 6–8 · 9–10 vacías · resumen 11–14 · nota A17 | Igual que Presupuesto, con la lista fija `METAS_SUMMARY_START` | El resumen y la nota se ignoran. Si no se encuentra la etiqueta → `SUMMARY_NOT_FOUND` |
| Escenarios | Datos 6–12 · nota A15 | Primera fila con todas las columnas de entrada (A, C y D) vacías | Si una fila posterior **solo** tiene contenido en la columna A, es una nota y se ignora. Si tiene contenido en C o D → aviso `ROW_AFTER_GAP` |

- Dentro de la zona de datos de Presupuesto y Metas, **una fila vacía seguida de otra con datos** genera el aviso `ROW_AFTER_GAP`: esa fila no se importa y se enumera. Nunca se pierden datos sin que se note.
- Las listas de etiquetas de inicio de resumen están en el código, en un único módulo de configuración por hoja. Por ser listas, admiten variantes si en el futuro se renombra una etiqueta. Valores confirmados con la plantilla real (se comparan tras la normalización de §3):

| Hoja | Etiquetas del resumen (columna A, en orden) | Etiqueta que marca el fin de la tabla |
|---|---|---|
| Presupuesto (filas 21–26) | «Total gastos recurrentes conocidos» · «Ingresos netos mensuales» · «Margen aparente después de gastos conocidos» · «Tasa de ahorro aparente» · «Gastos esenciales conocidos» · «Integridad de categorías de gasto» | `PRESUPUESTO_SUMMARY_START = ["Total gastos recurrentes conocidos"]` |
| Metas (filas 11–14) | «Aportación mensual propuesta» · «Margen mensual conocido» · «Margen no asignado» · «Prueba de capacidad» | `METAS_SUMMARY_START = ["Aportación mensual propuesta"]` |

- Solo la **primera** etiqueta decide el fin de la tabla. Las demás se usan como comprobación: si la primera aparece pero el bloque no contiene las siguientes en orden → aviso `SUMMARY_UNEXPECTED`. Ese aviso indica que la estructura del resumen ha cambiado, aunque el fin de la tabla se detecte bien.
- Las etiquetas y valores del resumen **no se importan**: la app recalcula sus equivalentes (§9.2 y §9.4).

---

## 3. Normalización de textos

| Uso | Normalización |
|---|---|
| Nombres de hoja, cabeceras y etiquetas de resumen | Quitar los espacios de los extremos, reducir a uno los espacios repetidos, Unicode NFC, minúsculas y sin diacríticos. Si solo coinciden tras quitar los acentos → información |
| Listas cerradas | La misma. Se acepta `Si` como `Sí` |
| Textos libres (concepto, nota, naturaleza de Eventos) | Quitar los espacios de los extremos y NFC. Se guardan tal cual |
| Categoría de Presupuesto | La normalización completa, para buscar la correspondencia guardada (§8) |

---

## 4. Tipos de celda

| Tipo | Regla |
|---|---|
| **Importe en euros** | Celda numérica. `céntimos = round(x × 100)`. Si `\|x × 100 − céntimos\| > 1e-6` → `AMOUNT_PRECISION`. Un texto como «12,50» → `CELL_TYPE`. **Todos los importes son positivos** (confirmado): un negativo → `AMOUNT_NEGATIVE` |
| **Meses** | Celda numérica ≥ 0 con 2 decimales como máximo. Se guarda en centésimas enteras (`quantity_hundredths`) para calcular con aritmética entera |
| **Fecha** | Número de serie con formato de fecha → fecha sin hora. Un texto con forma de fecha → `CELL_TYPE` |
| **Texto que puede llegar como fecha** (Datos · Fuente/fecha) | Si la celda es una fecha → se convierte a texto ISO `YYYY-MM-DD`. Si no → texto |
| **Sí/No** | `Sí`, `No` → booleano |
| **Lista cerrada** | Un valor fuera del catálogo → `VALUE_NOT_IN_LIST` |
| **Texto** | Cualquier valor; los números se convierten a texto |
| **Vacía** | Sin valor, o una cadena vacía tras quitar espacios |

---

## 5. Fórmulas admitidas (formas cerradas)

El importador lee el **texto de la fórmula**. El `=` inicial y los `$` son opcionales. El nombre de la hoja de Datos se escribe `'Datos y supuestos'`. En el archivo, las funciones se guardan en inglés (`SUM`), aunque Excel las muestre en español (`SUMA`).

| Forma | Gramática (orientativa) | Traducción | Dónde se admite |
|---|---|---|---|
| **REF**: referencia directa | `'Datos y supuestos'!$C$8` | Una fila de Datos | Las columnas marcadas como «REF» en §6 |
| **SUMRANGE**: suma de un rango contiguo | `SUM('Datos y supuestos'!C20:C23)`, un solo rango de la columna C | Una lista de filas (20, 21, 22 y 23). Las filas vacías del rango se omiten con el aviso `REF_TARGET_EMPTY` | Escenarios C y D |
| **PRODUCT2**: producto de dos referencias | `'Datos y supuestos'!C10*'Datos y supuestos'!C11` | Una pareja (importe en €/mes, multiplicador en meses), en cualquier orden. Ningún otro operando | Eventos C |
| **ZERO** | `=0` | Lista vacía (0 €) | Escenarios C y D |

Reglas comunes:
- Se rechaza (`REF_UNSUPPORTED`): cualquier otra función u operación, rangos de varias columnas o no contiguos, otras hojas, otros libros (`[1]…`), nombres definidos e `INDIRECT`.
- La fila destino tiene que estar en la zona de datos de «Datos y supuestos» y no estar vacía (`REF_TARGET_EMPTY`).
- La columna destino: `C` para importes y meses, `F` para estados (`REF_TARGET_COLUMN`).
- **Fórmulas compartidas**: si la columna se rellenó arrastrando, la librería tiene que expandir la fórmula en cada celda. Es un punto que verifica el *spike* de la fase 3.
- Las columnas **calculadas** pueden contener cualquier fórmula, porque se ignoran. Excepción: si contienen un **literal distinto de 0** → aviso `VALUE_IN_CALCULATED_COLUMN` (§6.2).

---

## 6. Hojas (v2)

Todas empiezan en la columna A, con la cabecera en la fila 5 y los datos desde la 6.

### 6.1 «Datos y supuestos» — entrada principal

| Col | Cabecera | Campo | Tipo | Obligatorio | Fórmula | Notas |
|---|---|---|---|---|---|---|
| A | Grupo | `groupLabel` | texto | sí | no | Agrupación visual; no clasifica |
| B | Concepto | `concept` | texto | sí | no | |
| C | Valor | `amountCents` o `quantityHundredths` | importe o meses, según la Unidad | sí | **no** (confirmado: todos son literales) | Fuente de verdad |
| D | Unidad | `unit` | lista | sí | no | **En la v1 es texto libre** (sin validación de datos, confirmado); la v2 añade una lista (§14). El importador valida contra el catálogo en cualquier caso |
| E | Naturaleza | `nature` | lista | sí | no | **En la v1 es texto libre** (confirmado); la v2 añade una lista (§14). El importador valida contra el catálogo en cualquier caso |
| F | Estado | `status` | lista | sí | no | En la v1, la validación solo cubre `F6:F43`; la v2 la extiende (§14) |
| G | Fuente/fecha | `sourceNote` | texto (una fecha se convierte a ISO) | no | no | No se interpreta |
| H | Nota | `note` | texto | no | no | |
| I | Tipo de registro | `recordType` | lista | sí | no | **Nuevo en la v2** (§7) |

**Unidad**: `€/mes` → `eur_per_month` · `€` → `eur` · `meses` → `months`.

**Naturaleza** (11 valores): Recurrente `recurring` · Variable `variable` · Irregular `irregular` · Saldo `balance` · Supuesto `assumption` · Objetivo `target` · Potencial `potential` · Finalizado `finished` · Acumulado `accumulated` · Pagado `paid` · Puntual `one_off`.

**Estado** (10 valores) y predicado de inclusión `includedInBase` [DECISIÓN, aceptada]:

| Excel | Código | ¿Cuenta en el plan base? |
|---|---|---|
| Confirmado | `confirmed` | sí |
| Pendiente | `pending` | sí |
| Confirmar | `to_confirm` | sí |
| Provisional | `provisional` | sí |
| Estimado | `estimated` | sí |
| Confirmar pagado | `to_confirm_paid` | sí |
| Potencial | `potential` | no |
| No activo | `inactive` | no |
| Pausado | `paused` | no |
| Histórico | `historical` | no |

### 6.2 «Presupuesto»

Datos en las filas 6–19 hoy; termina antes del resumen (§2.1).

| Col | Cabecera | Campo | Tipo | Obligatorio | Fórmula | Notas |
|---|---|---|---|---|---|---|
| A | Categoría | `categoryName` | texto | sí | no | Correspondencia con una categoría de la app (§8) |
| B | Concepto | `concept` | texto | sí | no | Solo para mostrarlo |
| C | Tipo | `costType` | Fijo `fixed` · Variable `variable` · Irregular `irregular` | sí | no | |
| D | Esencial | `essential` | Sí/No | sí | no | |
| E | Mensual | `planItemRef` | **REF** a `Datos!C{n}` con la unidad `€/mes` | sí | REF obligatoria | Un literal → `FORMULA_REQUIRED` [DECISIÓN] |
| F | Anual | — | calculada | — | se ignora | Un literal distinto de 0 → aviso `VALUE_IN_CALCULATED_COLUMN` |
| G | % ingreso | — | calculada | — | se ignora | Igual que F |
| H | Estado del dato | `statusRef` | **REF** a `Datos!F{n}` | sí | REF obligatoria | Tiene que apuntar a la misma fila `n` que Mensual (`REF_ROWS_MISMATCH`) |

- El importe y el estado de la línea se leen de la fila de Datos referenciada; no se copian.
- Dos líneas que apuntan a la misma fila de Datos → aviso `DUPLICATE_REFERENCE` (el gasto contaría dos veces).
- **Caso confirmado: el gasto irregular.** Hoy su Mensual apunta a una fila de Datos en €/mes con valor 0, y su importe anual está escrito a mano en F (Anual). La app solo ve el 0 de Datos, así que ese gasto **no cuenta** en el plan mientras no se corrija. Lo señalan dos avisos: `VALUE_IN_CALCULATED_COLUMN` en F y el resumen de la vista previa. La corrección está en §14.

### 6.3 «Eventos y compromisos»

| Col | Cabecera | Campo | Tipo | Obligatorio | Fórmula | Notas |
|---|---|---|---|---|---|---|
| A | Concepto | `concept` | texto | sí | no | |
| B | Naturaleza | `natureLabel` | **texto libre** (confirmado: sin validación de datos) | no | no | Se guarda como etiqueta y no se usa en los cálculos |
| C | Importe | ver la tabla siguiente | literal, REF o PRODUCT2 | sí | sí | |
| D | Estado | `status` | Estimado `estimated` · Pagado `paid` · Finalizado `finished` · Activo `active` · No activo `inactive` · No comprometido `not_committed` | sí | no | |
| E | Fecha prevista | `expectedDate` | fecha | condicionada | no | Obligatoria si F = Sí |
| F | Incluir 12M | `includeInProjection` | Sí/No | sí | no | Con la fecha, es **lo único** que usa la proyección |
| G | Nota | `note` | texto | no | no | En la v1 era la columna H. **«Impacto base» se elimina en la v2** [DECISIÓN]: ninguna fórmula lo leía |

**Formas admitidas en Importe (C)** (confirmado: hoy hay 3 referencias a filas en €/mes, un producto y un literal):

| Contenido | Tratamiento | Importe del evento |
|---|---|---|
| Literal | Se guarda `amountCents` | El literal |
| REF a una fila con la unidad `€` | Se guarda `amountItemId` | El valor de la fila |
| REF a una fila con la unidad `€/mes` | Se guarda `amountItemId` + información `EVENT_REF_MONTHLY`: «se proyecta **un único pago** igual a la cuota mensual en la fecha prevista» | El valor mensual de la fila (una vez) |
| PRODUCT2 (una fila `€/mes` × una fila `meses`, p. ej. cuota × plazo) | Se guardan `amountItemId` y `multiplierItemId`. La app calcula el producto, así que **si cambia la cuota o el plazo, el evento se actualiza solo** | `round_half_up(cuota_cents × meses_hundredths / 100)` |
| Cualquier otra fórmula | `REF_UNSUPPORTED` | — |

Reglas:
- `includeInProjection = Sí` y sin fecha → **error** `EVENT_DATE_REQUIRED`.
- `includeInProjection = Sí` y estado `Pagado`, `Finalizado` o `No activo` → aviso.
- Fecha anterior al mes 1, evento incluido y no pagado → aviso «evento vencido». Fecha posterior al mes 12 → información.
- **`DUPLICATE_REFERENCE` no se aplica a Eventos**: dos eventos pueden apuntar a la misma fila (pagos iguales en fechas distintas).
- Si el evento está incluido en la proyección y la fila referenciada también entra en el gasto base (la referencia una línea de Presupuesto y está en `includedInBase`) → aviso `EVENT_ITEM_ALREADY_IN_BASE`. La proyección restaría dos veces el mismo dinero ese mes.

### 6.4 «Metas»

Datos en las filas 6–8 hoy; termina antes del resumen (§2.1).

| Col | Cabecera | Campo | Tipo | Obligatorio | Fórmula | Notas |
|---|---|---|---|---|---|---|
| A | Meta | `name` | texto | sí | no | |
| B | Objetivo | `targetItemId` o `targetCents` | REF a `Datos!C` (unidad `€`) o literal | sí, salvo si el tipo es fondo de emergencia | REF | **Fondo de emergencia**: B se trata como calculada (§9.4) |
| C | Actual | `currentItemId` o `currentCents` | REF o literal (confirmado: una REF al saldo de ahorro y dos literales) | sí | REF | |
| D | Pendiente | — | calculada | — | se ignora | |
| E | Aportación/mes | `contributionItemId` o `contributionCents` | REF (unidad `€/mes`) o literal | sí (puede ser 0) | REF | |
| F | Meses | — | calculada | — | se ignora | |
| G | Estado | — | **calculada** (confirmado) | — | se ignora | La app la calcula (§9.4) |
| H | Criterio | `criterion` | texto | no | no | |
| I | Tipo de meta | `goalKind` | Importe fijo `fixed_amount` · Fondo de emergencia `emergency_fund` | sí | no | **Nuevo en la v2** (§14) |

- Como mucho una meta `emergency_fund`. Si existe, tiene que haber **exactamente una** fila de Datos de tipo «Meses de fondo de emergencia» (`EMERGENCY_FUND_MONTHS_MISSING` / `…_DUPLICATED`).
- Coherencia: si la fórmula de B de la meta de fondo de emergencia menciona una fila de Datos distinta de la marcada como «Meses de fondo de emergencia» → aviso `TYPE_SIGNAL_MISMATCH`. Solo se **extraen las referencias** del texto de la fórmula; no se evalúa nada.

### 6.5 «Escenarios»

Datos en las filas 6–12 hoy y una nota en A15 (§2.1). Columnas confirmadas:

| Col | Cabecera | Campo | Tipo | Fórmula | Notas |
|---|---|---|---|---|---|
| A | Escenario | `name` | texto, obligatorio | no | |
| B | Gasto base | — | calculada | se ignora | La app usa G (§9.2) |
| C | Extra mensual | lista de filas (`role = extra_monthly`) | ZERO · REF · SUMRANGE sobre `Datos!C` | sí | Se espera la unidad `€/mes`; si es otra → aviso `REF_UNIT_MISMATCH` |
| D | Pago puntual | lista de filas (`role = one_off`) | ZERO · REF · SUMRANGE sobre `Datos!C` | sí | Se espera la unidad `€`; si es otra → aviso |
| E | Salida total | — | calculada | se ignora | |
| F | Caja libre | — | calculada | se ignora | |
| G | Tasa libre | — | calculada | se ignora | |
| H | Lectura | — | calculada | se ignora | |

- **Modelo**: un escenario es una **lista de filas de Datos** (relación muchos a muchos con un rol). No guarda importes propios.
- Un literal 0 se acepta como ZERO. Un literal distinto de 0 → `FORMULA_REQUIRED`.
- **Los escenarios no se filtran con `includedInBase`**: incluyen a propósito filas Potencial y No activo, porque precisamente simulan lo que hoy no está en la base.
- **Aviso nuevo `SCENARIO_ITEM_ALREADY_IN_BASE`**: una fila de la lista «extra» también entra en el gasto base, porque la referencia una línea de Presupuesto y su estado está en `includedInBase`. Ese «extra» se sumaría dos veces. Confirmado: hoy ocurre.

### 6.6 Hojas solo calculadas: «Proyección 12M», «Checks» y «Dashboard»

- No se leen; solo se comprueba que existen.
- Confirmado: **no hay ninguna celda con el mes del plan**. «Proyección 12M»!A6 es una fecha literal anterior al mes del archivo, y los dos primeros meses tienen el gasto recurrente escrito a mano. Nada de eso se usa: **el mes 1 es el que se elige al subir el archivo** (§9.3). Se elimina `MONTH_MISMATCH`.

---

## 7. Clasificación de las filas de Datos: columna I «Tipo de registro» [DECISIÓN, aceptada]

Lista cerrada (validación de datos en Excel):

| Excel | Código | Unidad esperada | Uso |
|---|---|---|---|
| Ingreso | `income` | €/mes | Ingresos mensuales `I` |
| Gasto | `expense` | €/mes | Lo referencian las líneas de Presupuesto |
| Saldo de ahorro | `savings_balance` | € | Saldo inicial de la proyección (**se admiten varias filas y se suman**) |
| Supuesto | `assumption` | cualquiera | Parámetros sin un uso fijo en los cálculos |
| Meses de fondo de emergencia | `emergency_fund_months` | meses | Multiplicador del objetivo del fondo de emergencia (como mucho una fila) |
| Meta | `goal` | € o €/mes | Lo referencia «Metas» |
| Escenario | `scenario` | €/mes o € | Lo referencia «Escenarios» |
| Histórico | `historical` | cualquiera | No interviene en los cálculos |
| Pago puntual | `one_off_payment` | € | Lo referencia «Eventos» |

**Detección de la versión**: es v2 si `Datos!I5 = «Tipo de registro»`, `Eventos!G5 = «Nota»` y `Metas!I5 = «Tipo de meta»`. Si falta alguna de las tres → `TEMPLATE_VERSION_UNSUPPORTED`, con un mensaje que indica qué cambio de §14 falta.

**Comprobaciones cruzadas** (son avisos; no reclasifican la fila):

| Señal | Tipo esperado |
|---|---|
| La referencia Presupuesto · Mensual | `expense` |
| La referencia Eventos · Importe | `one_off_payment`, `expense` o `scenario` |
| La referencia Metas | `goal`, `savings_balance` o `assumption` |
| La referencia Escenarios | `scenario`, `expense` o `income` |
| La unidad no coincide con la esperada para su tipo | — |
| Fila `expense` incluida que ninguna línea de Presupuesto referencia | aviso `EXPENSE_NOT_BUDGETED` |

---

## 8. Correspondencia de categorías

- La «Categoría» de Presupuesto se relaciona con una categoría de gasto de la app mediante una tabla persistente (`nombre normalizado → category_id`), que se reutiliza de un mes a otro.
- Si una categoría no tiene correspondencia → `CATEGORY_UNMAPPED`, que **bloquea la confirmación** hasta resolverla en la vista previa.

---

## 9. Cálculos que hace la aplicación

Son funciones puras con importes en **céntimos enteros** y meses en **centésimas enteras**. Los porcentajes se comparan con aritmética entera y solo se redondean al mostrarlos. El redondeo es *half-up* al céntimo y solo se aplica en los productos con meses.

### 9.1 Predicado de inclusión (único)

`includedInBase(status)` según la tabla de §6.1. Lo usan todos los cálculos del plan base y todas las comprobaciones. **Excepción documentada:** los escenarios (§9.5).

### 9.2 Presupuesto (resumen)

| Indicador | Definición |
|---|---|
| Ingresos mensuales `I` | Σ filas `income` con la unidad `€/mes` e incluidas |
| Gasto mensual `G` | Σ filas referenciadas por las líneas de Presupuesto, si están incluidas |
| Margen `M` | `I − G` |
| Tasa de ahorro | `M / I`; si `I = 0` → «sin ingresos» |
| Gastos esenciales `E` | Σ líneas con Esencial = Sí e incluidas. **Incluye todas las líneas esenciales.** La plantilla excluye la última por un error de rango, así que la diferencia `CACHED_VALUE_DIFF` en este indicador y en el objetivo del fondo de emergencia **es esperada** y la vista previa lo indica |
| % confirmadas | Líneas con estado `confirmed` / líneas incluidas, por número de líneas |
| Anual y % ingreso por línea | `12 × mensual` y `mensual / I`; solo para mostrarlos |

### 9.3 Proyección a 12 meses

- **Mes 1 = el mes elegido al subir el archivo.**
- `S0` = Σ filas `savings_balance` incluidas. Hoy es una sola fila; se admiten varias. Pregunta abierta: cuando haya cuentas reales, ¿debería `S0` salir de sus saldos? (`plan.md` §9).
- Para cada mes `k = 1..12`:
  - `P_k` = Σ importes de los eventos con `includeInProjection` cuya `expectedDate` cae en el mes `k`.
  - `flujo_k = I − G − P_k`; `inicial_1 = S0`; `final_k = inicial_k + flujo_k`; `inicial_{k+1} = final_k`; `tasa_k = flujo_k / I`.
- **Meses pasados**: si el mes `k` es anterior al mes natural en curso, la fila se muestra con el **flujo real** del libro (ingresos − gastos confirmados de ese mes) y se marca como `source = real`. Si ese mes no tiene movimientos confirmados, se usa el plan con el aviso «sin datos reales». El roll-forward continúa con el valor que se muestra.
- Una sola función recorre todos los eventos, así que no hay rangos por mes.
- Las aportaciones a metas no restan caja, igual que en la plantilla.

### 9.4 Metas

- **Objetivo**:
  - `fixed_amount`: el de la columna B (REF o literal).
  - `emergency_fund`: `round_half_up(E × meses_hundredths / 100)`, donde `meses` es la fila `emergency_fund_months` y `E` el indicador de §9.2.
- `pendiente = max(objetivo − actual, 0)`.
- `meses = 0` si `pendiente = 0`; si `aportación > 0`, `ceil(pendiente / aportación)` con división entera; `null` («sin aportación») si `aportación ≤ 0`.
- **Estado (calculado; misma regla que la plantilla):** `completed` si `pendiente = 0`; si no, `paused` si `aportación ≤ 0`; si no, `in_progress`.
- **Prueba de capacidad**: Σ aportaciones de las metas `in_progress` ≤ `M`.

### 9.5 Escenarios

- `extra_e` = Σ importes de las filas con `role = extra_monthly`; `puntual_e` = Σ importes de las filas con `role = one_off`. **No se filtra por estado.**
- `salidaTotal_e = G + extra_e + puntual_e`.
- `cajaLibre_e = I − salidaTotal_e`. El pago puntual se resta **entero**: el escenario es la foto de un mes y no se prorratea (confirmado).
- `tasaLibre_e = cajaLibre_e / I`.
- Lectura: `< 0` **Déficit** · `< 20 %` **Margen bajo** · `< 40 %` **Margen moderado** · si no, **Margen alto**. Un 20 % exacto es moderado y un 40 % exacto, alto. Si `I = 0` → «Sin ingresos».

### 9.6 Comprobaciones (Checks)

| Comprobación de la plantilla | En la app | Severidad |
|---|---|---|
| Los ingresos cuadran | **Se elimina**: compara la misma suma consigo misma (confirmado: es una tautología) | — |
| Gasto total = suma de líneas | Invariante (test unitario) | — |
| Ingresos = gasto + margen | Invariante (test) | — |
| Aportaciones ≤ margen | En ejecución | **FAIL** |
| Saldo inicial = ahorro | Invariante (test) | — |
| Roll-forward de caja | Invariante (test) | — |
| Eventos incluidos con fecha | Restricción del importador y de la base de datos | no se puede guardar |
| Categorías esenciales pendientes | Línea esencial con estado ≠ `confirmed` | **WARN** |
| *(nuevo)* Margen negativo | `M < 0` | **FAIL** |
| *(nuevo)* Saldo final negativo en algún mes | `final_k < 0` | **WARN** |
| *(nuevo)* Gasto de Datos sin presupuestar | `EXPENSE_NOT_BUDGETED` | **WARN** |
| *(nuevo)* Doble cómputo en un escenario o evento | `SCENARIO_ITEM_ALREADY_IN_BASE` / `EVENT_ITEM_ALREADY_IN_BASE` | **WARN** |

**Estado global**: `FAIL` si hay algún FAIL; si no, `PASS WITH WARNINGS` si hay algún WARN; si no, `PASS`.

### 9.7 Dashboard

- Indicadores de §9.2 y estado global.
- Tres gráficos:
  - Composición del gasto: barras horizontales si hay más de 5–6 categorías, con «Otros».
  - Caja acumulada proyectada (línea; los meses reales se distinguen de los planificados).
  - Caja libre por escenario (barras, con la línea de 0).

---

## 10. Errores de la plantilla y cómo los evita la app

| Error en el Excel (confirmado) | Prevención en la app |
|---|---|
| Rangos de suma distintos según el mes: los eventos nuevos no se proyectan | Una sola función recorre todos los eventos (§9.3) + un test de regresión |
| Un total incluye una línea que su propio check excluye | Predicado único `includedInBase` + un test que compara el total con el check |
| Valores fijos mezclados con fórmulas (el Anual escrito a mano y los dos primeros meses de la proyección tecleados) | REF obligatoria en Mensual y Estado, `VALUE_IN_CALCULATED_COLUMN` y la proyección siempre calculada (o con datos reales) |
| Textos con cifras escritas a mano | Los textos se generan desde los datos |
| *(nuevo)* «Gastos esenciales» deja fuera la última línea por un error de rango | La app suma todas las líneas esenciales; `CACHED_VALUE_DIFF` esperado |
| *(nuevo)* Un escenario suma como extra una fila que ya está en la base | `SCENARIO_ITEM_ALREADY_IN_BASE` |
| *(nuevo)* La validación de Estado solo cubre F6:F43 | La v2 la amplía (§14); el importador valida todas las filas igualmente |
| *(nuevo)* El check «los ingresos cuadran» es una tautología | Se elimina |

---

## 11. Catálogo de problemas del importador

Formato de cada problema: `{ code, severity: "error" | "warning" | "info", sheet, cell, message, expected?, found? }`. La celda va en notación A1 y el mensaje, en español.

| Código | Severidad | Cuándo |
|---|---|---|
| `FILE_TOO_LARGE` | error | El archivo supera el tamaño máximo |
| `FILE_NOT_OOXML` | error | No es un ZIP OOXML válido |
| `FILE_ZIP_LIMITS` | error | Supera los límites de descompresión o de entradas |
| `FILE_HAS_MACROS` | error | Contiene `vbaProject.bin` |
| `FILE_EXTERNAL_LINKS` | error | Tiene vínculos a otros libros |
| `SHEET_MISSING` | error | Falta una hoja |
| `SHEET_UNEXPECTED` | warning | Sobra una hoja |
| `HEADER_MISMATCH` | error | La cabecera de la fila 5 no coincide |
| `TEMPLATE_VERSION_UNSUPPORTED` | error | No es v2; indica qué cambio de §14 falta |
| `SUMMARY_NOT_FOUND` | error | No se encuentra la etiqueta de inicio del resumen (Presupuesto, Metas) |
| `SUMMARY_UNEXPECTED` | warning | El bloque de resumen no contiene las etiquetas esperadas en orden |
| `ROW_AFTER_GAP` | warning | Hay datos tras una fila vacía, o en C o D tras el fin de Escenarios |
| `CELL_REQUIRED` | error | Falta un valor obligatorio |
| `CELL_TYPE` | error | El tipo de la celda no es el esperado |
| `VALUE_NOT_IN_LIST` | error | El valor no está en la lista cerrada |
| `AMOUNT_PRECISION` | error | El importe tiene más de 2 decimales |
| `AMOUNT_NEGATIVE` | error | Hay un importe negativo |
| `FORMULA_NOT_ALLOWED` | error | Hay una fórmula en una columna que exige un literal |
| `FORMULA_REQUIRED` | error | Hay un literal donde se exige una forma de §5 |
| `REF_UNSUPPORTED` | error | La fórmula no es ninguna de las formas cerradas admitidas |
| `REF_TARGET_EMPTY` | error (warning dentro de un SUMRANGE) | La referencia apunta a una fila vacía o fuera de la zona de datos |
| `REF_TARGET_COLUMN` | error | La referencia apunta a una columna incorrecta |
| `REF_ROWS_MISMATCH` | error | Mensual y Estado apuntan a filas distintas |
| `REF_UNIT_MISMATCH` | error en Presupuesto y PRODUCT2 · warning en Escenarios | La unidad de la fila destino no es compatible |
| `DUPLICATE_REFERENCE` | warning | Dos líneas de **Presupuesto** apuntan a la misma fila |
| `VALUE_IN_CALCULATED_COLUMN` | warning | Hay un literal distinto de 0 en una columna calculada |
| `EVENT_DATE_REQUIRED` | error | Hay un evento incluido sin fecha |
| `EVENT_REF_MONTHLY` | info | El importe de un evento apunta a una fila en €/mes |
| `EVENT_ITEM_ALREADY_IN_BASE` | warning | El importe del evento ya está en el gasto base |
| `SCENARIO_ITEM_ALREADY_IN_BASE` | warning | El extra de un escenario ya está en el gasto base |
| `EMERGENCY_FUND_MONTHS_MISSING` | error | Hay una meta de fondo de emergencia sin una fila de meses |
| `EMERGENCY_FUND_MONTHS_DUPLICATED` | error | Hay más de una fila de meses de fondo de emergencia |
| `CATEGORY_UNMAPPED` | error (bloquea la confirmación) | La categoría no tiene correspondencia |
| `TYPE_SIGNAL_MISMATCH` | warning | El tipo de registro no encaja con el uso de la fila |
| `EXPENSE_NOT_BUDGETED` | warning | Hay un gasto de Datos sin línea de Presupuesto |
| `CACHED_VALUE_DIFF` | info | El valor que guarda Excel difiere del recálculo |

Eliminados respecto a la revisión 1: `MONTH_MISMATCH` (no existe esa celda) y `EVENT_CONTRADICTION` (se elimina «Impacto base»).

---

## 12. Archivo de ejemplo con datos ficticios (fixture de los tests)

- `apps/api/test/fixtures/plan-ficticio-v2.xlsx`: **creado a mano en Excel** a partir de una plantilla v2 vacía, con datos inventados (conceptos genéricos e importes redondos). Tiene que guardarlo Excel, para que reproduzca las fórmulas compartidas, los valores en caché y los formatos de fecha.
- **Nunca** se crea «anonimizando» el archivo real.
- Reproduce la **disposición real**: resumen de Presupuesto tras una fila vacía, Metas con dos filas vacías antes del resumen, notas en las posiciones confirmadas y un comentario de celda (que debe ignorarse).
- Cobertura mínima:
  - Una fila de cada tipo de registro y de cada estado.
  - Dos filas de saldo de ahorro.
  - Un gasto irregular con el Anual escrito a mano (provoca `VALUE_IN_CALCULATED_COLUMN`).
  - Eventos con las cuatro formas de importe (literal, REF a €, REF a €/mes, PRODUCT2), dos de ellos apuntando a la misma fila, uno fuera del horizonte y uno en el mes 1.
  - Una meta de fondo de emergencia, otra completada y otra con aportación 0.
  - Escenarios con ZERO, REF y SUMRANGE, que crucen los umbrales del 0 %, el 20 % y el 40 %, y uno que provoque `SCENARIO_ITEM_ALREADY_IN_BASE`.
  - Una línea esencial pendiente y una categoría sin correspondencia.
  - Una validación limitada a un rango corto y una columna de lista sin validación (como Unidad en la v1), con un valor fuera del catálogo después del rango, para comprobar que el importador lo detecta igualmente.
- Los **resultados esperados se calculan a mano** (`plan-ficticio-v2.expected.md`).
- Las validaciones de datos de Excel **no sustituyen** a las del importador: Excel no revisa los valores que ya existían al crear la validación, ni los pegados. Por eso el importador valida siempre todas las filas contra los catálogos.
- Las variantes con errores se generan en los tests a partir de una copia de la fixture válida.
- Antes de hacer commit, se revisan los metadatos que añada Excel (`docProps/core.xml`: autor, empresa) y se vacían.

---

## 13. Puntos pendientes antes de implementar

**Ninguno.** Las 12 dudas de la revisión 1 y los 3 detalles de la revisión 2 están confirmados con la plantilla real:

1. Etiquetas del resumen de Presupuesto y de Metas → §2.1.
2. «Eventos y compromisos» no tiene notas al pie → §2.1.
3. Validaciones de datos existentes en la v1: solo `Datos!F6:F43` (Estado) y `Eventos!F6:F23` (Incluir 12M). Unidad y Naturaleza son texto libre → §6.1 y §14, paso 2.

Si al crear la fixture o al migrar el Excel aparece algo que contradiga este documento, se corrige aquí **antes** de implementar.

---

## 14. Migración de la plantilla v1 a v2

Son cambios que haces **una vez** en tu Excel. Ninguno altera los cálculos que hace hoy el propio Excel, salvo el paso 6, que los **corrige**. Haz una copia del archivo antes de empezar.

**0. Guardar como `.xlsx`.** En «Guardar como», elige «Libro de Excel (.xlsx)». No hay macros, así que no se pierde nada.

**1. «Datos y supuestos»: añadir la columna I «Tipo de registro».**
   1. En `I5` escribe exactamente `Tipo de registro`.
   2. Selecciona `I6:I500` → Datos → Validación de datos → Lista, con los valores: `Ingreso;Gasto;Saldo de ahorro;Supuesto;Meses de fondo de emergencia;Meta;Escenario;Histórico;Pago puntual`. El separador `;` corresponde a Excel en español.
   3. Rellena la columna I en **todas** las filas con datos. Criterio rápido:
      - Lo que referencia Presupuesto · Mensual → Gasto.
      - Ingresos mensuales → Ingreso.
      - El ahorro actual → Saldo de ahorro.
      - La fila «meses objetivo» → Meses de fondo de emergencia.
      - Lo que solo usan los escenarios → Escenario.
      - Lo que referencia Eventos → Pago puntual o Gasto (cuotas).
      - Filas antiguas → Histórico.
      - El resto → Supuesto o Meta.

**2. Validaciones de datos: añadir las que faltan y extenderlas a un rango amplio.** Hoy solo existen dos: `Datos!F6:F43` (Estado) y `Eventos!F6:F23` (Incluir 12M). Unidad y Naturaleza son texto libre. En cada caso: selecciona el rango → Datos → Validación de datos → Permitir: **Lista** → Origen con los valores separados por `;`. Marca «Mostrar mensaje de error» con el estilo **Detener**.

| Hoja | Rango | Lista |
|---|---|---|
| Datos y supuestos | `D6:D500` (Unidad, **nueva**) | `€/mes;€;meses` |
| Datos y supuestos | `E6:E500` (Naturaleza, **nueva**) | `Recurrente;Variable;Irregular;Saldo;Supuesto;Objetivo;Potencial;Finalizado;Acumulado;Pagado;Puntual` |
| Datos y supuestos | `F6:F500` (Estado, **se extiende** desde F43) | `Confirmado;Pendiente;Confirmar;Provisional;Potencial;No activo;Pausado;Histórico;Confirmar pagado;Estimado` |
| Datos y supuestos | `I6:I500` (Tipo de registro, **nueva**; ya hecho en el paso 1) | la del paso 1 |
| Eventos y compromisos | `F6:F500` (Incluir 12M, **se extiende** desde F23) | `Sí;No` |
| Eventos y compromisos | `D6:D500` (Estado, recomendada) | `Estimado;Pagado;Finalizado;Activo;No activo;No comprometido` |
| Presupuesto | `C6:C19` y `D6:D19` (Tipo y Esencial, recomendadas) | `Fijo;Variable;Irregular` · `Sí;No` |

- En Presupuesto (y en Metas, paso 5) la validación cubre solo la zona de datos, porque debajo está el resumen. Si insertas filas **dentro** de esa zona, Excel extiende la validación automáticamente.
- **Revisa los valores que ya existen**: una validación nueva no comprueba lo que ya estaba escrito. Usa Datos → Validación de datos → **Rodear con un círculo datos no válidos**. Corrige cada celda marcada: Unidad y Naturaleza eran texto libre, así que puede haber variantes como `EUR/mes` o `€ al mes`. Las diferencias de mayúsculas, acentos y espacios en los extremos ya las tolera la normalización de §3. El importador también las rechazaría (`VALUE_NOT_IN_LIST`), pero así las ves antes.

**3. «Eventos y compromisos»: eliminar «Impacto base».** Haz clic derecho en la columna **G** → Eliminar. «Nota» pasa a G. Comprueba que `G5` dice `Nota` y que ninguna celda muestra `#¡REF!`: no debería, porque ninguna fórmula la leía.

**4. «Eventos y compromisos»: revisar los importes.**
   - La fila con el producto cuota × plazo tiene que quedar **exactamente** como `='Datos y supuestos'!C{a}*'Datos y supuestos'!C{b}`: una fila en €/mes y otra en meses, sin más operaciones. Si tiene paréntesis, constantes o una tercera celda, simplifícala o pon un literal.
   - Las 3 referencias a filas en €/mes se aceptan como «un pago único igual a la cuota». Si esa cuota también está en el Presupuesto y el evento tiene Incluir 12M = Sí, la importación avisará de un doble cómputo (`EVENT_ITEM_ALREADY_IN_BASE`). Decide si el evento debe estar incluido.

**5. «Metas»: añadir la columna I «Tipo de meta».**
   1. En `I5` escribe exactamente `Tipo de meta`.
   2. Selecciona `I6:I50` y aplica la validación Lista: `Importe fijo;Fondo de emergencia`.
   3. Marca la meta del fondo de emergencia como `Fondo de emergencia` y el resto como `Importe fijo`. La fórmula de su Objetivo (B) se mantiene: Excel sigue calculándola y la app la recalcula.

**6. «Presupuesto»: corregir el gasto irregular** (resuelve `VALUE_IN_CALCULATED_COLUMN`).
   1. En la fila de Datos a la que apunta su Mensual (unidad €/mes, hoy con valor 0), escribe el **equivalente mensual**: el importe anual / 12, redondeado al céntimo.
   2. En Presupuesto, sustituye el número escrito a mano en Anual (F) por la fórmula de las demás líneas (`=E{fila}*12`).
   3. Si prefieres que la proyección refleje el pago en el mes real, quítalo del Presupuesto y añádelo como evento con fecha e Incluir 12M = Sí, sin dejar las dos cosas a la vez.

**7. «Presupuesto»: corregir el rango de «gastos esenciales»** (opcional, recomendado). Amplía el rango de la fórmula del resumen para que incluya la última línea esencial. Así Excel y la app coinciden y desaparece el `CACHED_VALUE_DIFF` esperado.

**8. «Escenarios»: revisar el doble cómputo** (opcional). Si un escenario suma como «extra» una fila que ya está en el Presupuesto, quítala del rango de C o asume el aviso `SCENARIO_ITEM_ALREADY_IN_BASE`. Recuerda que en D (pago puntual) y C se admiten `=0`, una referencia directa o `=SUMA(...)` sobre un rango **contiguo** de la columna C de Datos.

**9. No hace falta tocar** «Proyección 12M» (A6 y los dos primeros meses tecleados), «Checks» ni «Dashboard»: el importador no los lee. Si sigues usando el Excel como herramienta propia, corregirlos evita lecturas engañosas, pero no afecta a la app.

**10. Verificación final.** Sube el archivo y elige el mes en la app. La vista previa debería mostrar **0 errores**. Los avisos esperados son:
   - `CACHED_VALUE_DIFF` en gastos esenciales, si no hiciste el paso 7.
   - `SCENARIO_ITEM_ALREADY_IN_BASE`, si no hiciste el paso 8.
   - `EVENT_REF_MONTHLY` (información) en las tres cuotas.
