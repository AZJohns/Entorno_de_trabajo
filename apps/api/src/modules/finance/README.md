# Módulo `finance` — libro real (`ledger`) y presupuesto (`budget`)

Cuentas, categorías, movimientos, transferencias y conciliación mensual (`ledger/`), y el presupuesto por categoría y mes (`budget/`). Diseño: `docs/plan.md` §2.3. La capa de plan (`plan/`, fase 3b) vive en este mismo módulo: de momento solo guarda la foto del plan que crea la confirmación de la importación (ver «Capa del plan»); sus cálculos son de la 3b.2.

**Estado del presupuesto (fase 3a, PR 1 de 2):** tabla, lógica pura, servicio y API de `/budgets`. Las pantallas llegan en el PR 2. Detalle en la sección «Presupuesto por categoría y mes», más abajo.

**Estado del libro (fase 1b, PR 3 de 3):** esquema, lógica pura, servicio, repositorio y rutas del libro, y sus pantallas web (`apps/web/src/finance/`). Los informes (1c) y la exportación (1d) están pendientes.

## Responsabilidad

- Guardar lo que ocurrió: ingresos, gastos, transferencias entre cuentas propias y conciliaciones con el saldo del banco.
- Calcular al leer los saldos y los totales. **No se guarda ningún dato derivado**, salvo `account_reconciliations.computed_balance_cents`, que es el registro histórico de lo que se calculó al conciliar (excepción documentada en el plan).

## Estructura

| Carpeta / archivo | Contenido | E/S |
|---|---|---|
| `ledger/domain/dates.ts` | Fechas contables `YYYY-MM-DD` como texto, sin `Date` ni zona horaria | No |
| `ledger/domain/balances.ts` | `balanceAsOf` (saldo de una cuenta hasta una fecha) y `monthlyTotals` (ingresos, gastos y ajustes de un mes) | No |
| `ledger/domain/reports.ts` | Informes sobre `balanceAsOf` y `monthlyTotals`: `monthlyReport`, `categoryBreakdown`, `pendingTotals`, `adjustmentsAsOf`, `accountBalanceLine`, `sumCents` | No |
| `ledger/domain/reconciliation.ts` | `reconcile` (diferencia y ajuste) y `reconciliationDiscrepancy` (aviso si el libro deja de cuadrar con el banco) | No |
| `ledger/ledger.repository.ts` | Consultas de Kysely sobre las cinco tablas; importes ya en céntimos y fechas como texto | Base de datos |
| `ledger/ledger.service.ts` | Reglas que dependen de otras filas, transacciones y conciliación | — |
| `ledger/reports.service.ts` | Informes (`/reports/*`): lee filas con el repositorio y calcula con `domain/reports.ts` | — |
| `ledger/ledger.controller.ts`, `ledger/ledger.routes.ts` | HTTP: validación con los esquemas de `@backoffice/shared` y respuestas | — |
| `budget/domain/budget.ts` | `budgetProgress`: gastado y restante por presupuesto, gasto sin presupuesto y totales; usa `categoryBreakdown` | No |
| `budget/budget.repository.ts` | Consultas de Kysely sobre `category_budgets` | Base de datos |
| `budget/budget.service.ts` | Reglas del presupuesto (categoría de gasto y no archivada, duplicados) y la copia del mes anterior | — |
| `budget/budget.controller.ts`, `budget/budget.routes.ts` | HTTP de `/budgets`; las rutas se añaden al router del libro | — |
| `plan/plan.repository.ts`, `plan/plan.service.ts` | Foto del plan de un mes y sus filas (`plan_*`), y correspondencias de categorías; sin ruta HTTP propia | Base de datos |
| `index.ts` | API pública: `createFinanceModule({ db, clock, … })` → `{ ledger, budgets, plan, router }` | — |

## Endpoints (`/api/v1`, sesión activa; sin reautenticación)

`/accounts` (+ `/:id`, `/:id/archive`, `/:id/reconciliations`), `/reconciliations/:id`, `/categories` (+ `/:id`, `/:id/archive`), `/movements` (+ `/pending/count`, `/:id`, `/:id/confirm`) y `/transfers` (+ `/:id`), más los informes `GET /reports/monthly?from&to`, `/reports/monthly/:month/categories`, `/reports/balances?at` y `/reports/balance-history?from&to`, y `GET /export` (S+: exige reautenticación completa en los últimos 10 minutos). Detalle en `docs/plan.md` §2.10; esquemas en `packages/shared/src/finance/schemas.ts`.

Códigos de error del libro:

