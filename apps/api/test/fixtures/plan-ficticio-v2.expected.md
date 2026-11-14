# Resultados esperados de `plan-ficticio-v2.xlsx`

> Datos FICTICIOS, generados por `plan-workbook.ts` (no por Excel). Mes 1 de las pruebas: **2026-11**. Calculado a mano a partir de la disposición del libro; lo comprueban `apps/api/test/imports/parse-plan.test.ts` y `api-imports.test.ts`.
> Los resultados de los **cálculos** (ingresos, gasto, margen, proyección, metas, escenarios, checks) están en la sección «Resultados de los cálculos (fase 3b.2)», al final. Se calcularon **a mano**, antes del código, y los comprueba `apps/api/test/finance/plan-calculations-fixture.test.ts`. Lo primero es lo que extrae el importador.

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

- `CACHED_VALUE_DIFF`: necesita los cálculos de la 3b.2 y queda fuera del PR 1 (no hay endpoints ni vista previa que lo muestren).
- Los valores en caché de las celdas calculadas (p. ej. el Anual 9 600) están ahí a propósito: el importador no debe extraerlos (`parse-plan.test.ts`, «no extrae nada de lo que la plantilla calcula»).
- Una validación de datos limitada a un rango corto: el generador no escribe validaciones de Excel. Se prueba que el importador valida **todas** las filas contra los catálogos con el caso `VALUE_NOT_IN_LIST` de `issue-catalog.test.ts` (D29, fuera de cualquier rango validado). La fixture guardada por Excel debería llevar las validaciones reales de `plantilla-excel.md` §14.

## Resultados de los cálculos (fase 3b.2)

> Calculados **a mano** a partir de la tabla «Importes extraídos» y de la disposición de `plan-workbook.ts`, siguiendo `plantilla-excel.md` §9. **No** se generaron ejecutando las funciones. Todo en céntimos; `a/b` es la fracción exacta que devuelven las funciones (sin reducir) y el porcentaje entre paréntesis es solo orientativo. Mes 1 = **2026-11**; mes natural en curso para estos resultados = 2026-11 (no hay meses pasados).

### Estados que cuentan (§6.1)

Incluidos en el plan base: `confirmed`, `pending`, `to_confirm`, `provisional`, `estimated`, `to_confirm_paid`. Fuera: `potential`, `inactive`, `paused`, `historical`.

| Filas de Datos | Estado | ¿Incluida? |
|---|---|---|
| 6, 8, 16, 18, 19, 20, 26, 27 | Confirmado | sí |
| 7, 9, 17, 25 | Estimado | sí |
| 10 | Confirmar | sí |
| 11, 21 | Pendiente | sí |
| 12 | Provisional | sí |
| 13 | Confirmar pagado | sí |
| 14, 22, 23, 24 | Potencial | **no** |
| 15 | Pausado | **no** |
| 28 | Histórico | **no** |
| 29 | No activo | **no** |

### Presupuesto (§9.2)

- **Ingresos `I`** = filas `income` en €/mes e incluidas: fila 6 (250 000, confirmado) + fila 7 (30 000, estimado) = **280 000**.
- **Gasto `G`** = filas que referencian las 7 líneas de Presupuesto, todas incluidas: 80 000 (8) + 6 000 (9) + 35 000 (10) + 4 000 (11) + 2 500 (12) + 3 000 (13) + 12 000 (26) = **142 500**. Las filas de gasto 14, 15 y 29 no las referencia ninguna línea y están fuera por su estado; no cuentan.
- **Margen `M`** = 280 000 − 142 500 = **137 500**.
- **Tasa de ahorro** = M / I = **137 500/280 000** (49,11 %).
- **Gastos esenciales `E`** = líneas con Esencial = Sí e incluidas: Alquiler 80 000 + Electricidad 6 000 + Supermercado 35 000 + Cuota 12 000 = **133 000**. (Abono, Seguro y Suscripciones son «No».) La plantilla suma solo las tres primeras (`E6:E8`, 121 000) y deja fuera la cuota: es el error del rango, que la app no repite.
- **% confirmadas** = líneas incluidas con estado `confirmed` / líneas incluidas: Alquiler y Cuota son `confirmed`; Electricidad (`estimated`), Supermercado (`to_confirm`), Abono (`pending`), Seguro (`provisional`) y Suscripciones (`to_confirm_paid`) no → **2/7** (28,57 %).

