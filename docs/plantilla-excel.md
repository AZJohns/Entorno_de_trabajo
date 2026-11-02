# Especificación de la plantilla Excel del plan financiero

> Documento de referencia para implementar el importador (fase 3 de `docs/plan.md`).
> Describe **solo la estructura**. Los datos reales nunca se suben al repositorio.

## 0. Cómo leer este documento

- **[A CONFIRMAR]**: dato que no aparece en la descripción original de la plantilla y que hay que comprobar contra el archivo real **antes** de implementar. Mientras siga abierto, el importador no debe darlo por supuesto.
- **[DECISIÓN]**: regla de negocio que tiene que fijar el propietario (ver §12 y `docs/plan.md` §9).
- Los códigos internos (`income`, `eur_per_month`…) son los identificadores que usará el código; las etiquetas en español son las que aparecen en el Excel.
- Versiones de plantilla:
  - **v1**: la plantilla actual, sin columna de tipo de registro.
  - **v2** (propuesta, ver §7): v1 + columna `I = Tipo de registro` en «Datos y supuestos». Es la única que se recomienda soportar.

---

## 1. Principios del importador

1. **Solo se importan entradas.** Todo lo que la plantilla calcula (totales, proyección, metas pendientes, escenarios, checks, dashboard) se ignora. La aplicación lo recalcula. Opcionalmente, el importador puede comparar los valores calculados que Excel guardó en caché con el recálculo de la app y mostrar las diferencias como información. Nunca los guarda.
2. **Las filas de distintas hojas se relacionan por la referencia de la fórmula**, nunca por el texto del concepto. Los conceptos no siempre se escriben igual en las distintas hojas.
3. **Nunca se evalúan fórmulas.** En las columnas indicadas solo se acepta una **referencia directa** a una celda de «Datos y supuestos» (§5). Cualquier otra fórmula en una columna de entrada es un error.
4. **Se valida todo antes de escribir.** Se recogen todos los problemas con su hoja y su celda; no se detiene en el primero.
5. **No se escribe nada definitivo sin confirmación.** Subir el archivo genera una vista previa. Solo al confirmarla se guarda la foto del plan, en una única transacción.
6. **Una sola regla para cada concepto de negocio.** Por ejemplo, qué estados cuentan en el plan base lo decide una única función (§9.1). Así se evita por diseño que un total y su comprobación usen criterios distintos.

---

## 2. Formato del archivo

| Propiedad | Regla | Severidad si falla |
|---|---|---|
| Extensión | `.xlsm` (actual) o `.xlsx`. Se recomienda guardar como `.xlsx`, porque la plantilla no tiene macros [DECISIÓN] | error |
| Tamaño | ≤ 5 MB. Valor inicial que hay que ajustar midiendo la plantilla real | error |
| Contenedor | ZIP válido: empieza por `PK\x03\x04` y contiene `[Content_Types].xml` y `xl/workbook.xml`. El tipo MIME que envía el navegador no se tiene en cuenta | error |
| Límites del ZIP (anti zip-bomb) | Tamaño descomprimido total ≤ 50 MB y ≤ 200 entradas. Valores iniciales que hay que ajustar | error |
| Macros | Si existe `xl/vbaProject.bin` → se rechaza. La plantilla no debe tenerlas; en ningún caso se ejecuta nada | error |
| Vínculos externos | Si existe `xl/externalLinks/` → se rechaza | error |
| Sistema de fechas | Se respeta `date1904` del libro. Las fechas son números de serie con formato de fecha | — |
| Hojas | Las 8 de §6 con su nombre exacto (comparado tras normalizar, §3) | falta una hoja: error · sobra una hoja: aviso |
| Tablas y nombres definidos | No se usan; posiciones fijas | — |
| Cabecera | Fila **5** | error si no coincide |
| Datos | Desde la fila **6** | — |
| Columna inicial | **A** [A CONFIRMAR]. Lo hace coherente el ejemplo `='Datos y supuestos'!$C$8`, con «Valor» en C | — |

