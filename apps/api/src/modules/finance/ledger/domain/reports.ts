/**
 * Informes del libro (docs/plan.md §5, `/reports/*`). Funciones puras sobre filas ya leídas: reutilizan
 * `balanceAsOf` y `monthlyTotals` y solo añaden lo que esas dos no cubren (desglose por categoría,
 * pendientes y ajustes acumulados). Ni el SQL ni la web repiten estos cálculos.
 *
 * Unidades: céntimos enteros. Los ajustes de conciliación nunca se mezclan con ingresos o gastos reales:
 * van siempre en su propia línea (`adjustmentsCents`, con signo).
 */
import { assertCents, type Cents } from '@backoffice/shared';
import {
  balanceAsOf,
  monthlyTotals,
  type AccountLedger,
  type LedgerMovement,
  type MonthlyTotals,
} from './balances.ts';
import {
  assertLocalDate,
  isInMonth,
  monthsBetween,
  type LocalDate,
  type YearMonth,
} from './dates.ts';

/** Movimiento con su categoría, que `LedgerMovement` no necesita para calcular saldos. */
export interface CategorizedMovement extends LedgerMovement {
  readonly categoryId: string | null;
}

/** Suma de importes comprobando en cada paso que sigue siendo un entero seguro. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) total = assertCents(total + assertCents(value));
  return total;
}

/** Movimientos sin confirmar de un mes: no entran en los totales, pero se avisa de ellos. */
export interface PendingTotals {
  readonly count: number;
  /** Suma de los pendientes de tipo ingreso. */
  readonly incomeCents: Cents;
  /** Suma de los pendientes de tipo gasto. Separado del ingreso: restarlos no tendría sentido. */
  readonly expenseCents: Cents;
}

/** Cuenta los pendientes de un mes (los ajustes de conciliación nunca son pendientes). */
export function pendingTotals(
  movements: readonly LedgerMovement[],
  month: LocalDate,
): PendingTotals {
  assertLocalDate(month);
  let count = 0;
  let income = 0;
  let expense = 0;
  for (const movement of movements) {
    if (movement.status !== 'pending' || !isInMonth(movement.bookedOn, month)) continue;
    count += 1;
    if (movement.kind === 'income') income = assertCents(income + movement.amountCents);
    else expense = assertCents(expense + movement.amountCents);
  }
  return { count, incomeCents: income, expenseCents: expense };
}

/** Una fila del informe mensual. */
export interface MonthlyReportRow extends MonthlyTotals {
  readonly month: YearMonth;
  readonly pending: PendingTotals;
}

/**
 * Totales de cada mes de `from` a `to` (incluidos), también los meses sin movimientos (a cero), para
 * que un gráfico no «salte» meses.
 *
 * @throws {RangeError} si algún mes no es válido.
 */
export function monthlyReport(
  movements: readonly LedgerMovement[],
  from: YearMonth,
  to: YearMonth,
): MonthlyReportRow[] {
  return monthsBetween(from, to).map((month) => ({
    month,
    ...monthlyTotals(movements, `${month}-01`),
    pending: pendingTotals(movements, `${month}-01`),
  }));
}

/** Total de una categoría en un mes. `categoryId` es `null` para lo que no tiene categoría. */
export interface CategoryTotal {
  readonly kind: 'income' | 'expense';
  readonly categoryId: string | null;
  readonly totalCents: Cents;
}

/**
 * Desglose por categoría de los movimientos **confirmados** de un mes, sin los ajustes de conciliación
 * (coherente con {@link monthlyTotals}: la suma de cada tipo es su `incomeCents` o `expenseCents`).
 * Orden: ingresos antes que gastos y, dentro de cada tipo, de mayor a menor importe (a igualdad, por
 * `categoryId`, para que el resultado sea estable).
 *
 * @param month Cualquier día del mes (`YYYY-MM-DD`).
 */