| Línea | Mensual | Anual (12 × mensual) | % del ingreso (mensual / I) |
|---|---|---|---|
| Alquiler | 80 000 | 960 000 | 80 000/280 000 (28,57 %) |
| Electricidad | 6 000 | 72 000 | 6 000/280 000 (2,14 %) |
| Supermercado | 35 000 | 420 000 | 35 000/280 000 (12,50 %) |
| Abono de transporte | 4 000 | 48 000 | 4 000/280 000 (1,43 %) |
| Seguro anual | 2 500 | 30 000 | 2 500/280 000 (0,89 %) |
| Suscripciones | 3 000 | 36 000 | 3 000/280 000 (1,07 %) |
| Cuota del préstamo | 12 000 | 144 000 | 12 000/280 000 (4,29 %) |

### Proyección a 12 meses (§9.3)

- **`S0`** = filas `savings_balance` incluidas: fila 16 (500 000, confirmado) + fila 17 (150 000, estimado) = **650 000**.
- **Importe de cada evento:**
  - Fila 6, «Compra puntual»: literal **9 000**, fecha 2026-11-15 → mes 1.
  - Fila 7, «Seguro del coche»: referencia a la fila 25 (en €) = **45 000**, fecha 2027-02-10. Nov = 1, dic = 2, ene = 3, feb = 4 → mes 4.
  - Fila 8, «Segundo pago del seguro»: misma fila 25 = **45 000**, fecha 2027-08-10. Mar = 5, abr = 6, may = 7, jun = 8, jul = 9, ago = 10 → mes 10.
  - Fila 9, «Un pago de la cuota»: `Incluir 12M = No` y sin fecha → no se proyecta (su importe sería 12 000, un solo pago).
  - Fila 10, «Préstamo total»: cuota × plazo = `round_half_up(12 000 × 1 800 / 100)` = 21 600 000 / 100 = **216 000** (exacto, sin resto). Fecha 2028-05-01: posterior al mes 12 (2027-10) → fuera del horizonte.
- **`P_k`:** P₁ = 9 000, P₄ = 45 000, P₁₀ = 45 000, el resto = 0. Σ P = 99 000.
- `flujo_k = I − G − P_k = 137 500 − P_k`; `inicial_1 = S0`; `final_k = inicial_k + flujo_k`.

| k | Mes | P_k | flujo_k | inicial_k | final_k | tasa_k = flujo_k / I |
|---|---|---|---|---|---|---|
| 1 | 2026-11 | 9 000 | 137 500 − 9 000 = **128 500** | 650 000 | 650 000 + 128 500 = **778 500** | 128 500/280 000 (45,89 %) |
| 2 | 2026-12 | 0 | **137 500** | 778 500 | **916 000** | 137 500/280 000 |
| 3 | 2027-01 | 0 | **137 500** | 916 000 | **1 053 500** | 137 500/280 000 |
| 4 | 2027-02 | 45 000 | 137 500 − 45 000 = **92 500** | 1 053 500 | **1 146 000** | 92 500/280 000 (33,04 %) |
| 5 | 2027-03 | 0 | **137 500** | 1 146 000 | **1 283 500** | 137 500/280 000 |
| 6 | 2027-04 | 0 | **137 500** | 1 283 500 | **1 421 000** | 137 500/280 000 |
| 7 | 2027-05 | 0 | **137 500** | 1 421 000 | **1 558 500** | 137 500/280 000 |
| 8 | 2027-06 | 0 | **137 500** | 1 558 500 | **1 696 000** | 137 500/280 000 |
| 9 | 2027-07 | 0 | **137 500** | 1 696 000 | **1 833 500** | 137 500/280 000 |
| 10 | 2027-08 | 45 000 | **92 500** | 1 833 500 | **1 926 000** | 92 500/280 000 |
| 11 | 2027-09 | 0 | **137 500** | 1 926 000 | **2 063 500** | 137 500/280 000 |
| 12 | 2027-10 | 0 | **137 500** | 2 063 500 | **2 201 000** | 137 500/280 000 |

Comprobación cruzada: `S0 + 12 × 137 500 − Σ P` = 650 000 + 1 650 000 − 99 000 = **2 201 000** = `final_12`. Todos los meses son `source = plan` y ninguno lleva aviso. Ningún saldo final es negativo (el mínimo es 778 500).

### Metas (§9.4)

Los literales de la hoja (1 000 €, 500 €, 2 000 €…) están en céntimos.

