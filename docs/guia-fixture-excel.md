# Guía: crear tú mismo la fixture del Excel (con datos inventados)

`plantilla-excel.md` §12 pide una fixture **guardada por Excel**, porque solo Excel escribe de verdad las fórmulas compartidas, los formatos de fecha y las cadenas compartidas. Hoy `apps/api/test/fixtures/plan-ficticio-v2.xlsx` la genera código (`plan-workbook.ts`): vale para los tests, pero no prueba cómo guarda Excel. Esta guía son unos 30 minutos.

**Reglas** (el repositorio es público):

- Datos **inventados**. **Nunca** partas de tu Excel real, ni copies celdas de él, ni «anonimices» una copia.
- Importes redondos y conceptos genéricos (los de abajo). Nada de nombres de bancos, tarjetas ni personas.

## 1. Libro vacío con la estructura v2

1. Libro nuevo de Excel. Hojas, con estos nombres exactos y en este orden: `Datos y supuestos`, `Presupuesto`, `Eventos y compromisos`, `Metas`, `Escenarios`, `Proyección 12M`, `Checks`, `Dashboard`.
2. En las cinco primeras, la **fila 5** lleva las cabeceras desde la columna A:

| Hoja | Cabeceras (A, B, C…) |
|---|---|
| Datos y supuestos | Grupo · Concepto · Valor · Unidad · Naturaleza · Estado · Fuente/fecha · Nota · Tipo de registro |
| Presupuesto | Categoría · Concepto · Tipo · Esencial · Mensual · Anual · % ingreso · Estado del dato |
| Eventos y compromisos | Concepto · Naturaleza · Importe · Estado · Fecha prevista · Incluir 12M · Nota |
| Metas | Meta · Objetivo · Actual · Pendiente · Aportación/mes · Meses · Estado · Criterio · Tipo de meta |
| Escenarios | Escenario · Gasto base · Extra mensual · Pago puntual · Salida total · Caja libre · Tasa libre · Lectura |

3. Validaciones de datos (§14 paso 2): en Datos, `D6:D500` (Unidad), `E6:E500` (Naturaleza), `F6:F29` (Estado: **déjala corta a propósito**, como la v1 solo cubría hasta F43; así el archivo reproduce una validación que no llega a todas las filas) e `I6:I500` (Tipo de registro); en Eventos, `F6:F23` (Incluir 12M) y `D6:D500` (Estado). Listas separadas por `;`.

## 2. Datos de «Datos y supuestos» (filas 6 a 29)

Grupo y concepto como quieras (genéricos). Lo importante es **fila, valor, unidad, naturaleza, estado y tipo**:

| Fila | Concepto | Valor | Unidad | Naturaleza | Estado | Tipo de registro |
|---|---|---|---|---|---|---|
| 6 | Salario neto | 2500 | €/mes | Recurrente | Confirmado | Ingreso |
| 7 | Ingreso extra | 300 | €/mes | Variable | Estimado | Ingreso (en G, una **fecha**, p. ej. 15/10/2026) |
| 8 | Alquiler | 800 | €/mes | Recurrente | Confirmado | Gasto |
| 9 | Electricidad | 60 | €/mes | Variable | Estimado | Gasto |
| 10 | Supermercado | 350 | €/mes | Variable | Confirmar | Gasto |
| 11 | Abono de transporte | 40 | €/mes | Recurrente | Pendiente | Gasto |
| 12 | Seguro anual (equivalente mensual) | 25 | €/mes | Irregular | Provisional | Gasto |
| 13 | Suscripciones | 30 | €/mes | Recurrente | Confirmar pagado | Gasto |
| 14 | Gasto potencial | 100 | €/mes | Potencial | Potencial | Gasto |
| 15 | Gasto pausado | 15 | €/mes | Recurrente | Pausado | Gasto |
| 16 | Saldo cuenta de ahorro A | 5000 | € | Saldo | Confirmado | Saldo de ahorro |
| 17 | Saldo cuenta de ahorro B | 1500 | € | Acumulado | Estimado | Saldo de ahorro |
| 18 | Meses de fondo de emergencia | 6 | meses | Objetivo | Confirmado | Meses de fondo de emergencia |
| 19 | Objetivo del viaje | 3000 | € | Objetivo | Confirmado | Meta |
| 20 | Aportación al viaje | 150 | €/mes | Objetivo | Confirmado | Meta |
| 21 | Aportación al fondo | 200 | €/mes | Objetivo | Pendiente | Meta |
| 22 | Extra: curso | 80 | €/mes | Supuesto | Potencial | Escenario |
| 23 | Extra: gimnasio | 45 | €/mes | Supuesto | Potencial | Escenario |
| 24 | Pago puntual: reparación | 600 | € | Puntual | Potencial | Escenario |
| 25 | Seguro del coche (pago único) | 450 | € | Puntual | Estimado | Pago puntual |
| 26 | Cuota del préstamo | 120 | €/mes | Recurrente | Confirmado | Gasto |
| 27 | Plazo del préstamo | 18 | meses | Supuesto | Confirmado | Supuesto |
| 28 | Gasto antiguo | 70 | €/mes | Pagado | Histórico | Histórico |
| 29 | Servicio dado de baja | 20 | €/mes | Finalizado | No activo | Gasto |