export function categoryBreakdown(
  movements: readonly CategorizedMovement[],
  month: LocalDate,
): CategoryTotal[] {
  assertLocalDate(month);
  const totals = new Map<string, CategoryTotal>();
  for (const movement of movements) {
    if (
      movement.status !== 'confirmed' ||
      movement.source === 'reconciliation' ||
      !isInMonth(movement.bookedOn, month)
    ) {
      continue;
    }
    const key = `${movement.kind}|${movement.categoryId ?? ''}`;
    const previous = totals.get(key);
    totals.set(key, {
      kind: movement.kind,
      categoryId: movement.categoryId,
      totalCents: assertCents((previous?.totalCents ?? 0) + movement.amountCents),
    });
  }
  const rank = (kind: 'income' | 'expense'): number => (kind === 'income' ? 0 : 1);
  return [...totals.values()].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      b.totalCents - a.totalCents ||
      (a.categoryId ?? '').localeCompare(b.categoryId ?? ''),
  );
}

/**
 * Suma, con signo, de los ajustes de conciliación **confirmados** de una cuenta hasta `asOf` incluido
 * (ingreso positivo, gasto negativo). Ya están dentro de {@link balanceAsOf}; esto solo los muestra
 * aparte. Sin `asOf`, todos.
 */
export function adjustmentsAsOf(ledger: AccountLedger, asOf: LocalDate | null): Cents {
  if (asOf !== null) assertLocalDate(asOf);
  let total = 0;
  for (const movement of ledger.movements) {
    if (
      movement.accountId !== ledger.accountId ||
      movement.source !== 'reconciliation' ||
      movement.status !== 'confirmed' ||
      (asOf !== null && movement.bookedOn > asOf)
    ) {
      continue;
    }
    total = assertCents(
      total + (movement.kind === 'income' ? movement.amountCents : -movement.amountCents),
    );
  }
  return total;
}

/** Saldo de una cuenta en una fecha, con la parte que viene de ajustes de conciliación. */
export interface AccountBalanceLine {
  readonly accountId: string;
  /** Saldo calculado (`balanceAsOf`): incluye los ajustes. */
  readonly balanceCents: Cents;
  /** De ese saldo, lo debido a ajustes de conciliación (con signo). */
  readonly adjustmentsCents: Cents;
}

/**
 * Saldo de una cuenta en `asOf`, o `null` si en esa fecha aún no estaba abierta (`openingDate > asOf`):
 * `balanceAsOf` devolvería su saldo de apertura aunque la cuenta no existiera todavía.
 */
export function accountBalanceLine(
  ledger: AccountLedger,
  openingDate: LocalDate,
  asOf: LocalDate,
): AccountBalanceLine | null {
  assertLocalDate(asOf);
  if (openingDate > asOf) return null;
  return {
    accountId: ledger.accountId,
    balanceCents: balanceAsOf(ledger, asOf),
    adjustmentsCents: adjustmentsAsOf(ledger, asOf),
  };
}

/**
 * Flujo real (ingresos − gastos confirmados) de los meses de `from` a `to` que tienen movimientos
 * confirmados; es lo que sustituye al plan en la proyección de los meses pasados (docs/plan.md §3.13).
 *
 * - Cuenta lo mismo que {@link monthlyTotals}: solo movimientos **confirmados** y **sin** los ajustes de
 *   conciliación. Las transferencias no son movimientos, así que no entran; los pendientes tampoco.
 * - Un mes sin ningún ingreso ni gasto confirmado **no entra** en el mapa («no hay datos», que no es lo
 *   mismo que «el flujo fue 0»). Un mes cuyos confirmados suman 0 sí entra, con 0. Un mes que solo tiene un
 *   ajuste de conciliación tampoco entra: el ajuste no es un ingreso ni un gasto real.
 *
 * @throws {RangeError} si algún mes no es válido o un importe no es un entero seguro.
 */
export function realFlowByMonth(
  movements: readonly LedgerMovement[],
  from: YearMonth,
  to: YearMonth,
): Map<YearMonth, Cents> {
  const withData = new Set<YearMonth>();
  for (const movement of movements) {
    if (movement.status === 'confirmed' && movement.source !== 'reconciliation') {
      withData.add(movement.bookedOn.slice(0, 7));
    }
  }
  const flow = new Map<YearMonth, Cents>();
  for (const month of monthsBetween(from, to)) {
    if (withData.has(month)) flow.set(month, monthlyTotals(movements, `${month}-01`).netCents);
  }
  return flow;
}