**Fin de la tabla de datos:** la tabla de cada hoja termina en la primera fila en la que **todas** sus columnas de entrada están vacías.
- En «Datos y supuestos», «Eventos y compromisos» y «Metas», si después de ese hueco hay filas con contenido → **aviso** `ROW_AFTER_GAP`. Esas filas no se importan y la vista previa las enumera, para que nunca se pierdan datos sin que se note.
- En «Presupuesto», el bloque de resumen ocupa una posición fija [A CONFIRMAR: ¿debajo de la tabla o al lado?] y se ignora por posición.

---

## 3. Normalización de textos

| Uso | Normalización |
|---|---|
| Nombres de hoja y cabeceras | Quitar espacios al principio y al final, juntar espacios repetidos, Unicode NFC, minúsculas y sin diacríticos. Si solo coincide después de quitar los acentos → aviso informativo |
| Valores de listas cerradas | La misma normalización. Acepta `Si` como `Sí` |
| Textos libres (concepto, nota…) | Quitar espacios al principio y al final, NFC. Se guarda el texto tal cual |
| Nombre de categoría (Presupuesto) | La normalización completa para buscar la correspondencia guardada (§8). Se muestra el original |

---

## 4. Tipos de celda

| Tipo | Regla |
|---|---|
| **Importe en euros** | Celda numérica. `céntimos = round(x × 100)`. Si `|x × 100 − céntimos| > 1e-6` → error `AMOUNT_PRECISION` (más de 2 decimales). Un texto como `"12,50"` es un error `CELL_TYPE`: no se adivinan formatos. Signo: los gastos se escriben en positivo [A CONFIRMAR]. Un negativo en un gasto o un ingreso → error |
| **Meses** | Celda numérica ≥ 0 con 2 decimales como máximo |
| **Fecha** | Número de serie de Excel con formato de fecha → fecha sin hora. Un texto como `"15/03/2027"` → error `CELL_TYPE`, con una pista para corregirlo |
| **Sí/No** | Lista cerrada `Sí`, `No` → booleano |
| **Lista cerrada** | Ver los catálogos de cada hoja. Un valor fuera de la lista → error `VALUE_NOT_IN_LIST` |
| **Texto** | Cualquier valor. Los números se convierten a texto |
| **Vacía** | Sin valor, o una cadena vacía después de quitar espacios |

---

## 5. Referencias permitidas entre hojas

Una celda de entrada «con referencia» solo puede contener **una referencia directa a una celda** de «Datos y supuestos».

- Forma aceptada (el `=` inicial es opcional, según lo que devuelva la librería; los `$` también son opcionales):
  `'Datos y supuestos'!$C$8`
- Expresión regular orientativa: `^=?'Datos y supuestos'!\$?([A-Z]{1,3})\$?([1-9][0-9]*)$`
- Se rechaza (`REF_UNSUPPORTED`): operaciones (`=C8*12`), funciones (`SUMA`, `INDIRECTO`…), rangos, otras hojas, otros libros (`[1]…`) y nombres.
- La fila referenciada tiene que estar en la zona de datos (≥ 6) y no estar vacía (`REF_TARGET_EMPTY`).
- La columna referenciada tiene que ser la que espera la celda de origen: `C` (Valor) para importes y `F` (Estado) para estados (`REF_TARGET_COLUMN`).
- **Fórmulas compartidas**: si la columna se rellenó arrastrando, Excel puede guardar la fórmula completa solo en la primera celda. La librería de lectura tiene que expandirla en cada celda. Es un punto que hay que verificar en el *spike* de la fase 3.
- Las columnas marcadas como **calculadas** pueden contener cualquier fórmula, porque se ignoran.

---

## 6. Hojas

### 6.1 «Datos y supuestos» — entrada principal

Es la fuente de verdad del plan: cada fila es un dato de entrada. Mezcla ingresos, gastos, saldos, supuestos, metas, escenarios, históricos y pagos puntuales. En la v1 no hay ninguna columna que indique de qué tipo es cada fila.

