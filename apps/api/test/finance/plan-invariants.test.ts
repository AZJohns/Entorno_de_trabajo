/**
 * Invariantes de los cálculos del plan (docs/plantilla-excel.md §9.6, filas «Invariante»): son tests, no
 * comprobaciones en ejecución. Se comprueban sobre 400 fotos ficticias generadas con una semilla fija
 * (reproducibles), con importes, estados, eventos, metas y escenarios al azar, y con meses pasados.
 */
import { includedInBase, STATUSES, type Status } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import { calculatePlan } from '../../src/modules/finance/plan/domain/index.ts';
import { addMonths } from '../../src/modules/finance/plan/domain/months.ts';
import type {
  PlanItem,
  PlanSnapshot,
  ScenarioRole,
} from '../../src/modules/finance/plan/domain/types.ts';
import {
  event,
  expense,
  fixedGoal,
  income,
  line,
  MONTH_1,
  savings,
  snapshot,
} from './plan-builders.ts';

/** Generador pseudoaleatorio con semilla (mulberry32): el mismo número siempre da la misma secuencia. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_STATUSES = STATUSES.map((entry) => entry.code);

function generate(seed: number): {
  plan: PlanSnapshot;
  currentMonth: string;
  real: Map<string, number>;
} {
  const next = random(seed);
  const int = (max: number): number => Math.floor(next() * (max + 1));
  const pick = <T>(list: readonly T[]): T => list[int(list.length - 1)] as T;
  const status = (): Status => pick(ALL_STATUSES);

  const items: PlanItem[] = [];
  for (let i = 0; i < int(3); i += 1) items.push(income(`inc${String(i)}`, int(300_000), status()));
  const expenses: PlanItem[] = [];
  for (let i = 0; i < int(8); i += 1)
    expenses.push(expense(`exp${String(i)}`, int(100_000), status()));
  for (let i = 0; i < int(3); i += 1)
    items.push(savings(`sav${String(i)}`, int(1_000_000), status()));
  items.push(...expenses);

  const budgetLines = expenses
    .filter(() => next() < 0.8)
    .map((entry) => line(`l-${entry.id}`, entry.id, next() < 0.5));

  const events = Array.from({ length: int(6) }, (_, i) => {
    const included = next() < 0.8;
    const offset = int(16) - 2; // de 2 meses antes a 14 después del mes 1
    const day = String(int(27) + 1).padStart(2, '0');
    return event(`ev${String(i)}`, {
      amountCents: int(200_000),
      expectedDate: included || next() < 0.5 ? `${addMonths(MONTH_1, offset)}-${day}` : null,
      includeInProjection: included,
    });
  });

  const goals = Array.from({ length: int(4) }, (_, i) =>
    fixedGoal(`g${String(i)}`, int(500_000), int(500_000), int(50_000)),
  );

  const scenarios = Array.from({ length: int(3) }, (_, i) => ({
    id: `sc${String(i)}`,
    name: `Escenario ${String(i)}`,
    items: expenses
      .filter(() => next() < 0.4)
      .map((entry) => ({
        planItemId: entry.id,
        role: pick<ScenarioRole>(['extra_monthly', 'one_off']),
      })),
  }));

  const currentMonth = addMonths(MONTH_1, int(14) - 1);
  const real = new Map<string, number>();
  for (let k = 0; k < 12; k += 1) {
    if (next() < 0.5) real.set(addMonths(MONTH_1, k), int(400_000) - 200_000);
  }
  return {
    plan: snapshot({ items, budgetLines, events, goals, scenarios }),
    currentMonth,
    real,
  };
}

describe('invariantes sobre 400 fotos generadas', () => {
  it('M = I − G; G = Σ líneas incluidas; inicial_1 = S0; final_k = inicial_k + flujo_k; inicial_{k+1} = final_k', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const { plan, currentMonth, real } = generate(seed);
      const { budget, projection, goals, scenarios, checks } = calculatePlan(plan, {
        currentMonth,
        realFlowByMonth: real,
      });
      const where = `semilla ${String(seed)}`;
      const byId = new Map(plan.items.map((entry) => [entry.id, entry]));

      // §9.2: M = I − G, y G = Σ de las líneas incluidas (calculado aparte, con el predicado compartido).
      expect(budget.marginCents, where).toBe(budget.incomeCents - budget.expensesCents);
      const expectedExpenses = plan.budgetLines
        .map((entry) => byId.get(entry.planItemId))
        .filter((entry): entry is PlanItem => entry !== undefined && includedInBase(entry.status))
        .reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0);
      expect(budget.expensesCents, where).toBe(expectedExpenses);
      const expectedIncome = plan.items
        .filter((entry) => entry.recordType === 'income' && includedInBase(entry.status))
        .reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0);
      expect(budget.incomeCents, where).toBe(expectedIncome);

      // §9.3: saldo inicial = Σ ahorro incluido y roll-forward.
      const savingsTotal = plan.items
        .filter((entry) => entry.recordType === 'savings_balance' && includedInBase(entry.status))
        .reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0);
      expect(projection).toHaveLength(12);
      expect(projection[0]?.openingCents, where).toBe(savingsTotal);
      projection.forEach((row, index) => {
        expect(row.closingCents, `${where}, mes ${String(row.index)}`).toBe(
          row.openingCents + row.flowCents,
        );
        const following = projection[index + 1];
        if (following !== undefined) expect(following.openingCents, where).toBe(row.closingCents);
        expect(row.month, where).toBe(addMonths(MONTH_1, index));
        // El flujo del plan es I − G − P_k; el de un mes pasado con datos, el real.
        if (row.source === 'plan') {
          expect(row.flowCents, where).toBe(budget.marginCents - row.eventsCents);
        } else {
          expect(row.flowCents, where).toBe(real.get(row.month));
          expect(row.month < currentMonth, where).toBe(true);
        }
        expect(row.warning !== null, where).toBe(row.source === 'plan' && row.month < currentMonth);
      });

      // Σ P_k = Σ eventos incluidos con fecha dentro de los 12 meses (calculado por separado).
      const horizon = new Set(projection.map((row) => row.month));
      const expectedEvents = plan.events
        .filter(
          (entry) =>
            entry.includeInProjection &&
            entry.expectedDate !== null &&
            horizon.has(entry.expectedDate.slice(0, 7)),
        )
        .reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0);
      expect(
        projection.reduce((sum, row) => sum + row.eventsCents, 0),
        where,
      ).toBe(expectedEvents);

      // §9.4: la prueba de capacidad es Σ aportaciones en curso ≤ M.
      const inProgress = goals.goals
        .filter((goal) => goal.status === 'in_progress')
        .reduce((sum, goal) => sum + goal.contributionCents, 0);
      expect(goals.capacity.ok, where).toBe(inProgress <= budget.marginCents);
      for (const goal of goals.goals) {
        expect(goal.remainingCents, where).toBeGreaterThanOrEqual(0);
        expect(goal.remainingCents, where).toBe(Math.max(goal.targetCents - goal.currentCents, 0));
        expect(goal.monthsToGoal === null, where).toBe(
          goal.remainingCents > 0 && goal.contributionCents <= 0,
        );
      }

      // §9.5: salida total y caja libre.
      for (const result of scenarios) {
        expect(result.totalOutflowCents, where).toBe(
          budget.expensesCents + result.extraCents + result.oneOffCents,
        );
        expect(result.freeCashCents, where).toBe(budget.incomeCents - result.totalOutflowCents);
        expect(result.freeRate === null, where).toBe(budget.incomeCents === 0);
      }

      // §9.6: el estado global sale de las comprobaciones.
      const failed = checks.checks.filter((entry) => !entry.passed);
      const expected = failed.some((entry) => entry.severity === 'FAIL')
        ? 'FAIL'
        : failed.length > 0
          ? 'PASS_WITH_WARNINGS'
          : 'PASS';
      expect(checks.overall, where).toBe(expected);
      expect(checks.checks.find((entry) => entry.code === 'NEGATIVE_MARGIN')?.passed, where).toBe(
        budget.marginCents >= 0,
      );
    }
  });

  it('el generador cubre los casos que importan (no es un test vacío)', () => {
    let negativeMargin = 0;
    let zeroIncome = 0;
    let realRows = 0;
    let warnings = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const { plan, currentMonth, real } = generate(seed);
      const { budget, projection } = calculatePlan(plan, { currentMonth, realFlowByMonth: real });
      if (budget.marginCents < 0) negativeMargin += 1;
      if (budget.incomeCents === 0) zeroIncome += 1;
      realRows += projection.filter((row) => row.source === 'real').length;
      warnings += projection.filter((row) => row.warning !== null).length;
    }
    expect(negativeMargin).toBeGreaterThan(20);
    expect(zeroIncome).toBeGreaterThan(5);
    expect(realRows).toBeGreaterThan(100);
    expect(warnings).toBeGreaterThan(100);
  });
});