| Meta | Objetivo | Actual | Pendiente = max(objetivo − actual, 0) | Aportación | Meses | Estado |
|---|---|---|---|---|---|---|
| Viaje (`fixed_amount`) | fila 19 = 300 000 | literal 100 000 | 300 000 − 100 000 = **200 000** | fila 20 = 15 000 | ceil(200 000 / 15 000) = ceil(13,33) = **14** | `in_progress` |
| Fondo de emergencia (`emergency_fund`) | `round_half_up(E × meses / 100)` = 133 000 × 600 / 100 = 79 800 000 / 100 = **798 000** | fila 16 = 500 000 | 798 000 − 500 000 = **298 000** | fila 21 = 20 000 | ceil(298 000 / 20 000) = ceil(14,9) = **15** | `in_progress` |
| Meta ya completada (`fixed_amount`) | literal 50 000 | literal 50 000 | max(0, 0) = **0** | literal 0 | **0** (pendiente 0) | `completed` |
| Meta sin aportación (`fixed_amount`) | literal 200 000 | literal 30 000 | 200 000 − 30 000 = **170 000** | literal 0 | **null** (aportación ≤ 0) | `paused` |

- **Prueba de capacidad:** Σ aportaciones de las metas `in_progress` = 15 000 + 20 000 = **35 000**; 35 000 ≤ M (137 500) → **cumple**; holgura = 137 500 − 35 000 = 102 500.

### Escenarios (§9.5)

`salidaTotal = G + extra + puntual`; `cajaLibre = I − salidaTotal`; `tasaLibre = cajaLibre / I`. Sin filtrar por estado (las filas 22 a 24 son `potential` y aun así cuentan). Umbrales con enteros: «alto» si `caja × 100 ≥ 40 × I` (40 × 280 000 = 11 200 000); «moderado» si `≥ 20 × I` (5 600 000); «bajo» si `≥ 0`; si no, «déficit».

| Escenario | Filas extra | Filas puntual | extra | puntual | Salida total | Caja libre | Tasa libre | caja × 100 | Lectura |
|---|---|---|---|---|---|---|---|---|---|
| Escenario base | — | — | 0 | 0 | 142 500 | 280 000 − 142 500 = **137 500** | 137 500/280 000 (49,11 %) | 13 750 000 ≥ 11 200 000 | **Margen alto** |
| Con curso | 22 | — | 8 000 | 0 | 142 500 + 8 000 = **150 500** | **129 500** | 129 500/280 000 (46,25 %) | 12 950 000 ≥ 11 200 000 | **Margen alto** |
| Con extras y reparación | 22, 23 | 24 | 8 000 + 4 500 = 12 500 | 60 000 | 142 500 + 12 500 + 60 000 = **215 000** | 280 000 − 215 000 = **65 000** | 65 000/280 000 (23,21 %) | 6 500 000: ≥ 5 600 000 y < 11 200 000 | **Margen moderado** |
| Con luz duplicada | 9 | — | 6 000 | 0 | 142 500 + 6 000 = **148 500** | **131 500** | 131 500/280 000 (46,96 %) | 13 150 000 ≥ 11 200 000 | **Margen alto** |

### Comprobaciones (§9.6) y estado global

| Comprobación | Severidad | Resultado | Desarrollo |
|---|---|---|---|
| Aportaciones ≤ margen | FAIL | **cumple** | 35 000 ≤ 137 500 |
| Margen negativo | FAIL | **cumple** (no es negativo) | M = 137 500 ≥ 0 |
| Esenciales no confirmadas | WARN | **avisa: 2 líneas** | Electricidad (`estimated`) y Supermercado (`to_confirm`). Alquiler y Cuota son `confirmed`; el resto no son esenciales |
| Saldo final negativo en algún mes | WARN | **cumple** | el mínimo de `final_k` es 778 500 |
| `EXPENSE_NOT_BUDGETED` | WARN | **cumple** | Gastos incluidos: filas 8 a 13 y 26; todas las referencia una línea. Las filas 14, 15 y 29 están excluidas por su estado |
| `SCENARIO_ITEM_ALREADY_IN_BASE` | WARN | **avisa: 1** | Escenario «Con luz duplicada»: su extra es la fila 9 (Electricidad), que referencia una línea de Presupuesto y es `estimated` (incluida) |
| `EVENT_ITEM_ALREADY_IN_BASE` | WARN | **avisa: 1** | Evento de la fila 10 (cuota × plazo): `Incluir 12M = Sí` y su importe referencia la fila 26 (la cuota), que está en el Presupuesto y es `confirmed`. Los eventos de las filas 7 y 8 referencian la fila 25 (no presupuestada); el de la fila 9 no está incluido |

**Estado global: `PASS WITH WARNINGS`** (ningún FAIL; tres comprobaciones con aviso).