| Col | Cabecera | Campo | Tipo | Obligatorio | ¿Fórmula? | Notas |
|---|---|---|---|---|---|---|
| A | Grupo | `groupLabel` | texto | sí [A CONFIRMAR] | no | Agrupación visual; en la v2 no sirve para clasificar |
| B | Concepto | `concept` | texto | sí | no | |
| C | Valor | `amountCents` o `quantity` | importe o meses, según la Unidad | sí | **no**: tiene que ser un valor literal [DECISIÓN] | Fuente de verdad. Una fórmula aquí mezcla valores fijos y calculados |
| D | Unidad | `unit` | lista | sí | no | Ver el catálogo |
| E | Naturaleza | `nature` | lista | sí | no | Ver el catálogo |
| F | Estado | `status` | lista | sí | no | Ver el catálogo |
| G | Fuente/fecha | `sourceNote` | texto | no | no | Texto libre. No se interpreta como fecha |
| H | Nota | `note` | texto | no | no | Si contiene cifras → aviso informativo «cifra escrita a mano, puede quedar desfasada» (opcional) |
| I | Tipo de registro | `recordType` | lista | sí en la v2 | no | **Solo en la v2** (§7) |

**Unidad**

| Excel | Código | Valor (C) se guarda como |
|---|---|---|
| €/mes | `eur_per_month` | `amountCents` |
| € | `eur` | `amountCents` |
| meses | `months` | `quantity` (numérico, 2 decimales) |

**Naturaleza** (11 valores)

| Excel | Código |
|---|---|
| Recurrente | `recurring` |
| Variable | `variable` |
| Irregular | `irregular` |
| Saldo | `balance` |
| Supuesto | `assumption` |
| Objetivo | `target` |
| Potencial | `potential` |
| Finalizado | `finished` |
| Acumulado | `accumulated` |
| Pagado | `paid` |
| Puntual | `one_off` |

**Estado** (10 valores, lista cerrada)

| Excel | Código | ¿Cuenta en el plan base? (§9.1) [DECISIÓN] |
|---|---|---|
| Confirmado | `confirmed` | sí |
| Pendiente | `pending` | sí |
| Confirmar | `to_confirm` | sí |
| Provisional | `provisional` | sí |
| Estimado | `estimated` | sí |
| Confirmar pagado | `to_confirm_paid` | sí (pendiente de saber si ya se pagó) |
| Potencial | `potential` | no |
| No activo | `inactive` | no |
| Pausado | `paused` | no |
| Histórico | `historical` | no |

La columna de la derecha es una **propuesta**: la decide el propietario y se implementa como una única tabla en el código.

### 6.2 «Presupuesto»

Líneas de gasto presupuestadas. **Tipo** y **Esencial** solo existen en esta hoja.

| Col | Cabecera | Campo | Tipo | Obligatorio | ¿Fórmula? | Notas |
|---|---|---|---|---|---|---|
| A | Categoría | `categoryName` | texto | sí | no | Se relaciona con una categoría de la app (§8) |
| B | Concepto | `concept` | texto | sí | no | Solo para mostrar. **No se usa para relacionar filas** |
| C | Tipo | `costType` | lista: Fijo `fixed` · Variable `variable` · Irregular `irregular` | sí | no | |
| D | Esencial | `essential` | Sí/No | sí | no | |
| E | Mensual | `planItemRef` | referencia | sí | **solo una referencia directa a `Datos!C{n}`** | Un literal → error `FORMULA_REQUIRED` [DECISIÓN]. La fila destino tiene que tener la unidad `€/mes` (`REF_UNIT_MISMATCH`) |
| F | Anual | — | calculada | — | se ignora | La app la calcula: 12 × mensual |
| G | % ingreso | — | calculada | — | se ignora | |
| H | Estado del dato | `statusRef` | referencia | sí | **solo una referencia directa a `Datos!F{n}`** | Tiene que apuntar a **la misma fila n** que Mensual (`REF_ROWS_MISMATCH`) |

