# Capa del plan (`finance/plan`)

La foto del plan financiero de un mes (las entradas de las cinco hojas del Excel) y los **cálculos** que se hacen sobre ella. Diseño: `docs/plan.md` §2.4 (tablas), §3.10 (confirmación) y §3.12 (cálculos); contrato de la plantilla y fórmulas: `docs/plantilla-excel.md` §6, §9 y §10.

**Estado:** la foto se guarda (fase 3b.1, `plan.service.ts`/`plan.repository.ts`), los cálculos son funciones puras (fase 3b.2, PR 1 de 2, `domain/`) y se exponen con nueve `GET` de solo lectura (fase 3b.2, PR 2 de 2, `plan-query.service.ts`). La comparativa con lo real (`/comparison`) es de la 3b.3.

## Responsabilidad

- `plan.service.ts` y `plan.repository.ts`: guardar la foto vigente de un mes (`plan_*`) y las correspondencias de categorías. Solo entradas; ningún dato derivado.
- `plan-query.service.ts`, `plan.controller.ts` y `plan.routes.ts`: **leer** la foto (una sola lectura por petición), armar el `PlanSnapshot`, llamar a `calculatePlan` y dar forma a la respuesta. Sin fórmulas propias ni SQL fuera del repositorio.
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


## Endpoints de lectura (`/api/v1/plan`, sesión activa)

| Ruta | Respuesta |
|---|---|
| `GET /plan/snapshots?from&to` | Historial de fotos (vigentes y sustituidas), la más reciente primero. `from` y `to` obligatorios, máximo 60 meses (422) |
| `GET /plan/snapshots/:id` | Entradas de una foto, también si está sustituida |
| `GET /plan/months/:month` | Entradas de la foto **vigente** del mes |
| `GET /plan/months/:month/budget`, `/projection`, `/goals`, `/scenarios`, `/checks` | Un bloque calculado con la cabecera `{ snapshotId, month, currentMonth }` |
| `GET /plan/months/:month/dashboard` | Los cinco bloques juntos, del mismo cálculo |

- **Foto de un mes:** solo la `active`. Sin foto vigente, 404 también en los calculados; no se usa «la anterior más reciente» (eso es de la comparativa, §3.8).
- **Mes en curso:** `localYearMonth('Europe/Madrid', clock.now())` (`apps/api/src/lib/local-time.ts`). Nunca `new Date()` ni la zona del servidor.
- **Flujo real:** el plan lo pide al libro con la función inyectada `realFlow` (`ReportsService.realFlow`, que usa `realFlowByMonth` de `ledger/domain/reports.ts`), solo para los meses del horizonte anteriores al mes en curso. Un mes sin ingresos ni gastos confirmados no entra en el mapa (`NO_REAL_DATA`); uno que suma 0 sí.
- **Errores:** 400 (mes, id o consulta con formato incorrecto), 404 (no hay foto), 422 (rango de más de 60 meses) y 500 genérico si un cálculo falla. En ese caso se lanza `PlanCalculationError` con solo el id de la foto: el `RangeError` original cita conceptos y no se propaga.
- **Esquemas:** `packages/shared/src/plan/schemas.ts`. Decisiones en `docs/plan.md` §3.13.

## Reglas que no se rompen

- **Importes en céntimos enteros** y meses en centésimas. Ni `float`, ni `parseFloat`, ni `Math.round` sobre importes. El único redondeo es half-up y solo en los productos con meses (evento cuota × plazo y objetivo del fondo de emergencia).
- **Porcentajes como fracción** `{ numerator, denominator }`, `null` si no hay ingresos. Los umbrales se comparan con `comparePercent`, sin dividir.
- **`includedInBase` es el único predicado del plan base** (`packages/shared`). Excepción: los escenarios no filtran por estado (§9.5).
- **Una foto incoherente lanza `RangeError`** (referencia que no existe, importe que falta, evento incluido sin fecha): no se sigue con un 0. Una foto que el importador deja confirmar no debe llegar a este caso: el importador bloquea las unidades de `savings_balance` y `emergency_fund_months` que los cálculos no pueden leer, y `plan-importer-contract.test.ts` lo comprueba.
- Las filas «Invariante» de §9.6 no son comprobaciones: son tests (`apps/api/test/finance/plan-invariants.test.ts`).

## Entrada y resultados

- `currentMonth` (`YYYY-MM`) lo decide quien llama (Europe/Madrid); las funciones no leen el reloj. `realFlowByMonth` es el flujo real (ingresos − gastos confirmados) de los meses que lo tienen.
- Estados de un mes de la proyección: `source = 'plan'` o `'real'`; `warning = 'NO_REAL_DATA'` si el mes es pasado y no hay datos reales.
- Lecturas y estados son códigos (`high`, `PASS_WITH_WARNINGS`…); el texto que ve el usuario («Margen alto», «PASS WITH WARNINGS») es de la presentación.

## Tests

`apps/api/test/finance/api-plan.test.ts` y `api-plan-projection.test.ts` (los endpoints contra la base de datos real: valores de la fixture, meses pasados, cambio de mes en Madrid y cálculo que falla) y `plan-real-flow.test.ts` (flujo real). `apps/api/test/finance/plan-*.test.ts`: tablas por función con casos límite, regresión de los 4 errores de la plantilla (`plan-regressions.test.ts`), invariantes sobre fotos generadas con semilla fija (`plan-invariants.test.ts`) y los valores de `apps/api/test/fixtures/plan-ficticio-v2.expected.md`, calculados **a mano** antes del código (`plan-calculations-fixture.test.ts`). Todo con datos ficticios.

## Decisiones

En `docs/plan.md` §3.12, incluidos los cinco huecos de §9 resueltos con la lectura literal y pendientes de confirmar.
