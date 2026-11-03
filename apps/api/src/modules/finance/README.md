# Módulo `finance` — libro real (`ledger`)

Cuentas, categorías, movimientos, transferencias y conciliación mensual. Diseño: `docs/plan.md` §2.3. La capa de plan (`plan/`, fase 3) vive en este mismo módulo, pero todavía no existe.

**Estado (fase 1b, PR 3 de 3):** esquema, lógica pura, servicio, repositorio y rutas del libro, y sus pantallas web (`apps/web/src/finance/`). Los informes (1c) y la exportación (1d) están pendientes.

## Responsabilidad

- Guardar lo que ocurrió: ingresos, gastos, transferencias entre cuentas propias y conciliaciones con el saldo del banco.
- Calcular al leer los saldos y los totales. **No se guarda ningún dato derivado**, salvo `account_reconciliations.computed_balance_cents`, que es el registro histórico de lo que se calculó al conciliar (excepción documentada en el plan).

## Estructura

| Carpeta / archivo | Contenido | E/S |
|---|---|---|
| `ledger/domain/dates.ts` | Fechas contables `YYYY-MM-DD` como texto, sin `Date` ni zona horaria | No |
| `ledger/domain/balances.ts` | `balanceAsOf` (saldo de una cuenta hasta una fecha) y `monthlyTotals` (ingresos, gastos y ajustes de un mes) | No |
| `ledger/domain/reconciliation.ts` | `reconcile` (diferencia y ajuste) y `reconciliationDiscrepancy` (aviso si el libro deja de cuadrar con el banco) | No |
| `ledger/ledger.repository.ts` | Consultas de Kysely sobre las cinco tablas; importes ya en céntimos y fechas como texto | Base de datos |
| `ledger/ledger.service.ts` | Reglas que dependen de otras filas, transacciones y conciliación | — |
| `ledger/ledger.controller.ts`, `ledger/ledger.routes.ts` | HTTP: validación con los esquemas de `@backoffice/shared` y respuestas | — |
| `index.ts` | API pública: `createFinanceModule({ db, clock })` → `{ ledger, router }` | — |

## Endpoints (`/api/v1`, sesión activa; sin reautenticación)

`/accounts` (+ `/:id`, `/:id/archive`, `/:id/reconciliations`), `/reconciliations/:id`, `/categories` (+ `/:id`, `/:id/archive`), `/movements` (+ `/pending/count`, `/:id`, `/:id/confirm`) y `/transfers` (+ `/:id`). Detalle en `docs/plan.md` §2.10; esquemas en `packages/shared/src/finance/schemas.ts`.

Códigos de error del libro:

| Código | Cuándo |
|---|---|
| 400 | Cuerpo, consulta o identificador no válidos; origen y destino de una transferencia iguales; `asOf` fuera del mes |
| 404 | El recurso de la URL no existe |
| 422 | El cuerpo es válido pero incoherente con el libro: **cuenta o categoría inexistente** (se comprueba antes de insertar), categoría de otro tipo, fecha anterior a la apertura de la cuenta (movimientos, transferencias y conciliaciones), importe 0 en un movimiento confirmado |
| 409 | Cuenta o categoría archivada; ajuste de conciliación (no se edita ni se borra: solo con su conciliación); nombre duplicado; mes ya conciliado; borrador ya confirmado; archivar una cuenta con pendientes o con saldo distinto de 0 |

**Archivar exige saldo 0**: el saldo actual (`balanceAsOf` sin fecha: todos los movimientos confirmados y las transferencias, también los de fecha futura) debe ser 0 y no puede haber movimientos pendientes en la cuenta; si no, 409 con el saldo en el mensaje (p. ej. «Para archivar la cuenta, su saldo debe ser 0 (ahora: 125,40 €). Vacíala antes con una transferencia»). Un ajuste de conciliación que lleve el saldo a 0 vale como cualquier otro movimiento. Así una cuenta archivada no deja dinero «escondido» en los saldos totales.

Una cuenta archivada queda **congelada**: no admite movimientos, transferencias ni conciliaciones nuevos, ni editar o borrar los que tiene (409). Las cuentas y categorías no se borran, se archivan; por eso ninguna ruta de esta versión borra una fila referenciada y `isReferencedRowError` (`src/db/errors.ts`) todavía no se usa. Si algún día lo hace, será solo en el borrado: `23503` al insertar significa referencia inexistente (422), no conflicto.

## Tablas (migración `0003_ledger`)

`accounts`, `categories`, `account_reconciliations`, `movements` y `transfers`.

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

## Fase 1b frente a fase 2

`wallet_cards` y `device_tokens` son de la fase 2 y todavía no existen. Por eso `movements` no tiene `wallet_card_id`, `device_token_id`, `idempotency_key` ni `raw_payload`, y `source` solo admite `manual` y `reconciliation`. La migración de la fase 2 añadirá las columnas, el valor `shortcut` y sus restricciones (`docs/plan.md` §2.3 lo marca con «(fase 2)»).

## Errores de la base de datos

Borrar una fila referenciada (FK `ON DELETE RESTRICT`) da `23503` en PostgreSQL 17 y anteriores y `23001` en la 18. `isReferencedRowError` (`src/db/errors.ts`) reconoce los dos y es lo que debe usarse para responder 409.