- El importe y el estado de la línea **no se guardan en la línea**: se obtienen de la fila de Datos referenciada. Así nunca existen dos copias del mismo valor.
- Si dos líneas de Presupuesto apuntan a la misma fila de Datos → aviso `DUPLICATE_REFERENCE`: el gasto contaría dos veces.
- **Bloque de resumen** (total de gastos recurrentes, ingresos netos, margen, tasa de ahorro, gastos esenciales y % de categorías confirmadas): calculado, se ignora. Posición [A CONFIRMAR].

### 6.3 «Eventos y compromisos»

| Col | Cabecera | Campo | Tipo | Obligatorio | ¿Fórmula? | Notas |
|---|---|---|---|---|---|---|
| A | Concepto | `concept` | texto | sí | no | |
| B | Naturaleza | `nature` | lista (la misma de §6.1) [A CONFIRMAR] | sí | no | |
| C | Importe | `planItemRef` **o** `amountCents` | referencia a `Datos!C{n}` **o** un importe literal | sí | sí, la referencia directa | Las dos formas están permitidas. Si es una referencia, la fila destino tiene la unidad `€` |
| D | Estado | `status` | lista: Estimado `estimated` · Pagado `paid` · Finalizado `finished` · Activo `active` · No activo `inactive` · No comprometido `not_committed` | sí | no | |
| E | Fecha prevista | `expectedDate` | fecha | condicionada | no | Obligatoria si F = Sí |
| F | Incluir 12M | `includeInProjection` | Sí/No | sí | no | |
| G | Impacto base | `baseImpact` | lista: Puntual `one_off` · Excluido `excluded` · Escenario `scenario` · Irregular `irregular` · Variable `variable` · Meta `goal` | sí | no | |
| H | Nota | `note` | texto | no | no | |

Reglas:
- `includeInProjection = Sí` y sin fecha → **error** `EVENT_DATE_REQUIRED`. En la plantilla esto solo era una comprobación; en la app es una restricción, para que ningún evento incluido desaparezca de la proyección sin avisar.
- `includeInProjection = Sí` y `baseImpact = Excluido` → **error** `EVENT_CONTRADICTION` [A CONFIRMAR la semántica de «Impacto base» frente a «Incluir 12M»].
- `includeInProjection = Sí` y estado `Pagado`, `Finalizado` o `No activo` → aviso: se proyectaría algo que ya ocurrió o que no ocurrirá.
- La fecha es anterior al primer mes de la proyección, el evento está incluido y no está pagado → aviso «evento vencido».
- La fecha queda después del mes 12 → información: no entra en la proyección.

### 6.4 «Metas»

| Col | Cabecera | Campo | Tipo | Obligatorio | ¿Fórmula? | Notas |
|---|---|---|---|---|---|---|
| A | Meta | `name` | texto | sí | no | |
| B | Objetivo | `targetRef` o `targetCents` | referencia a `Datos!C{n}` o un literal | sí | sí, la referencia directa | [A CONFIRMAR] si en la plantilla real es una fórmula calculada (p. ej., meses de fondo × gasto esencial). En ese caso hace falta una regla de cálculo explícita en la app |
| C | Actual | `currentRef` o `currentCents` | igual | sí | sí, la referencia directa | |
| D | Pendiente | — | calculada | — | se ignora | La app la calcula (§9.4) |
| E | Aportación/mes | `contributionRef` o `contributionCents` | igual; si es una referencia, la unidad es `€/mes` | sí (puede ser 0) | sí, la referencia directa | |
| F | Meses | — | calculada | — | se ignora | |
| G | Estado | `status` | lista: Completado `completed` · Pausado `paused` · En curso `in_progress` | sí | no | |
| H | Criterio | `criterion` | texto | no | no | |

Avisos: `completed` con actual < objetivo; `in_progress` con aportación 0.

