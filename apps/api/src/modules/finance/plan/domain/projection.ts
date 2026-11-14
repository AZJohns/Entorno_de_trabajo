/**
 * Proyección de caja a 12 meses (docs/plantilla-excel.md §9.3). Función pura; importes en céntimos enteros.
 *
 * - Mes 1 = el mes de la foto.
 * - `S0` = Σ filas `savings_balance` incluidas (se admiten varias).
 * - `P_k` = Σ importes de los eventos con `includeInProjection` cuya fecha cae en el mes `k`. **Una sola
 *   pasada recorre todos los eventos** y los reparte por mes: no hay rangos por mes, así que un evento nuevo
 *   se proyecta siempre (regresión del error de rangos de la plantilla, §10).
 * - `flujo_k = I − G − P_k`; `inicial_1 = S0`; `final_k = inicial_k + flujo_k`; `inicial_{k+1} = final_k`.
 * - Las aportaciones a metas **no restan caja**, igual que en la plantilla.
 * - Meses pasados (anteriores al mes natural en curso): con flujo real del libro, la fila muestra ese flujo
 *   (`source = 'real'`); sin él, usa el plan con el aviso `NO_REAL_DATA`. El roll-forward sigue con el valor
 *   mostrado.
 */
import { assertCents, includedInBase, type Cents } from '@backoffice/shared';
import { assertYearMonth, type YearMonth } from '../../ledger/domain/dates.ts';
import type { BudgetSummary } from './budget.ts';
import { amountOf, hundredthsOf, indexItems, itemById, type ItemIndex } from './items.ts';
import { addMonths, HORIZON_MONTHS, projectionMonthOf } from './months.ts';
import { ratio, type Ratio } from './ratio.ts';
import { centsTimesMonths, sumCents } from './rounding.ts';
import type { PlanEvent, PlanItem, PlanSnapshot } from './types.ts';

export type ProjectionSource = 'plan' | 'real';

/** Aviso de una fila de la proyección. */
export type ProjectionWarning = 'NO_REAL_DATA';

export interface ProjectionRow {
  /** 1 a 12. */
  readonly index: number;
  readonly month: YearMonth;
  /** `P_k`: eventos incluidos que caen en este mes. */
  readonly eventsCents: Cents;
  /** Flujo mostrado: el del plan (`I − G − P_k`) o, en un mes pasado con datos, el real. */
  readonly flowCents: Cents;
  readonly openingCents: Cents;
  readonly closingCents: Cents;
  /** `flujo / I`; `null` si `I = 0`. */
  readonly flowRate: Ratio | null;
  readonly source: ProjectionSource;
  readonly warning: ProjectionWarning | null;
}

export interface ProjectionOptions {
  /** Mes natural en curso (`YYYY-MM`, en Europe/Madrid). Lo decide quien llama: la función no lee el reloj. */
  readonly currentMonth: YearMonth;
  /**
   * Flujo real (ingresos − gastos confirmados, en céntimos) de los meses que lo tienen. Un mes ausente en
   * el mapa es un mes sin movimientos confirmados. Solo se usa en los meses anteriores a `currentMonth`.
   */
  readonly realFlowByMonth?: ReadonlyMap<YearMonth, Cents>;
}

/**
 * Importe de un evento (§6.3): literal; referencia (`€` o `€/mes`, en ambos casos **un único pago**); o
 * cuota × plazo con redondeo half-up al céntimo.
 *
 * @throws {RangeError} si el evento no tiene importe, o referencia una fila inexistente o sin el tipo de importe.
 */
export function eventAmountCents(event: PlanEvent, items: ItemIndex): Cents {
  const what = `Evento «${event.concept}»`;
  if (event.amountItemId !== null) {
    if (event.amountCents !== null)
      throw new RangeError(`${what}: tiene importe literal y referencia`);
    const amount = amountOf(itemById(items, event.amountItemId, what), what);
    if (event.multiplierItemId === null) return amount;
    const months = hundredthsOf(itemById(items, event.multiplierItemId, what), what);
    return centsTimesMonths(amount, months);
  }
  if (event.multiplierItemId !== null)
    throw new RangeError(`${what}: tiene plazo y no tiene cuota`);
  if (event.amountCents === null) throw new RangeError(`${what}: no tiene importe`);
  return assertCents(event.amountCents);
}

/** `S0`: Σ de las filas `savings_balance` que cuentan en el plan base. */
export function openingBalance(items: readonly PlanItem[]): Cents {
  return sumCents(
    items
      .filter((item) => item.recordType === 'savings_balance' && includedInBase(item.status))
      .map((item) => amountOf(item, 'Saldo de ahorro')),
  );
}

/**
 * Reparte los eventos incluidos en la proyección por mes: `P_k` para `k = 1..12` (índice `k − 1`).
 * Un evento sin fecha o con fecha fuera de los 12 meses no suma en ninguno.
 *
 * @throws {RangeError} si un evento incluido no tiene fecha (la base de datos lo impide).
 */
export function eventsByMonth(snapshot: PlanSnapshot, items: ItemIndex): Cents[] {
  const totals: Cents[] = Array.from({ length: HORIZON_MONTHS }, () => 0);
  for (const event of snapshot.events) {
    if (!event.includeInProjection) continue;
    if (event.expectedDate === null) {
      throw new RangeError(
        `Evento «${event.concept}»: está incluido en la proyección y no tiene fecha`,
      );
    }
    const index = projectionMonthOf(snapshot.month, event.expectedDate);
    if (index === null) continue;
    totals[index - 1] = assertCents((totals[index - 1] ?? 0) + eventAmountCents(event, items));
  }
  return totals;
}

/**
 * Proyección de caja de los 12 meses desde el mes de la foto.
 *
 * @param budget Resumen del presupuesto de la misma foto (`I` y `G`).
 * @throws {RangeError} si la foto es incoherente o un importe desborda.
 */
export function projectCash(
  snapshot: PlanSnapshot,
  budget: Pick<BudgetSummary, 'incomeCents' | 'expensesCents'>,
  options: ProjectionOptions,
): ProjectionRow[] {
  assertYearMonth(options.currentMonth);
  const items = indexItems(snapshot.items);
  const events = eventsByMonth(snapshot, items);
  const planBase = assertCents(budget.incomeCents - budget.expensesCents);

  const rows: ProjectionRow[] = [];
  let opening = openingBalance(snapshot.items);
  for (let index = 1; index <= HORIZON_MONTHS; index += 1) {
    const month = addMonths(snapshot.month, index - 1);
    const eventsCents = events[index - 1] ?? 0;
    const isPast = month < options.currentMonth;
    const real = isPast ? options.realFlowByMonth?.get(month) : undefined;

    const flowCents = real === undefined ? assertCents(planBase - eventsCents) : assertCents(real);
    const closingCents = assertCents(opening + flowCents);
    rows.push({
      index,
      month,
      eventsCents,
      flowCents,
      openingCents: opening,
      closingCents,
      flowRate: ratio(flowCents, budget.incomeCents),
      source: real === undefined ? 'plan' : 'real',
      warning: isPast && real === undefined ? 'NO_REAL_DATA' : null,
    });
    opening = closingCents;
  }
  return rows;
}