| Código | Cuándo |
|---|---|
| 400 | Cuerpo, consulta o identificador no válidos; origen y destino de una transferencia iguales; `asOf` fuera del mes |
| 404 | El recurso de la URL no existe |
| 422 | El cuerpo es válido pero incoherente con el libro: **cuenta o categoría inexistente** (se comprueba antes de insertar), categoría de otro tipo, fecha anterior a la apertura de la cuenta (movimientos, transferencias y conciliaciones), importe 0 en un movimiento confirmado |
| 409 | Cuenta o categoría archivada; ajuste de conciliación (no se edita ni se borra: solo con su conciliación); nombre duplicado; mes ya conciliado; borrador ya confirmado; archivar una cuenta con pendientes o con saldo distinto de 0 |

**Archivar exige saldo 0**: el saldo actual (`balanceAsOf` sin fecha: todos los movimientos confirmados y las transferencias, también los de fecha futura) debe ser 0 y no puede haber movimientos pendientes en la cuenta; si no, 409 con el saldo en el mensaje (p. ej. «Para archivar la cuenta, su saldo debe ser 0 (ahora: 125,40 €). Vacíala antes con una transferencia»). Un ajuste de conciliación que lleve el saldo a 0 vale como cualquier otro movimiento. Así una cuenta archivada no deja dinero «escondido» en los saldos totales.

Una cuenta archivada queda **congelada**: no admite movimientos, transferencias ni conciliaciones nuevos, ni editar o borrar los que tiene (409). Las cuentas y categorías no se borran, se archivan; por eso ninguna ruta de esta versión borra una fila referenciada y `isReferencedRowError` (`src/db/errors.ts`) todavía no se usa. Si algún día lo hace, será solo en el borrado: `23503` al insertar significa referencia inexistente (422), no conflicto.

## Tablas

Migración `0003_ledger`: `accounts`, `categories`, `account_reconciliations`, `movements` y `transfers`. Migración `0005_category_budgets`: `category_budgets` (ver la sección del presupuesto).

- **Importes** en `bigint` de céntimos y **siempre positivos** en `movements` y `transfers`: el signo lo da `kind` o el sentido de la transferencia. `pg` los devuelve como texto; se convierten con `centsFromDb` (`src/db/cents.ts`).
- **Fechas contables** (`date`) como texto `YYYY-MM-DD`: `createDatabase` configura el pool de `pg` para no convertirlas en `Date`.
- **Transferencias aparte**: ninguna consulta de ingresos o gastos toca `transfers`, así que no pueden contar como gasto. Solo las usa el cálculo de saldos.
- **Restricciones en la base de datos**: la categoría debe ser del mismo tipo que el movimiento (FK compuesta); un movimiento confirmado está completo y sin incidencias; un ajuste lleva `reconciliation_id`, está confirmado y es de la misma cuenta que la conciliación (FK compuesta); una conciliación por cuenta y mes; borrar la conciliación borra su ajuste.

## Decisiones

- **Saldo** hasta `as_of` incluido = apertura + ingresos confirmados − gastos confirmados + transferencias recibidas − enviadas. Los pendientes no cuentan; los ajustes sí.
- **`balanceCents` en las cuentas** (`GET /accounts`, `/accounts/:id` y las respuestas de alta, edición y archivado): saldo **actual**, sin fecha: `balanceAsOf(ledger, null)`, es decir, todos los movimientos confirmados y las transferencias, **también los de fecha futura**; los pendientes no cuentan. Se calcula al leer y no se guarda. La lista usa `loadLedgers`: dos consultas (movimientos y transferencias) para todas las cuentas, y el dominio calcula cada saldo; no se duplica la lógica con `SUM` en SQL. Es el mismo saldo que exige 0 para archivar.
- **Ajuste**: `statement − computed`. Si es 0 no se crea nada; si es positivo, un ingreso; si es negativo, un gasto por el valor absoluto, con `booked_on = as_of` para que entre en el saldo de esa fecha.
- **Los ajustes van en una línea propia** de los informes (`monthlyTotals.adjustmentsCents`): no son ingresos ni gastos reales.
- **Totales y saldos**: para las cuentas que ya existían al empezar el mes, la variación de la suma de sus saldos es `netCents + adjustmentsCents`; las transferencias se anulan entre cuentas propias.
- **Discrepancia**: se compara el saldo calculado hoy hasta `as_of`, **con** los ajustes, con el `statement_balance_cents` registrado. Detecta movimientos y transferencias cambiados, un ajuste editado o borrado, y una conciliación de un mes anterior creada después. `computed_balance_cents` es solo el registro histórico.
- **Saldo de apertura**: `opening_balance_cents` es el saldo **al inicio del día** `opening_date`; los movimientos de ese día se suman a él. Por eso se rechazan (422) los anteriores a esa fecha y no se puede adelantar la apertura más allá de la actividad existente.
- **Altas manuales** nacen confirmadas y completas. Los borradores (`pending`) los creará el atajo de la fase 2; esta API los edita y confirma.