### 6.5 «Escenarios» — calculada, pero con definiciones de entrada

La plantilla calcula: gasto base + extra mensual + pago puntual → caja libre y tasa libre. **No se conocen las columnas exactas** [A CONFIRMAR]. Propuesta:

| Dato que se lee | Campo | Origen |
|---|---|---|
| Nombre del escenario | `name` | literal |
| Extra mensual | `extraMonthlyCents` | literal o referencia a una fila de Datos de tipo `scenario` |
| Pago puntual | `oneOffCents` | literal o referencia a una fila de Datos de tipo `scenario` |

Se ignoran: el gasto base (lo calcula la app a partir del Presupuesto), la caja libre, la tasa libre y la lectura.

### 6.6 Hojas solo calculadas: «Proyección 12M», «Checks» y «Dashboard»

No se leen. Solo se comprueba que existen. [A CONFIRMAR] si «Proyección 12M» tiene una celda con el mes de inicio: si la tiene, se compara con el mes elegido al subir el archivo y una diferencia genera un aviso.

---

## 7. Clasificación de las filas de «Datos y supuestos»

La comparación entre las dos alternativas está en `docs/plan.md` §3.3. **Recomendación: v2 con una columna explícita.**

### 7.1 Columna I «Tipo de registro» (v2)

- Se añade **al final (columna I)** para no desplazar las columnas A–H ni romper las fórmulas que ya existen.
- En Excel, con una validación de datos de tipo lista y los valores siguientes:

| Excel | Código | Unidad esperada | Uso en los cálculos |
|---|---|---|---|
| Ingreso | `income` | €/mes | Ingresos mensuales |
| Gasto | `expense` | €/mes | Lo referencian las líneas de Presupuesto |
| Saldo de ahorro | `savings_balance` | € | Saldo inicial de la proyección |
| Supuesto | `assumption` | cualquiera | Parámetros (p. ej., meses de fondo de emergencia y aportaciones) |
| Meta | `goal` | € | Lo referencia «Metas» |
| Escenario | `scenario` | €/mes o € | Lo referencia «Escenarios» |
| Histórico | `historical` | cualquiera | No interviene en los cálculos |
| Pago puntual | `one_off_payment` | € | Lo referencia «Eventos» |

- **Detección de versión**: si la cabecera `I5` es «Tipo de registro» → v2. Si no → v1 → error `TEMPLATE_VERSION_UNSUPPORTED`, con un enlace a esta sección.

### 7.2 Comprobaciones cruzadas (avisos, no clasificación)

En la v2, las referencias entre hojas **no deciden** el tipo; solo sirven para detectar errores al etiquetar:

| Señal | Tipo esperado | Si no coincide |
|---|---|---|
| Referenciada desde Presupuesto · Mensual | `expense` | aviso `TYPE_SIGNAL_MISMATCH` |
| Referenciada desde Eventos · Importe | `one_off_payment` (o `scenario`) | aviso |
| Referenciada desde Metas | `goal` o `assumption` | aviso |
| Unidad distinta de la esperada para el tipo (tabla §7.1) | — | aviso |
| Fila `expense` incluida que no referencia ninguna línea de Presupuesto | — | aviso `EXPENSE_NOT_BUDGETED`: es un gasto que no se proyectaría |

---

## 8. Correspondencia de categorías

- La «Categoría» de Presupuesto es un texto. La comparativa entre plan y realidad necesita relacionarla con una **categoría de la app** (`categories`).
- Se guarda una tabla de correspondencias persistente: `nombre normalizado → category_id`. Se reutiliza de un mes a otro.
- Si una categoría no tiene correspondencia → `CATEGORY_UNMAPPED`. **Bloquea la confirmación** hasta que, en la vista previa, se elija una categoría existente o se cree una nueva.

---

## 9. Cálculos que hace la aplicación

Son funciones puras, sin acceso a la base de datos, con importes en **céntimos enteros**. Los porcentajes se comparan con aritmética entera (p. ej., `caja × 100 < 20 × ingresos`) y solo se redondean al mostrarlos.

