/**
 * Presupuesto del plan (docs/plantilla-excel.md §9.2): ingresos, gasto, margen, tasa de ahorro, gastos
 * esenciales y % de líneas confirmadas. Funciones puras; importes en céntimos enteros.
 *
 * Todo el plan base se filtra con el predicado único `includedInBase` (§9.1).
 */
import { assertCents, includedInBase, type Cents, type Status } from '@backoffice/shared';
import { amountOf, indexItems, itemById, type ItemIndex } from './items.ts';
import { ratio, type Ratio } from './ratio.ts';
import { sumCents } from './rounding.ts';
import type { PlanBudgetLine, PlanItem, PlanSnapshot } from './types.ts';

/** Una línea de Presupuesto con el importe y el estado de la fila de Datos que referencia. */
export interface ResolvedBudgetLine {
  readonly line: PlanBudgetLine;
  readonly item: PlanItem;
  /** Importe mensual (`€/mes`) de la fila referenciada. */
  readonly monthlyCents: Cents;
  readonly status: Status;
  /** `includedInBase(status)`: si la línea cuenta en el gasto base. */
  readonly included: boolean;
}

/** Una línea del resumen, para mostrarla: anual y % del ingreso solo se calculan para esto. */
export interface BudgetLineSummary {
  readonly lineId: string;
  readonly monthlyCents: Cents;
  readonly included: boolean;
  /** `12 × mensual`. */
  readonly annualCents: Cents;
  /** `mensual / I`; `null` si no hay ingresos. */
  readonly incomeShare: Ratio | null;
}

export interface BudgetSummary {
  /** Ingresos mensuales `I`: filas `income` en `€/mes` e incluidas. */
  readonly incomeCents: Cents;
  /** Gasto mensual `G`: filas referenciadas por las líneas de Presupuesto que están incluidas. */
  readonly expensesCents: Cents;
  /** Margen `M = I − G` (puede ser negativo). */
  readonly marginCents: Cents;
  /** Tasa de ahorro `M / I`; `null` («sin ingresos») si `I = 0`. */
  readonly savingsRate: Ratio | null;
  /** Gastos esenciales `E`: Σ de **todas** las líneas esenciales incluidas. */
  readonly essentialCents: Cents;
  /** Líneas incluidas en el plan base. */
  readonly includedLineCount: number;
  /** De ellas, las que tienen estado `confirmed`. */
  readonly confirmedLineCount: number;
  /** % de líneas confirmadas, por número de líneas; `null` si no hay ninguna incluida. */
  readonly confirmedShare: Ratio | null;
  /** Todas las líneas (también las excluidas, marcadas), en el orden de entrada. */
  readonly lines: readonly BudgetLineSummary[];
}

/**
 * Lee de Datos el importe y el estado de cada línea de Presupuesto, en el orden de entrada.
 *
 * @throws {RangeError} si una línea apunta a una fila inexistente o sin importe.
 */
export function resolveBudgetLines(
  budgetLines: readonly PlanBudgetLine[],
  items: ItemIndex,
): ResolvedBudgetLine[] {
  return budgetLines.map((line) => {
    const item = itemById(items, line.planItemId, `Línea de Presupuesto «${line.concept}»`);
    return {
      line,
      item,
      monthlyCents: amountOf(item, `Línea de Presupuesto «${line.concept}»`),
      status: item.status,
      included: includedInBase(item.status),
    };
  });
}

/**
 * Ingresos mensuales `I`: Σ de las filas `income` con la unidad `€/mes` que cuentan en el plan base.
 */
export function monthlyIncome(items: readonly PlanItem[]): Cents {
  return sumCents(
    items
      .filter(
        (item) =>
          item.recordType === 'income' &&
          item.unit === 'eur_per_month' &&
          includedInBase(item.status),
      )
      .map((item) => amountOf(item, 'Ingreso')),
  );
}

/**
 * Resumen del presupuesto (§9.2).
 *
 * - `G` suma exactamente las líneas que `includedInBase` deja pasar: el mismo predicado que usan las
 *   comprobaciones, así que el total y el check no pueden contradecirse.
 * - `E` suma **todas** las líneas esenciales incluidas (la plantilla deja fuera la última por un error de
 *   rango; la app no).
 * - Con `I = 0`, la tasa de ahorro y los % del ingreso son `null`.
 *
 * @throws {RangeError} si la foto es incoherente (referencias que no existen) o una suma desborda.
 */
export function summarizeBudget(snapshot: PlanSnapshot): BudgetSummary {
  const items = indexItems(snapshot.items);
  const resolved = resolveBudgetLines(snapshot.budgetLines, items);
  const included = resolved.filter((entry) => entry.included);

  const incomeCents = monthlyIncome(snapshot.items);
  const expensesCents = sumCents(included.map((entry) => entry.monthlyCents));
  const marginCents = assertCents(incomeCents - expensesCents);
  const confirmedLineCount = included.filter((entry) => entry.status === 'confirmed').length;

  return {
    incomeCents,
    expensesCents,
    marginCents,
    savingsRate: ratio(marginCents, incomeCents),
    essentialCents: sumCents(
      included.filter((entry) => entry.line.essential).map((entry) => entry.monthlyCents),
    ),
    includedLineCount: included.length,
    confirmedLineCount,
    confirmedShare: ratio(confirmedLineCount, included.length),
    lines: resolved.map((entry) => ({
      lineId: entry.line.id,
      monthlyCents: entry.monthlyCents,
      included: entry.included,
      annualCents: assertCents(12 * entry.monthlyCents),
      incomeShare: ratio(entry.monthlyCents, incomeCents),
    })),
  };
}
