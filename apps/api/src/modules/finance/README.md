# Módulo `finance` — libro real (`ledger`)

Cuentas, categorías, movimientos, transferencias y conciliación mensual. Diseño: `docs/plan.md` §2.3. La capa de plan (`plan/`, fase 3) vive en este mismo módulo, pero todavía no existe.

**Estado (fase 1b, PR 1 de 3):** solo hay esquema y lógica pura. Las rutas, los servicios y los repositorios llegan en el PR 2, y la interfaz web en el PR 3.

## Responsabilidad

- Guardar lo que ocurrió: ingresos, gastos, transferencias entre cuentas propias y conciliaciones con el saldo del banco.
- Calcular al leer los saldos y los totales. **No se guarda ningún dato derivado**, salvo `account_reconciliations.computed_balance_cents`, que es el registro histórico de lo que se calculó al conciliar (excepción documentada en el plan).

## Estructura

| Carpeta / archivo | Contenido | E/S |
|---|---|---|
| `ledger/domain/dates.ts` | Fechas contables `YYYY-MM-DD` como texto, sin `Date` ni zona horaria | No |
| `ledger/domain/balances.ts` | `balanceAsOf` (saldo de una cuenta hasta una fecha) y `monthlyTotals` (ingresos, gastos y ajustes de un mes) | No |
| `ledger/domain/reconciliation.ts` | `reconcile` (diferencia y ajuste) y `reconciliationDiscrepancy` (aviso si un movimiento cambia después) | No |

## Tablas (migración `0003_ledger`)

`accounts`, `categories`, `account_reconciliations`, `movements` y `transfers`.

- **Importes** en `bigint` de céntimos y **siempre positivos** en `movements` y `transfers`: el signo lo da `kind` o el sentido de la transferencia. `pg` los devuelve como texto; se convierten con `centsFromDb` (`src/db/cents.ts`).
- **Fechas contables** (`date`) como texto `YYYY-MM-DD`: `createDatabase` configura el pool de `pg` para no convertirlas en `Date`.
- **Transferencias aparte**: ninguna consulta de ingresos o gastos toca `transfers`, así que no pueden contar como gasto. Solo las usa el cálculo de saldos.
- **Restricciones en la base de datos**: la categoría debe ser del mismo tipo que el movimiento (FK compuesta); un movimiento confirmado está completo y sin incidencias; un ajuste lleva `reconciliation_id`, está confirmado y es de la misma cuenta que la conciliación (FK compuesta); una conciliación por cuenta y mes; borrar la conciliación borra su ajuste.

## Decisiones

- **Saldo** hasta `as_of` incluido = apertura + ingresos confirmados − gastos confirmados + transferencias recibidas − enviadas. Los pendientes no cuentan; los ajustes sí.
- **Ajuste**: `statement − computed`. Si es 0 no se crea nada; si es positivo, un ingreso; si es negativo, un gasto por el valor absoluto, con `booked_on = as_of` para que entre en el saldo de esa fecha.
- **Los ajustes van en una línea propia** de los informes (`monthlyTotals.adjustmentsCents`): no son ingresos ni gastos reales.
- **Totales y saldos**: para las cuentas que ya existían al empezar el mes, la variación de la suma de sus saldos es `netCents + adjustmentsCents`; las transferencias se anulan entre cuentas propias.
- **Discrepancia**: se compara el saldo actual hasta `as_of`, sin el ajuste de esa conciliación, con el `computed_balance_cents` registrado.

## Fase 1b frente a fase 2

`wallet_cards` y `device_tokens` son de la fase 2 y todavía no existen. Por eso `movements` no tiene `wallet_card_id`, `device_token_id`, `idempotency_key` ni `raw_payload`, y `source` solo admite `manual` y `reconciliation`. La migración de la fase 2 añadirá las columnas, el valor `shortcut` y sus restricciones (`docs/plan.md` §2.3 lo marca con «(fase 2)»).

## Errores de la base de datos

Borrar una fila referenciada (FK `ON DELETE RESTRICT`) da `23503` en PostgreSQL 17 y anteriores y `23001` en la 18. `isReferencedRowError` (`src/db/errors.ts`) reconoce los dos y es lo que debe usarse para responder 409.