### 9.1 Predicado de inclusión (único)

`includedInBase(status)` según la tabla de §6.1. **Todo** total, proyección y comprobación lo usa. Ningún cálculo filtra los estados por su cuenta.

### 9.2 Presupuesto (resumen)

| Indicador | Definición |
|---|---|
| Ingresos mensuales `I` | Σ filas `income` con la unidad `€/mes` e incluidas |
| Gasto mensual `G` | Σ importes de las filas de Datos referenciadas por las líneas de Presupuesto, si esas filas están incluidas |
| Margen `M` | `I − G` |
| Tasa de ahorro | `M / I`; si `I = 0` → «sin ingresos» |
| Gastos esenciales | Σ líneas con Esencial = Sí e incluidas |
| % confirmadas | Líneas con estado `confirmed` / líneas incluidas [A CONFIRMAR: ¿por número de líneas o por importe? ¿por línea o por categoría?] |
| Anual por línea | `12 × mensual` (solo para mostrar) |
| % ingreso por línea | `mensual / I` (solo para mostrar) |

### 9.3 Proyección a 12 meses

- Mes 1 = el mes del plan importado [A CONFIRMAR: ¿o el mes siguiente?].
- `S0` = Σ filas `savings_balance` incluidas («ahorro actual») [A CONFIRMAR si puede haber varias].
- Para cada mes `k = 1..12`:
  - `P_k` = Σ eventos con `includeInProjection` cuya `expectedDate` cae en el mes `k`.
  - `flujo_k = I − G − P_k`
  - `inicial_1 = S0`; `final_k = inicial_k + flujo_k`; `inicial_{k+1} = final_k`
  - `tasa_k = flujo_k / I`
- **Una sola función recorre todos los eventos de todos los meses.** No hay rangos por mes, así que un evento nuevo siempre se proyecta.
- Las aportaciones a metas no restan caja en la proyección, igual que en la plantilla [A CONFIRMAR].

### 9.4 Metas

- `pendiente = max(objetivo − actual, 0)`
- `meses = 0` si `pendiente = 0`; `ceil(pendiente / aportación)` si `aportación > 0`, con división entera; `null` («sin aportación») si `aportación = 0`.
- **Prueba de capacidad**: Σ aportaciones de las metas `in_progress` ≤ `M` [A CONFIRMAR si cuentan las metas `paused`].

### 9.5 Escenarios

- `gasto_e = G + extraMensual_e`
- `cajaLibre_e = I − gasto_e − pagoPuntual_e` [A CONFIRMAR: ¿el pago puntual se resta entero en un mes o se prorratea?]
- `tasaLibre_e = cajaLibre_e / I`
- Lectura: `< 0` → **Déficit**; `< 20 %` → **Margen bajo**; `< 40 %` → **Margen moderado**; si no → **Margen alto**. En los límites: 20 % exacto = moderado; 40 % exacto = alto. Si `I = 0` → «Sin ingresos».

### 9.6 Comprobaciones (Checks)

En la app, varias comprobaciones de la plantilla **ya no pueden fallar**, porque el valor se calcula y no se escribe a mano. Pasan a ser **invariantes verificados por tests unitarios**, no comprobaciones en tiempo de ejecución:

| Comprobación de la plantilla | En la app | Severidad si falla |
|---|---|---|
| Los ingresos cuadran | [A CONFIRMAR qué compara exactamente]. Si compara un total escrito con la suma de las líneas → invariante | — |
| Gasto total = suma de líneas | Invariante (el total *es* la suma) | test |
| Ingresos = gasto + margen | Invariante (`M = I − G`) | test |
| Aportaciones ≤ margen | Comprobación en tiempo de ejecución | **FAIL** |
| Saldo inicial = ahorro | Invariante (`inicial_1 = S0`) | test |
| Roll-forward de caja | Invariante (`inicial_{k+1} = final_k`) | test |
| Eventos incluidos con fecha | Restricción del importador y de la base de datos | no se puede guardar |
| Categorías esenciales pendientes | Comprobación en tiempo de ejecución: línea esencial con estado ≠ `confirmed` | **WARN** |
| *(nuevo)* Margen negativo | `M < 0` | **FAIL** |
| *(nuevo)* Saldo final negativo en algún mes | `final_k < 0` | **WARN** |
| *(nuevo)* Gasto de Datos no presupuestado | §7.2 | **WARN** |

