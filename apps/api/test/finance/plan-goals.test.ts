/**
 * Metas (`evaluateGoals`, §9.4). Tests de tabla con casos límite; importes FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import { evaluateGoals, goalStatus } from '../../src/modules/finance/plan/domain/goals.ts';
import type { PlanGoal } from '../../src/modules/finance/plan/domain/types.ts';
import { emergencyMonths, fixedGoal, fundGoal, item, snapshot } from './plan-builders.ts';

const NO_BUDGET = { essentialCents: 0, marginCents: 1_000_000 };

function evaluateOne(goal: PlanGoal, budget = NO_BUDGET, extra: ReturnType<typeof item>[] = []) {
  const summary = evaluateGoals(snapshot({ goals: [goal], items: extra }), budget);
  const [result] = summary.goals;
  if (result === undefined) throw new Error('inalcanzable');
  return { result, capacity: summary.capacity };
}

describe('goalStatus', () => {
  it.each([
    [0, 0, 'completed'],
    [0, 5_000, 'completed'],
    [100, 0, 'paused'],
    [100, 1, 'in_progress'],
  ] as const)('pendiente %i, aportación %i → %s', (remaining, contribution, expected) => {
    expect(goalStatus(remaining, contribution)).toBe(expected);
  });
});

describe('evaluateGoals: fixed_amount', () => {
  it.each([
    // [objetivo, actual, aportación, pendiente, meses, estado]
    [300_000, 100_000, 15_000, 200_000, 14, 'in_progress'], // 13,33 → 14
    [300_000, 100_000, 20_000, 200_000, 10, 'in_progress'], // exacto: 10
    [300_000, 100_000, 199_999, 200_000, 2, 'in_progress'], // 1,000005 → 2
    [300_000, 100_000, 200_000, 200_000, 1, 'in_progress'], // exacto: 1
    [50_000, 50_000, 0, 0, 0, 'completed'], // completada, sin aportación
    [50_000, 70_000, 5_000, 0, 0, 'completed'], // actual > objetivo: el pendiente no es negativo
    [200_000, 30_000, 0, 170_000, null, 'paused'], // sin aportación: meses null
    [1, 0, 1, 1, 1, 'in_progress'],
  ] as const)(
    'objetivo %i, actual %i, aportación %i → pendiente %i, meses %s, %s',
    (target, current, contribution, remaining, months, status) => {
      const { result } = evaluateOne(fixedGoal('g', target, current, contribution));
      expect(result).toMatchObject({
        targetCents: target,
        currentCents: current,
        remainingCents: remaining,
        contributionCents: contribution,
        monthsToGoal: months,
        status,
        kind: 'fixed_amount',
      });
    },
  );

  it('lee objetivo, actual y aportación de las filas de Datos cuando son referencias', () => {
    const { result } = evaluateOne(
      {
        ...fixedGoal('g', 0, 0, 0),
        targetItemId: 't',
        targetCents: null,
        currentItemId: 'c',
        currentCents: null,
        contributionItemId: 'k',
        contributionCents: null,
      },
      NO_BUDGET,
      [
        item('t', 'goal', 'eur', 300_000),
        item('c', 'savings_balance', 'eur', 100_000),
        item('k', 'goal', 'eur_per_month', 15_000, 'pending'),
      ],
    );
    expect(result).toMatchObject({
      remainingCents: 200_000,
      monthsToGoal: 14,
      status: 'in_progress',
    });
  });

  it('no aplica includedInBase a las filas que referencia (§9.4 no lo menciona)', () => {
    const { result } = evaluateOne(
      { ...fixedGoal('g', 100_000, 0, 0), currentItemId: 'c', currentCents: null },
      NO_BUDGET,
      [item('c', 'savings_balance', 'eur', 40_000, 'inactive')],
    );
    expect(result.currentCents).toBe(40_000);
  });

  it.each([
    ['ni referencia ni literal', { ...fixedGoal('g', 1, 0, 0), targetCents: null }],
    ['referencia y literal', { ...fixedGoal('g', 1, 0, 0), targetItemId: 't' }],
    [
      'referencia inexistente',
      { ...fixedGoal('g', 1, 0, 0), currentItemId: 'nope', currentCents: null },
    ],
  ])('es incoherente: %s', (_name, goal) => {
    expect(() => evaluateGoals(snapshot({ goals: [goal] }), NO_BUDGET)).toThrow(RangeError);
  });
});

describe('evaluateGoals: fondo de emergencia', () => {
  const fund = (hundredths: number) => [emergencyMonths('months', hundredths)];

  it.each([
    // [E, centésimas, objetivo esperado]
    [133_000, 600, 798_000], // 6 meses
    [133_000, 650, 864_500], // 6,5 meses, exacto
    [133_001, 650, 864_507], // 864 506,5 → half-up sube
    [133_001, 600, 798_006], // 6 × 133 001
    [1, 50, 1], // 0,5 céntimos → 1
    [1, 49, 0], // 0,49 → 0
    [0, 600, 0], // sin gastos esenciales
  ])('E = %i y %i centésimas de mes → objetivo %i', (essential, hundredths, expected) => {
    const { result } = evaluateOne(
      fundGoal('f', 0, 10_000),
      { essentialCents: essential, marginCents: 1_000_000 },
      fund(hundredths),
    );
    expect(result.targetCents).toBe(expected);
    expect(result.kind).toBe('emergency_fund');
  });

  it('pendiente, meses y estado con el objetivo calculado', () => {
    const { result } = evaluateOne(
      fundGoal('f', 500_000, 20_000),
      { essentialCents: 133_000, marginCents: 137_500 },
      fund(600),
    );
    expect(result).toMatchObject({
      targetCents: 798_000,
      remainingCents: 298_000,
      monthsToGoal: 15, // 14,9 → 15
      status: 'in_progress',
    });
  });

  it('un objetivo 0 (E = 0) deja la meta completada', () => {
    const { result } = evaluateOne(
      fundGoal('f', 0, 5_000),
      { essentialCents: 0, marginCents: 0 },
      fund(600),
    );
    expect(result).toMatchObject({ remainingCents: 0, monthsToGoal: 0, status: 'completed' });
  });

  it('sin fila de meses, o con dos, es incoherente', () => {
    expect(() => evaluateGoals(snapshot({ goals: [fundGoal('f', 0, 0)] }), NO_BUDGET)).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateGoals(
        snapshot({
          goals: [fundGoal('f', 0, 0)],
          items: [emergencyMonths('m1', 600), emergencyMonths('m2', 300)],
        }),
        NO_BUDGET,
      ),
    ).toThrow(RangeError);
  });
});

describe('evaluateGoals: prueba de capacidad', () => {
  const goals = [
    fixedGoal('a', 100_000, 0, 15_000), // en curso
    fixedGoal('b', 100_000, 0, 20_000), // en curso
    fixedGoal('c', 100_000, 100_000, 90_000), // completada: su aportación NO cuenta
    fixedGoal('d', 100_000, 0, 0), // pausada
  ];

  it.each([
    [137_500, true, 102_500],
    [35_000, true, 0], // justo: Σ = margen cumple
    [34_999, false, -1],
    [0, false, -35_000],
    [-10_000, false, -45_000],
  ])('margen %i → ok %s, sin asignar %i', (margin, ok, unallocated) => {
    const { capacity } = {
      capacity: evaluateGoals(snapshot({ goals }), { essentialCents: 0, marginCents: margin })
        .capacity,
    };
    expect(capacity).toEqual({
      contributionsCents: 35_000,
      marginCents: margin,
      unallocatedCents: unallocated,
      ok,
    });
  });

  it('sin metas, Σ = 0 y cumple si el margen no es negativo', () => {
    expect(evaluateGoals(snapshot(), { essentialCents: 0, marginCents: 0 }).capacity.ok).toBe(true);
    expect(evaluateGoals(snapshot(), { essentialCents: 0, marginCents: -1 }).capacity.ok).toBe(
      false,
    );
  });
});
