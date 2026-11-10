# Resultados esperados de `plan-ficticio-v2.xlsx`

> Datos FICTICIOS, generados por `plan-workbook.ts` (no por Excel). Mes 1 de las pruebas: **2026-11**. Calculado a mano a partir de la disposición del libro; lo comprueban `apps/api/test/imports/parse-plan.test.ts` y `api-imports.test.ts`.
> Los resultados de los **cálculos** (ingresos, gasto, margen, proyección, metas, escenarios, checks) llegan con la fase 3b.2, cuando existan las funciones que los calculan; aquí solo está lo que extrae el importador.

## Lo que se extrae

| Hoja | Filas importadas | Notas |
|---|---|---|
| Datos y supuestos | 24 (filas 6 a 29) | 9 tipos de registro, 10 estados, 11 naturalezas y 3 unidades; dos filas de saldo de ahorro (16 y 17) |
| Presupuesto | 7 (filas 6 a 12) | Las 6 primeras apuntan a las filas 8 a 13 de Datos con fórmulas **compartidas**; la 7.ª, a la 26. Fila 13 vacía y resumen en las filas 14 a 19 (no se importa) |
| Eventos y compromisos | 5 (filas 6 a 10) | Literal (90 €), referencia a una fila en € (dos eventos, misma fila 25), referencia a una fila en €/mes (fila 26) y cuota × plazo (filas 26 × 27) |
| Metas | 4 (filas 6 a 9) | Importe fijo con referencias; fondo de emergencia (sin objetivo extraído); una completada (500 € de 500 €); una sin aportación. Filas 10 y 11 vacías, resumen en 12 a 15 |
| Escenarios | 4 (filas 6 a 9) | `=0`, referencia, `SUM` de un rango (filas 22 y 23) y una referencia a un gasto que ya está en la base (fila 9) |

## Importes extraídos (céntimos)

| Fila de Datos | Concepto | Valor |
|---|---|---|
| 6 | Salario neto | 250 000 |
| 7 | Ingreso extra | 30 000 |
| 8 | Alquiler | 80 000 |
| 9 | Electricidad | 6 000 |
| 10 | Supermercado | 35 000 |
| 11 | Abono de transporte | 4 000 |
| 12 | Seguro anual (equivalente mensual) | 2 500 |
| 13 | Suscripciones | 3 000 |
| 16 | Saldo cuenta de ahorro A | 500 000 |
| 17 | Saldo cuenta de ahorro B | 150 000 |
| 18 | Meses de fondo de emergencia | **600** centésimas (6 meses) |
| 26 | Cuota del préstamo | 12 000 |
| 27 | Plazo del préstamo | **1 800** centésimas (18 meses) |

El evento de la fila 10 de «Eventos» (cuota × plazo) vale, por la fórmula de §6.3, `round_half_up(12 000 × 1 800 / 100) = 216 000` céntimos (2 160 €). Lo calcula la app en la 3b.2; el importador solo guarda la pareja de filas (26, 27).

## Problemas esperados (sin errores)

| Código | Severidad | Celda |
|---|---|---|
| `VALUE_IN_CALCULATED_COLUMN` | warning | Presupuesto!F10 (el Anual del gasto irregular escrito a mano: 300) |
| `EVENT_REF_MONTHLY` | info | Eventos y compromisos!C9 |
| `EVENT_AFTER_HORIZON` | info | Eventos y compromisos!E10 (2028-05-01) |
| `EVENT_ITEM_ALREADY_IN_BASE` | warning | Eventos y compromisos!C10 (la cuota, fila 26, ya está en el Presupuesto) |
| `SCENARIO_ITEM_ALREADY_IN_BASE` | warning | Escenarios!C9 (Electricidad, fila 9) |

Resumen: 0 errores, 3 avisos, 2 informaciones; `canConfirm = true` siempre que las 7 categorías de Presupuesto tengan correspondencia (Vivienda, Suministros, Alimentación, Transporte, Seguros, Ocio y Préstamos). Sin correspondencia, cada línea es un `CATEGORY_UNMAPPED` (error).

## Qué no hay en la fixture (y por qué)

- `CACHED_VALUE_DIFF`: necesita los cálculos de la 3b.2.
- Los valores en caché de las celdas calculadas (p. ej. el Anual 9 600) están ahí a propósito: el importador no debe extraerlos (`parse-plan.test.ts`, «no extrae nada de lo que la plantilla calcula»).
- Una validación de datos limitada a un rango corto: el generador no escribe validaciones de Excel. Se prueba que el importador valida **todas** las filas contra los catálogos con el caso `VALUE_NOT_IN_LIST` de `issue-catalog.test.ts` (D29, fuera de cualquier rango validado). La fixture guardada por Excel debería llevar las validaciones reales de `plantilla-excel.md` §14.