**Estado global:** `FAIL` si hay algún FAIL; si no, `PASS WITH WARNINGS` si hay algún WARN; si no, `PASS`.

### 9.7 Dashboard

- Indicadores: los de §9.2 + el estado global de los checks.
- Gráficos:
  - **Composición del gasto**: G por categoría. Pedido como tarta; con más de 5–6 categorías se lee mejor en barras horizontales. Se agrupa el resto en «Otros».
  - **Caja acumulada proyectada**: línea con `final_k`.
  - **Caja libre por escenario**: barras, con la línea de 0 marcada.

---

## 10. Errores de la plantilla y cómo los evita la app por diseño

| Error en Excel | Causa | Prevención en la app |
|---|---|---|
| Rangos de suma distintos según el mes; los eventos nuevos no se proyectan | Rangos escritos a mano por columna | Una sola función recorre todos los eventos (§9.3). Un test añade un evento y comprueba que aparece |
| Un total incluye una línea que su propia comprobación excluye | Dos criterios de inclusión distintos | Un predicado único, `includedInBase` (§9.1), y un test que compara el total con el check |
| Valores fijos mezclados con fórmulas | Cifras tecleadas donde debía haber una referencia | El importador exige una referencia en Mensual y Estado (§6.2) y un literal en Datos · Valor (§6.1) |
| Textos con cifras escritas a mano que quedan desfasadas | Texto narrativo con números copiados | Los textos de la interfaz se generan a partir de los datos; no se guardan cifras en textos. Aviso opcional en las notas con cifras |

---

## 11. Catálogo de problemas del importador

Formato de cada problema: `{ code, severity: "error" | "warning" | "info", sheet, cell, message, expected?, found? }`. `cell` va en notación A1 (p. ej., `E12`). Los mensajes están en español.

| Código | Severidad | Cuándo |
|---|---|---|
| `FILE_TOO_LARGE` | error | Supera el tamaño máximo |
| `FILE_NOT_OOXML` | error | No es un ZIP OOXML válido |
| `FILE_ZIP_LIMITS` | error | Supera los límites de descompresión o de entradas |
| `FILE_HAS_MACROS` | error | Contiene `vbaProject.bin` |
| `FILE_EXTERNAL_LINKS` | error | Tiene vínculos a otros libros |
| `SHEET_MISSING` | error | Falta una hoja |
| `SHEET_UNEXPECTED` | warning | Sobra una hoja |
| `HEADER_MISMATCH` | error | La cabecera de la fila 5 no coincide (indica la esperada y la encontrada) |
| `TEMPLATE_VERSION_UNSUPPORTED` | error | Es una v1 (sin columna I) |
| `ROW_AFTER_GAP` | warning | Hay datos después de una fila vacía |
| `CELL_REQUIRED` | error | Falta un valor obligatorio |
| `CELL_TYPE` | error | El tipo no es el esperado |
| `VALUE_NOT_IN_LIST` | error | El valor no está en la lista cerrada |
| `AMOUNT_PRECISION` | error | El importe tiene más de 2 decimales |
| `AMOUNT_NEGATIVE` | error | Hay un negativo donde no está permitido |
| `FORMULA_NOT_ALLOWED` | error | Hay una fórmula en una columna que exige un literal |
| `FORMULA_REQUIRED` | error | Hay un literal en una columna que exige una referencia |
| `REF_UNSUPPORTED` | error | La fórmula no es una referencia directa a Datos |
| `REF_TARGET_EMPTY` | error | La referencia apunta a una fila vacía o fuera de la zona de datos |
| `REF_TARGET_COLUMN` | error | La referencia apunta a una columna incorrecta |
| `REF_ROWS_MISMATCH` | error | Mensual y Estado apuntan a filas distintas |
| `REF_UNIT_MISMATCH` | error | La unidad de la fila destino no es compatible |
| `DUPLICATE_REFERENCE` | warning | Dos líneas apuntan a la misma fila de Datos |
| `EVENT_DATE_REQUIRED` | error | Evento incluido sin fecha |
| `EVENT_CONTRADICTION` | error | Evento con Incluir = Sí e Impacto = Excluido |
| `CATEGORY_UNMAPPED` | error (bloquea la confirmación) | La categoría no tiene correspondencia |
| `TYPE_SIGNAL_MISMATCH` | warning | El tipo de registro no coincide con el uso de la fila |
| `EXPENSE_NOT_BUDGETED` | warning | Gasto de Datos sin línea de Presupuesto |
| `CACHED_VALUE_DIFF` | info | El valor calculado por Excel difiere del recálculo de la app |
| `MONTH_MISMATCH` | warning | El mes elegido no coincide con el que indica la plantilla (si existe esa celda) |