- **Informes** (`/reports/*`): solo lectura, sin SQL de agregación: el repositorio devuelve filas y `domain/reports.ts` suma con `balanceAsOf` y `monthlyTotals`. Los **ajustes de conciliación** nunca entran en ingresos, gastos ni en el desglose por categoría: salen en `adjustmentsCents` (mensual) y en su propia columna del saldo por cuenta (que sí los incluye, como `balanceAsOf`). Las **transferencias** solo afectan a los saldos. Los pendientes se cuentan aparte (ingresos y gastos por separado, porque restarlos no tendría sentido). `at`, `from` y `to` son obligatorios: el servidor no adivina «hoy» (zona horaria). Rango máximo: 60 meses (422). Los informes incluyen cuentas archivadas; no una cuenta en una fecha anterior a su apertura (en el histórico, `null`). Los movimientos confirmados exigen categoría, así que «sin categoría» solo es posible en teoría.

- **Exportación** (`GET /export`, S+): JSON legible con cuentas (también archivadas, con su saldo calculado al exportar), categorías, movimientos (confirmados, pendientes y ajustes), transferencias, presupuestos y conciliaciones; importes en céntimos. Formato versionado (`version: 2`) (`format`, `version`; esquema `exportResponseSchema` en `packages/shared`). **Qué no sale nunca**: usuarios, sesiones, factores, tokens ni la auditoría. Se garantiza porque el servicio devuelve registros del dominio (los mapeadores de `ledger.repository.ts` solo copian columnas conocidas) y el controlador construye el archivo campo a campo: una columna nueva de la base de datos no llega al archivo salvo que alguien la añada a propósito. Se lee en una transacción `REPEATABLE READ` para que sea una foto coherente. La auditoría (`data.exported`, con recuentos y sin datos) se registra **antes** de enviar el archivo: si falla, no sale nada. El nombre del archivo lo genera el servidor (`backoffice-export-AAAA-MM-DD.json`). La guarda de reautenticación y el registro de auditoría los inyecta la aplicación (`createFinanceModule`): este módulo no conoce la autenticación. No hay paginación: con el volumen de un solo usuario cabe en memoria; si creciera, habría que pasar a un flujo (*stream*).

## Presupuesto por categoría y mes (fase 3a)

Cuánto se quiere gastar como máximo cada mes en una categoría de gasto («Comida: 300 €») y cuánto se lleva gastado. Tabla `category_budgets` (migración `0005`); diseño en `docs/plan.md` §2.3.

**Endpoints** (`/api/v1`, sesión activa; CSRF en los que modifican datos):

| Ruta | Qué hace |
|---|---|
| `GET /budgets?month=YYYY-MM` | Presupuestos del mes con `spentCents` y `remainingCents`, `unbudgeted` (gasto de categorías sin presupuesto) y `totals`. `month` obligatorio |
| `POST /budgets` | `{ month, categoryId, amountCents }` → 201 |
| `PATCH /budgets/:id` | Solo `{ amountCents }`. El mes y la categoría no cambian: se borra y se crea otro |
| `DELETE /budgets/:id` | 204 |
| `POST /budgets/copy-previous` | `{ month }`: copia del mes anterior lo que falta → `{ copied, skippedExisting, skippedArchived, … }` |

**Errores** (mismo criterio que el libro): 400 cuerpo, consulta o identificador no válidos (incluido un importe ≤ 0, un campo desconocido o un mes mal escrito); 404 el presupuesto de la URL no existe; **422** la categoría no existe o es de ingreso, o `month` es `0001-01` al copiar; **409** categoría archivada (alta o cambio de importe), ya existe el presupuesto de ese mes y categoría, (copiar del mes anterior no da 409).

**Decisiones**

