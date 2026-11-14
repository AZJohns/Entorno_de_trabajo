# Capa del plan (`finance/plan`)

La foto del plan financiero de un mes (las entradas de las cinco hojas del Excel) y los **cálculos** que se hacen sobre ella. Diseño: `docs/plan.md` §2.4 (tablas), §3.10 (confirmación) y §3.12 (cálculos); contrato de la plantilla y fórmulas: `docs/plantilla-excel.md` §6, §9 y §10.

**Estado:** la foto se guarda (fase 3b.1, `plan.service.ts`/`plan.repository.ts`) y los cálculos son funciones puras (fase 3b.2, PR 1 de 2, `domain/`). Todavía **no hay endpoints** de cálculo: llegan en el PR 2.

## Responsabilidad

- `plan.service.ts` y `plan.repository.ts`: guardar la foto vigente de un mes (`plan_*`) y las correspondencias de categorías. Solo entradas; ningún dato derivado.
- `domain/`: calcular al leer presupuesto, proyección, metas, escenarios y comprobaciones. Sin E/S: reciben la foto ya leída (`PlanSnapshot`), nunca una conexión.

## API pública de `domain/`

El punto de entrada es `calculatePlan(snapshot, { currentMonth, realFlowByMonth? })` (`domain/index.ts`), que devuelve `{ budget, projection, goals, scenarios, checks }` con los mismos `I`, `G`, `E` y `M` para todos. Cada bloque también se puede llamar por separado.

| Archivo | Contenido | §9 |
|---|---|---|
| `types.ts` | `PlanSnapshot` y sus filas (forma de las tablas `plan_*`, en camelCase) | — |
| `budget.ts` | `summarizeBudget`: `I`, `G`, `M`, tasa de ahorro, `E`, % confirmadas, anual y % del ingreso por línea | 9.2 |
| `projection.ts` | `projectCash` (12 meses con `P_k`, meses reales o planificados), `eventAmountCents`, `eventsByMonth`, `openingBalance` | 9.3 |
| `goals.ts` | `evaluateGoals`: objetivo, pendiente, meses, estado y prueba de capacidad | 9.4 |
| `scenarios.ts` | `evaluateScenarios` y `readScenario`: extra, puntual, salida total, caja libre, tasa libre y lectura | 9.5 |
| `checks.ts` | `runChecks` y `overallStatus`: las siete comprobaciones en ejecución y el estado global | 9.6 |
| `rounding.ts` | `centsTimesMonths` (half-up), `roundHalfUpDiv`, `ceilDiv`, `sumCents` | 9, 6.3 |
| `ratio.ts` | `Ratio` (fracción entera sin reducir), `ratio`, `comparePercent` | 9 |
| `months.ts`, `items.ts` | Meses naturales sin `Date` y acceso a las filas de Datos por `id` | — |

## Reglas que no se rompen

- **Importes en céntimos enteros** y meses en centésimas. Ni `float`, ni `parseFloat`, ni `Math.round` sobre importes. El único redondeo es half-up y solo en los productos con meses (evento cuota × plazo y objetivo del fondo de emergencia).
- **Porcentajes como fracción** `{ numerator, denominator }`, `null` si no hay ingresos. Los umbrales se comparan con `comparePercent`, sin dividir.
- **`includedInBase` es el único predicado del plan base** (`packages/shared`). Excepción: los escenarios no filtran por estado (§9.5).
- **Una foto incoherente lanza `RangeError`** (referencia que no existe, importe que falta, evento incluido sin fecha): no se sigue con un 0.
- Las filas «Invariante» de §9.6 no son comprobaciones: son tests (`apps/api/test/finance/plan-invariants.test.ts`).

## Entrada y resultados

- `currentMonth` (`YYYY-MM`) lo decide quien llama (Europe/Madrid); las funciones no leen el reloj. `realFlowByMonth` es el flujo real (ingresos − gastos confirmados) de los meses que lo tienen.
- Estados de un mes de la proyección: `source = 'plan'` o `'real'`; `warning = 'NO_REAL_DATA'` si el mes es pasado y no hay datos reales.
- Lecturas y estados son códigos (`high`, `PASS_WITH_WARNINGS`…); el texto que ve el usuario («Margen alto», «PASS WITH WARNINGS») es de la presentación.

## Tests

`apps/api/test/finance/plan-*.test.ts`: tablas por función con casos límite, regresión de los 4 errores de la plantilla (`plan-regressions.test.ts`), invariantes sobre fotos generadas con semilla fija (`plan-invariants.test.ts`) y los valores de `apps/api/test/fixtures/plan-ficticio-v2.expected.md`, calculados **a mano** antes del código (`plan-calculations-fixture.test.ts`). Todo con datos ficticios.

## Decisiones

En `docs/plan.md` §3.12, incluidos los cinco huecos de §9 resueltos con la lectura literal y pendientes de confirmar.