---

## 12. Archivo de ejemplo con datos ficticios (fixture de tests)

- `apps/api/test/fixtures/plan-ficticio-v2.xlsx` (o `.xlsm` si se mantiene esa extensión): **creado a mano en Excel** desde una plantilla vacía, con datos inventados (conceptos genéricos como «Ingreso A» y «Alquiler ficticio» e importes redondos). Tiene que guardarlo Excel para que el archivo tenga la misma serialización que el real: fórmulas compartidas, valores en caché y formatos de fecha.
- **Nunca** se crea «anonimizando» el archivo real: se arrastrarían valores, estructura personal y metadatos (autor, rutas).
- Cobertura mínima: al menos una fila de cada tipo de registro y de cada estado; un evento dentro y otro fuera del horizonte; un evento incluido en el mes 1 y otro en el mes 12; metas en los 3 estados, incluida una con aportación 0; 3 escenarios que crucen los umbrales de 0 %, 20 % y 40 %; una línea esencial pendiente; una categoría sin correspondencia.
- Los resultados esperados se calculan **a mano** y se documentan junto a la fixture (`plan-ficticio-v2.expected.md`). Los tests comparan con esos valores, no con lo que calcule Excel.
- Las variantes con errores (falta una hoja, cabecera cambiada, literal en Mensual, Mensual y Estado en filas distintas…) **se generan en los tests** modificando una copia de la fixture válida, para no mantener decenas de archivos binarios.
- Hay que revisar los metadatos del archivo (`docProps/core.xml`: autor, empresa) antes de hacer commit.

---

## 13. Lista de puntos [A CONFIRMAR] antes de implementar el importador

1. Columna inicial de cada hoja (se supone A) y orden exacto de las columnas de Presupuesto, Eventos, Metas y Escenarios.
2. Posición del bloque de resumen de Presupuesto.
3. Columnas de la hoja «Escenarios» y cómo se aplica el pago puntual.
4. Si Metas · Objetivo es una fórmula calculada en algún caso (p. ej., el fondo de emergencia).
5. Si la Naturaleza de Eventos usa la misma lista que Datos.
6. Qué compara exactamente el check «los ingresos cuadran».
7. Mes 1 de la proyección y si existe una celda con el mes del plan.
8. Si puede haber varias filas «Saldo de ahorro».
9. Signo de los gastos en Datos · Valor.
10. Si hay gastos irregulares con la unidad `€` referenciados desde Presupuesto · Mensual. Hoy eso sería un error `REF_UNIT_MISMATCH`.
11. Semántica de «Impacto base» frente a «Incluir 12M».
12. Si Datos · Valor contiene alguna fórmula (p. ej., una suma de ahorros). Hoy eso sería un error.
