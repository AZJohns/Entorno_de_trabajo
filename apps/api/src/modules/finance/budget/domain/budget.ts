/**
 * Progreso de un presupuesto mensual por categoría (docs/plan.md §2.3b). Función pura sobre filas ya
 * leídas: lo gastado sale de {@link categoryBreakdown} (gastos **confirmados** del mes, sin los ajustes
 * de conciliación; las transferencias no son movimientos), así que presupuesto, informes y comparativa
 * del plan cuentan igual el gasto. Nada de esto se guarda.
 *
 * Unidades: céntimos enteros. `remainingCents` tiene signo: negativo si el gasto supera el presupuesto.
 */
import { assertCents, type Cents } from '@backoffice/shared';
import { assertLocalDate, type LocalDate } from '../../ledger/domain/dates.ts';
import {
  categoryBreakdown,
  sumCents,
  type CategorizedMovement,
} from '../../ledger/domain/reports.ts';

/** Presupuesto de una categoría en el mes que se está calculando. */
export interface BudgetEntry {
  readonly id: string;
  readonly categoryId: string;
  /** Límite del mes, en céntimos (> 0). */
  readonly amountCents: Cents;
}

/** Un presupuesto con lo gastado y lo que queda. */
export interface BudgetLine extends BudgetEntry {
  /** Gastos confirmados del mes en la categoría; 0 si no hay ninguno. */
  readonly spentCents: Cents;
  /** `amountCents − spentCents`. Negativo si te has pasado. */
  readonly remainingCents: Cents;
}

/** Gasto confirmado de una categoría que no tiene presupuesto ese mes. */
export interface UnbudgetedSpending {
  /** `null` si el gasto no tiene categoría. */
  readonly categoryId: string | null;
  readonly spentCents: Cents;
}

export interface BudgetProgress {
  /** En el mismo orden que `budgets`. */
  readonly lines: readonly BudgetLine[];
  /** De mayor a menor gasto (el orden de {@link categoryBreakdown}). */
  readonly unbudgeted: readonly UnbudgetedSpending[];
  readonly totals: {
    readonly budgetedCents: Cents;
    /** Gasto solo de las categorías con presupuesto. */
    readonly spentCents: Cents;
    readonly remainingCents: Cents;
    readonly unbudgetedSpentCents: Cents;
  };
}

/**
 * Calcula lo gastado y lo que queda de cada presupuesto de un mes.
 *
 * Un mes sin gastos da `spentCents = 0` y `remainingCents = amountCents`. Los gastos de una categoría
 * archivada cuentan igual. Los ingresos no entran nunca.
 *
 * @param budgets Presupuestos **de ese mes** (el llamante filtra por mes).
 * @param movements Movimientos de ese mes o de cualquier otro: solo cuentan los del mes de `month`.
 * @param month Cualquier día del mes (`YYYY-MM-DD`).
 * @throws {RangeError} si `month` no es una fecha válida.
 */
export function budgetProgress(
  budgets: readonly BudgetEntry[],
  movements: readonly CategorizedMovement[],
  month: LocalDate,
): BudgetProgress {
  assertLocalDate(month);
  const spentByCategory = new Map<string | null, Cents>();
  for (const total of categoryBreakdown(movements, month)) {
    if (total.kind === 'expense') spentByCategory.set(total.categoryId, total.totalCents);
  }

  const budgeted = new Set(budgets.map((budget) => budget.categoryId));
  const lines = budgets.map((budget): BudgetLine => {
    const spentCents = spentByCategory.get(budget.categoryId) ?? 0;
    return {
      ...budget,
      spentCents,
      remainingCents: assertCents(budget.amountCents - spentCents),
    };
  });
  const unbudgeted = [...spentByCategory]
    .filter(([categoryId]) => categoryId === null || !budgeted.has(categoryId))
    .map(([categoryId, spentCents]): UnbudgetedSpending => ({ categoryId, spentCents }));

  const budgetedCents = sumCents(lines.map((line) => line.amountCents));
  const spentCents = sumCents(lines.map((line) => line.spentCents));
  return {
    lines,
    unbudgeted,
    totals: {
      budgetedCents,
      spentCents,
      remainingCents: assertCents(budgetedCents - spentCents),
      unbudgetedSpentCents: sumCents(unbudgeted.map((entry) => entry.spentCents)),
    },
  };
}
