/**
 * Saldos y totales del libro (docs/plan.md §2.3). Funciones puras: reciben las filas ya leídas y no
 * hacen E/S, así que se prueban con tablas de casos.
 *
 * Unidades: todos los importes son céntimos enteros y positivos en las filas (el signo lo da `kind`
 * o el sentido de la transferencia); los resultados con signo (saldos, ajustes) pueden ser negativos.
 * Las sumas comprueban en cada paso que el resultado sigue siendo un entero seguro.
 */
import { assertCents, type Cents } from '@backoffice/shared';
import { assertLocalDate, isInMonth, type LocalDate } from './dates.ts';

/** Un ingreso o un gasto del libro. */
export interface LedgerMovement {
  readonly accountId: string | null;
  readonly kind: 'income' | 'expense';
  readonly amountCents: Cents;
  readonly bookedOn: LocalDate;
  readonly status: 'pending' | 'confirmed';
  readonly source: 'manual' | 'reconciliation';
  /** Solo en los ajustes de conciliación. */
  readonly reconciliationId: string | null;
}

/** Una transferencia entre dos cuentas propias. */
export interface LedgerTransfer {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: Cents;
  readonly bookedOn: LocalDate;
}

/** Todo lo necesario para calcular el saldo de una cuenta. */
export interface AccountLedger {
  readonly accountId: string;
  /**
   * Saldo **al inicio del día** de apertura (`opening_date`): los movimientos y las transferencias de
   * ese mismo día se suman a él. Puede ser negativo (descubierto).
   */
  readonly openingBalanceCents: Cents;
  /** Movimientos de cualquier cuenta: solo cuentan los de `accountId`. */
  readonly movements: readonly LedgerMovement[];
  /** Transferencias de cualquier cuenta: cuentan las que tienen `accountId` como origen o destino. */
  readonly transfers: readonly LedgerTransfer[];
}

function add(total: Cents, amount: Cents): Cents {
  return assertCents(total + assertCents(amount));
}

/**
 * Saldo calculado de una cuenta hasta `asOf` incluido:
 * `apertura + ingresos − gastos + transferencias recibidas − transferencias enviadas`.
 *
 * - Solo cuentan los movimientos **confirmados**: un pendiente (borrador del atajo) no mueve el saldo.
 * - Los ajustes de conciliación son movimientos confirmados y **sí** cuentan: tras conciliar, el saldo
 *   calculado coincide con el del banco.
 * - Sin `asOf`, se suma todo (saldo actual).
 * - No se filtra por la fecha de apertura: rechazar movimientos anteriores a ella es regla del servicio,
 *   así que el saldo de apertura nunca queda «después» de un movimiento.
 *
 * @throws {RangeError} si una fecha o un importe no son válidos o la suma deja de ser un entero seguro.
 */
export function balanceAsOf(ledger: AccountLedger, asOf: LocalDate | null): Cents {
  if (asOf !== null) assertLocalDate(asOf);
  const included = (bookedOn: LocalDate): boolean => asOf === null || bookedOn <= asOf;

  let balance = assertCents(ledger.openingBalanceCents);
  for (const movement of ledger.movements) {
    if (movement.accountId !== ledger.accountId || movement.status !== 'confirmed') continue;
    if (!included(movement.bookedOn)) continue;
    balance = add(
      balance,
      movement.kind === 'income' ? movement.amountCents : -movement.amountCents,
    );
  }
  for (const transfer of ledger.transfers) {
    if (!included(transfer.bookedOn)) continue;
    // Una transferencia no cambia el patrimonio total, solo lo mueve entre cuentas: suma en el
    // destino y resta en el origen.
    if (transfer.toAccountId === ledger.accountId) balance = add(balance, transfer.amountCents);
    if (transfer.fromAccountId === ledger.accountId) balance = add(balance, -transfer.amountCents);
  }
  return balance;
}

/** Totales de un mes natural. */
export interface MonthlyTotals {
  /** Ingresos confirmados del mes, sin los ajustes de conciliación. */
  readonly incomeCents: Cents;
  /** Gastos confirmados del mes, sin los ajustes de conciliación. */
  readonly expenseCents: Cents;
  /** `incomeCents − expenseCents`. No incluye los ajustes de conciliación. */
  readonly netCents: Cents;
  /**
   * Ajustes de conciliación del mes, con signo (ingreso positivo, gasto negativo). Van en una línea
   * propia: no son ingresos ni gastos reales, sino la diferencia con el banco.
   */
  readonly adjustmentsCents: Cents;
}

/**
 * Ingresos, gastos y ajustes de los movimientos confirmados de un mes.
 *
 * **Las transferencias no se pasan aquí ni se pueden pasar**: la función solo acepta movimientos, que es
 * lo que impide que una transferencia cuente como gasto (por eso viven en otra tabla). Solo el cálculo de
 * saldos ({@link balanceAsOf}) las usa.
 *
 * Relación con los saldos (se comprueba en test/finance/balances.test.ts): para las cuentas que ya
 * existían al empezar el mes, la variación de la **suma de sus saldos** durante el mes es
 * `netCents + adjustmentsCents`. Las transferencias no aparecen porque entre cuentas propias lo que
 * resta una lo suma la otra. Dos condiciones: hay que pasar los movimientos de todas esas cuentas, y una
 * cuenta abierta dentro del mes no cumple la igualdad, porque su saldo de apertura entra en la variación.
 *
 * @param month Primer día del mes (`YYYY-MM-01`); basta con cualquier día de ese mes.
 * @throws {RangeError} si `month` no es una fecha válida o un importe no es un entero seguro.
 */
export function monthlyTotals(
  movements: readonly LedgerMovement[],
  month: LocalDate,
): MonthlyTotals {
  assertLocalDate(month);
  let income = 0;
  let expense = 0;
  let adjustments = 0;
  for (const movement of movements) {
    if (movement.status !== 'confirmed' || !isInMonth(movement.bookedOn, month)) continue;
    const signed = movement.kind === 'income' ? movement.amountCents : -movement.amountCents;
    if (movement.source === 'reconciliation') {
      adjustments = add(adjustments, signed);
    } else if (movement.kind === 'income') {
      income = add(income, movement.amountCents);
    } else {
      expense = add(expense, movement.amountCents);
    }
  }
  return {
    incomeCents: income,
    expenseCents: expense,
    netCents: assertCents(income - expense),
    adjustmentsCents: adjustments,
  };
}