## 3. Las demás hojas (aquí está lo que Excel tiene que guardar él)

**Presupuesto**, filas 6 a 12 (categorías: Vivienda, Suministros, Alimentación, Transporte, Seguros, Ocio, Préstamos). Tipo: Fijo/Variable/Irregular; Esencial: Sí/No.

- **E6** = `='Datos y supuestos'!$C8` y **H6** = `='Datos y supuestos'!$F8`. Selecciona E6 y **arrastra el controlador de relleno hasta E11** (haz lo mismo con H6 hasta H11). **No copies y pegues celda a celda**: lo que cuenta es rellenar arrastrando, porque es lo que hace que Excel escriba una fórmula compartida.
- **F6** = `=E6*12`, arrastrada hasta F11. Después **escribe a mano `300` en F10** (el gasto irregular).
- Fila 12 (Préstamos): E12 = `='Datos y supuestos'!$C$26`, H12 = `='Datos y supuestos'!$F$26`, F12 = `=E12*12`.
- Fila 13 vacía. **Resumen** en las filas 14 a 19, etiqueta en A (los textos exactos de `plantilla-excel.md` §2.1) y una fórmula cualquiera en E (p. ej. `=SUMA(E6:E12)`). Una nota en A21.

**Eventos y compromisos**, filas 6 a 10 (G = nota; D = Estimado salvo la 10, Activo; F = Sí salvo la 9, No):

| Fila | Importe (C) | Fecha (E) |
|---|---|---|
| 6 | `90` (literal) | 15/11/2026 |
| 7 | `='Datos y supuestos'!$C$25` | 10/02/2027 |
| 8 | `='Datos y supuestos'!$C$25` | 10/08/2027 |
| 9 | `='Datos y supuestos'!$C$26` | (vacía) |
| 10 | `='Datos y supuestos'!$C$26*'Datos y supuestos'!$C$27` | 01/05/2028 |

**Metas**, filas 6 a 9 (I = Importe fijo, salvo la 7 = Fondo de emergencia). Filas 10 y 11 vacías; resumen en las filas 12 a 15; nota en A18.

- Fila 6: B = `='Datos y supuestos'!$C$19`; C = `1000`; E = `='Datos y supuestos'!$C$20`. Fila 7: B = `=SUMA(Presupuesto!E6:E8)*'Datos y supuestos'!$C$18`; C = `='Datos y supuestos'!$C$16`; E = `='Datos y supuestos'!$C$21`. Fila 8: B = 500, C = 500, E = 0. Fila 9: B = 2000, C = 300, E = 0. D, F y G con las fórmulas que quieras (se ignoran).

**Escenarios**, filas 6 a 9 (nota en A12). C y D: fila 6 `=0` y `=0`; fila 7 `='Datos y supuestos'!$C$22` y `=0`; fila 8 `=SUMA('Datos y supuestos'!C22:C23)` y `='Datos y supuestos'!$C$24`; fila 9 `='Datos y supuestos'!$C$9` y `=0`. B y E a H, con las fórmulas que quieras.

**Proyección 12M, Checks y Dashboard**: un título en A1 basta.

## 4. Guardar y limpiar

1. Guardar como **`.xlsx`** (Libro de Excel, sin macros).
2. Archivo → Información → Comprobar si hay problemas → **Inspeccionar documento**, y quita las propiedades del documento y la información personal (autor, empresa).
3. Guárdalo como `apps/api/test/fixtures/plan-ficticio-v2-excel.xlsx`. **No sustituyas todavía** `plan-ficticio-v2.xlsx`.

## 5. Comprobar que Excel escribió fórmulas compartidas

1. Copia el archivo, cámbiale la extensión a `.zip` y ábrelo. En `xl/worksheets/`, abre con un editor de texto la hoja de Presupuesto (`sheet2.xml`, normalmente).
2. Busca `t="shared"`. Debe haber una celda maestra con `ref="E6:E11"` y `si="0"` y varias celdas con `<f t="shared" si="0"/>` sin texto. **Si no aparece**, Excel no usó fórmulas compartidas (otra versión o relleno distinto): anótalo, porque cambia lo que hay que probar.
3. Anota también cómo guardó Excel la fecha de G7 (`<c … s="N">` y el `numFmtId` de ese estilo en `xl/styles.xml`).

## 6. Qué se comprobará con ese archivo

(Descrito también en `docs/plan.md` §3.9; la comprobación se añade a `apps/api/test/imports/fixture.test.ts` cuando el archivo exista.)

- Importarlo da **las mismas entradas y el mismo `content_hash`** que `plan-ficticio-v2.xlsx` (mismos datos): cada línea de Presupuesto expandida a las filas 8 a 13 y 26, y Mensual y Estado en la misma fila.
- Los avisos esperados son los de `plan-ficticio-v2.expected.md`, y ningún error.
- La fecha de G7 sale como `2026-10-15` en «Fuente/fecha» y los eventos conservan sus fechas.
- Un `.xlsm` sin macros se acepta (guárdalo otra vez como `.xlsm` y súbelo).
- Las variantes con errores (un valor fuera del catálogo después del rango validado, etc.) se siguen generando en los tests; no las metas en este archivo, que debe importarse **sin errores**.

Si algo no coincide con lo que dice `plantilla-excel.md`, se corrige **el documento** antes de seguir (§13).
