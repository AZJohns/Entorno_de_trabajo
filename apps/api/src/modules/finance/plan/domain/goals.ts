/**
 * Metas (docs/plantilla-excel.md §9.4): objetivo, pendiente, meses hasta cumplirla, estado calculado y la
 * prueba de capacidad. Funciones puras; importes en céntimos enteros.
 *
 * Una meta lee los importes de las filas que referencia **tal cual están**: §9.4 no aplica
 * `includedInBase` a esas filas (la meta apunta a ellas a propósito, p. ej. un saldo de ahorro).
 */
import { assertCents, type Cents, type GoalKind } from '@backoffice/shared';
import { amountOf, hundredthsOf, indexItems, itemById, type ItemIndex } from './items.ts';
import { ceilDiv, centsTimesMonths, sumCents } from './rounding.ts';
import type { PlanGoal, PlanItem, PlanSnapshot } from './types.ts';

/** Estado calculado de una meta (la plantilla lo calcula; la app también, no se guarda). */
export type GoalStatus = 'completed' | 'paused' | 'in_progress';

export interface GoalResult {
  readonly goalId: string;
  readonly name: string;
  readonly kind: GoalKind;
  readonly targetCents: Cents;
  readonly currentCents: Cents;
  /** `max(objetivo − actual, 0)`. */
  readonly remainingCents: Cents;
  readonly contributionCents: Cents;
  /** Meses hasta cumplirla: 0 si no falta nada; `null` («sin aportación») si la aportación es ≤ 0. */
  readonly monthsToGoal: number | null;
  readonly status: GoalStatus;
}

/** Prueba de capacidad: las aportaciones de las metas en curso caben en el margen. */
export interface CapacityTest {
  /** Σ aportaciones de las metas `in_progress`. */
  readonly contributionsCents: Cents;
  readonly marginCents: Cents;
  /** `margen − aportaciones` (negativo si no caben). */
  readonly unallocatedCents: Cents;
  /** `aportaciones ≤ margen`. */
  readonly ok: boolean;
}

export interface GoalsSummary {
  readonly goals: readonly GoalResult[];
  readonly capacity: CapacityTest;
}

/** Importe de una meta: una referencia a una fila de Datos o un literal, exactamente uno de los dos. */
function goalAmount(
  items: ItemIndex,
  itemId: string | null,
  cents: Cents | null,
  what: string,
): Cents {
  if (itemId !== null && cents === null) return amountOf(itemById(items, itemId, what), what);
  if (itemId === null && cents !== null) return assertCents(cents);
  throw new RangeError(`${what}: tiene que ser una referencia o un literal, y no las dos cosas`);
}

/** La fila «Meses de fondo de emergencia» (como mucho una, por un índice único). */
function emergencyMonths(items: readonly PlanItem[]): number {
  const rows = items.filter((item) => item.recordType === 'emergency_fund_months');
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new RangeError(
      `Fondo de emergencia: tiene que haber exactamente una fila de meses de fondo de emergencia (hay ${String(rows.length)})`,
    );
  }
  return hundredthsOf(row, 'Fondo de emergencia');
}

/** Estado de una meta (§9.4): completada, pausada o en curso. */
export function goalStatus(remainingCents: Cents, contributionCents: Cents): GoalStatus {
  if (remainingCents === 0) return 'completed';
  return contributionCents <= 0 ? 'paused' : 'in_progress';
}

/**
 * Evalúa las metas de la foto.
 *
 * - `fixed_amount`: objetivo = el de la meta (referencia o literal).
 * - `emergency_fund`: objetivo = `round_half_up(E × meses_centésimas / 100)`.
 *
 * @param budget `E` (gastos esenciales) y `M` (margen) del resumen del presupuesto de la misma foto.
 * @throws {RangeError} si la foto es incoherente (referencia inexistente, sin importe, sin fila de meses).
 */
export function evaluateGoals(
  snapshot: PlanSnapshot,
  budget: { readonly essentialCents: Cents; readonly marginCents: Cents },
): GoalsSummary {
  const items = indexItems(snapshot.items);
  const goals = snapshot.goals.map((goal) => evaluateGoal(goal, snapshot.items, items, budget));

  const contributionsCents = sumCents(
    goals.filter((goal) => goal.status === 'in_progress').map((goal) => goal.contributionCents),
  );
  return {
    goals,
    capacity: {
      contributionsCents,
      marginCents: budget.marginCents,
      unallocatedCents: assertCents(budget.marginCents - contributionsCents),
      ok: contributionsCents <= budget.marginCents,
    },
  };
}

function evaluateGoal(
  goal: PlanGoal,
  rawItems: readonly PlanItem[],
  items: ItemIndex,
  budget: { readonly essentialCents: Cents },
): GoalResult {
  const what = `Meta «${goal.name}»`;
  const targetCents =
    goal.goalKind === 'emergency_fund'
      ? centsTimesMonths(budget.essentialCents, emergencyMonths(rawItems))
      : goalAmount(items, goal.targetItemId, goal.targetCents, `${what} (objetivo)`);
  const currentCents = goalAmount(items, goal.currentItemId, goal.currentCents, `${what} (actual)`);
  const contributionCents = goalAmount(
    items,
    goal.contributionItemId,
    goal.contributionCents,
    `${what} (aportación)`,
  );

  const remainingCents = targetCents > currentCents ? assertCents(targetCents - currentCents) : 0;
  let monthsToGoal: number | null = null;
  if (remainingCents === 0) monthsToGoal = 0;
  else if (contributionCents > 0) monthsToGoal = ceilDiv(remainingCents, contributionCents);

  return {
    goalId: goal.id,
    name: goal.name,
    kind: goal.goalKind,
    targetCents,
    currentCents,
    remainingCents,
    contributionCents,
    monthsToGoal,
    status: goalStatus(remainingCents, contributionCents),
  };
}