- **Lo gastado no se guarda.** `budgetProgress` lo calcula al leer con `categoryBreakdown`: gastos **confirmados** del mes en la categoría, sin pendientes, ingresos ni ajustes de conciliación; las transferencias no son movimientos, así que no entran. Es el mismo gasto que ven los informes. `remainingCents = amountCents − spentCents` y es **negativo** si se supera el presupuesto; calcular el porcentaje es cosa de la pantalla.
- **Gasto sin presupuesto**: las categorías con gasto confirmado y sin fila ese mes salen aparte (`unbudgeted`), de mayor a menor. `totals.spentCents` cuenta solo las categorías con presupuesto, y `totals.unbudgetedSpentCents` el resto: no se mezclan.
- **Un mes sin gastos** da `spentCents = 0` y `remainingCents = amountCents`; uno sin presupuestos, `items` vacío.
- **Categoría archivada**: su presupuesto y su gasto siguen saliendo en la lista (con `categoryArchived`), no se pueden crear presupuestos nuevos ni cambiar el importe (409) y sí borrar. La copia las omite.
- **Copiar del mes anterior** es una acción explícita, nunca automática. Solo rellena huecos: lo que el mes ya tiene no se toca y repetirla no duplica nada. Va en una transacción y el alta usa `ON CONFLICT DO NOTHING`, así que dos copias a la vez tampoco duplican. **Siempre 200 con los recuentos**, también si el mes anterior no tiene presupuestos o ya está todo copiado (`copied: 0`): es idempotente y repetirla no es un conflicto. El único error es el 422 si no hay mes anterior (`0001-01`).
- **Solo categorías de gasto**, comprobado dos veces: el servicio da 422 con un mensaje claro y la FK compuesta `(category_id, kind)` lo impide aunque alguien se salte el servicio.
- **Fase 3b**: la importación del Excel rellena esta misma tabla con `createFinanceModule(...).budgets.withDb(trx).createMany(month, items)` (otros módulos solo entran por `index.ts`): crea de una vez los presupuestos de un mes, todo o nada, y **nunca sobrescribe** (409 con la lista si alguna categoría ya tiene presupuesto ese mes; 409 si está archivada; 422 si no es de gasto o el importe no es positivo). Qué líneas suman y qué hacer con un total 0 lo decide el módulo `imports` (`docs/plan.md` §3.10, preguntas 39 y 40).
- **Preguntas abiertas** (`docs/plan.md` §9): 37 (avisos al pasarse del presupuesto) y 38 (gastos recurrentes) siguen pendientes y no están implementadas.
- **Exportación**: `GET /export` incluye `budgets` (`id`, `month`, `categoryId`, `amountCents`), leídos en la misma transacción que el resto; el formato sube a `version: 2`.

## Fase 1b frente a fase 2

`wallet_cards` y `device_tokens` son de la fase 2 y todavía no existen. Por eso `movements` no tiene `wallet_card_id`, `device_token_id`, `idempotency_key` ni `raw_payload`, y `source` solo admite `manual` y `reconciliation`. La migración de la fase 2 añadirá las columnas, el valor `shortcut` y sus restricciones (`docs/plan.md` §2.3 lo marca con «(fase 2)»).

## Errores de la base de datos

Borrar una fila referenciada (FK `ON DELETE RESTRICT`) da `23503` en PostgreSQL 17 y anteriores y `23001` en la 18. `isReferencedRowError` (`src/db/errors.ts`) reconoce los dos y es lo que debe usarse para responder 409.

## Capa del plan (`plan/`, fase 3b.1, PR 2)

Las entradas de las cinco hojas del Excel del plan, por foto de un mes: `plan_snapshots`, `plan_items`, `plan_budget_lines`, `plan_events`, `plan_goals`, `plan_scenarios`, `plan_scenario_items` y `plan_category_mappings` (migración `0010_plan_import`; diseño en `docs/plan.md` §2.4 y §3.10). **Solo entradas**: ningún total, proyección ni estado calculado (esos son de la 3b.2 y se calcularán al leer).

- `PlanService` no tiene rutas y no abre transacciones: lo usa el módulo `imports` dentro de la suya con `withDb(trx)`. `createSnapshot` pasa la foto vigente del mes a `superseded` y guarda la nueva con todas sus filas; `lockMonth` toma el bloqueo consultivo del mes; `findByContent` y `findByBatch` sirven a la idempotencia; `saveCategoryMappings` y `listCategoryMappings` llevan las correspondencias de categorías.
- Las referencias entre filas son claves ajenas compuestas `(snapshot_id, …)`: una línea, un evento o una meta solo pueden apuntar a una fila de Datos de **su** foto. Las categorías de las líneas y de las correspondencias, solo de gasto (FK compuesta con `kind = 'expense'`).
- Los importes son `bigint` en céntimos y los meses del plan, centésimas enteras; los meses y las fechas son `date`, sin zona horaria.
- Tests: `apps/api/test/imports/plan-schema.test.ts` (restricciones en la base de datos) y `apps/api/test/imports/api-confirm.test.ts` (de punta a punta).
