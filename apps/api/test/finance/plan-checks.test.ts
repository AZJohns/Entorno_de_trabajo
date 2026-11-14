/**
 * Comprobaciones del plan (`runChecks`, `overallStatus`, §9.6). Tests de tabla; importes FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import {
  overallStatus,
  type CheckCode,
  type CheckResult,
} from '../../src/modules/finance/plan/domain/checks.ts';
import { calculatePlan } from '../../src/modules/finance/plan/domain/index.ts';
import type { PlanSnapshot } from '../../src/modules/finance/plan/domain/types.ts';
import {
  event,
  expense,
  fixedGoal,
  income,
  item,
  line,
  MONTH_1,
  savings,
  scenario,
  snapshot,
} from './plan-builders.ts';

/** Un plan sano: I = 100 000, G = 40 000, esencial confirmado, sin eventos ni metas. */
function healthy(parts: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return snapshot({
    items: [income('sal', 100_000), expense('rent', 40_000), savings('s', 500_000)],
    budgetLines: [line('l-rent', 'rent', true)],
    ...parts,
  });
}

function run(plan: PlanSnapshot) {
  return calculatePlan(plan, { currentMonth: MONTH_1 }).checks;
}

function result(plan: PlanSnapshot, code: CheckCode): CheckResult {
  const found = run(plan).checks.find((entry) => entry.code === code);
  if (found === undefined) throw new Error(`Falta la comprobación ${code}`);
  return found;
}

describe('runChecks', () => {
  it('un plan sano pasa todas las comprobaciones: PASS', () => {
    const { checks, overall } = run(healthy());
    expect(checks.map((entry) => entry.code)).toEqual([
      'CONTRIBUTIONS_EXCEED_MARGIN',
      'NEGATIVE_MARGIN',
      'ESSENTIAL_NOT_CONFIRMED',
      'NEGATIVE_FINAL_BALANCE',
      'EXPENSE_NOT_BUDGETED',
      'SCENARIO_ITEM_ALREADY_IN_BASE',
      'EVENT_ITEM_ALREADY_IN_BASE',
    ]);
    expect(checks.every((entry) => entry.passed && entry.subjects.length === 0)).toBe(true);
    expect(overall).toBe('PASS');
  });

  it('las severidades son las de §9.6', () => {
    expect(
      Object.fromEntries(run(healthy()).checks.map((entry) => [entry.code, entry.severity])),
    ).toEqual({
      CONTRIBUTIONS_EXCEED_MARGIN: 'FAIL',
      NEGATIVE_MARGIN: 'FAIL',
      ESSENTIAL_NOT_CONFIRMED: 'WARN',
      NEGATIVE_FINAL_BALANCE: 'WARN',
      EXPENSE_NOT_BUDGETED: 'WARN',
      SCENARIO_ITEM_ALREADY_IN_BASE: 'WARN',
      EVENT_ITEM_ALREADY_IN_BASE: 'WARN',
    });
  });

  describe('aportaciones ≤ margen y margen negativo (FAIL)', () => {
    it('aportaciones mayores que el margen: FAIL aunque el margen sea positivo', () => {
      const plan = healthy({ goals: [fixedGoal('g', 1_000_000, 0, 60_001)] }); // margen 60 000
      expect(result(plan, 'CONTRIBUTIONS_EXCEED_MARGIN').passed).toBe(false);
      expect(result(plan, 'NEGATIVE_MARGIN').passed).toBe(true);
      expect(run(plan).overall).toBe('FAIL');
    });

    it('aportaciones iguales al margen: cumple', () => {
      const plan = healthy({ goals: [fixedGoal('g', 1_000_000, 0, 60_000)] });
      expect(result(plan, 'CONTRIBUTIONS_EXCEED_MARGIN').passed).toBe(true);
      expect(run(plan).overall).toBe('PASS');
    });

    it('las metas completadas o pausadas no cuentan', () => {
      const plan = healthy({
        goals: [fixedGoal('done', 100, 100, 999_999), fixedGoal('paused', 1_000, 0, 0)],
      });
      expect(result(plan, 'CONTRIBUTIONS_EXCEED_MARGIN').passed).toBe(true);
    });

    it('margen negativo: FAIL, y salta también aportaciones ≤ margen (0 ≤ M es falso)', () => {
      const plan = healthy({ items: [income('sal', 30_000), expense('rent', 40_000)] });
      expect(result(plan, 'NEGATIVE_MARGIN').passed).toBe(false);
      expect(result(plan, 'CONTRIBUTIONS_EXCEED_MARGIN').passed).toBe(false);
      expect(run(plan).overall).toBe('FAIL');
    });

    it('margen 0: ni negativo ni falla la capacidad sin metas', () => {
      const plan = healthy({ items: [income('sal', 40_000), expense('rent', 40_000)] });
      expect(result(plan, 'NEGATIVE_MARGIN').passed).toBe(true);
      expect(result(plan, 'CONTRIBUTIONS_EXCEED_MARGIN').passed).toBe(true);
    });
  });

  describe('esenciales no confirmadas (WARN)', () => {
    const lines = healthy({
      items: [
        income('sal', 500_000),
        expense('a', 1_000, 'confirmed'),
        expense('b', 1_000, 'estimated'),
        expense('c', 1_000, 'to_confirm'),
        expense('d', 1_000, 'paused'), // esencial, pero fuera del plan base
        expense('e', 1_000, 'pending'), // no esencial
      ],
      budgetLines: [
        line('la', 'a', true),
        line('lb', 'b', true),
        line('lc', 'c', true),
        line('ld', 'd', true),
        line('le', 'e', false),
      ],
    });

    it('lista las líneas esenciales incluidas con estado distinto de confirmado', () => {
      expect(result(lines, 'ESSENTIAL_NOT_CONFIRMED')).toMatchObject({
        passed: false,
        subjectKind: 'budget_line',
        subjects: ['lb', 'lc'],
      });
      expect(run(lines).overall).toBe('PASS_WITH_WARNINGS');
    });

    it('con todas las esenciales confirmadas, cumple', () => {
      expect(result(healthy(), 'ESSENTIAL_NOT_CONFIRMED').passed).toBe(true);
    });
  });

  describe('saldo final negativo en algún mes (WARN)', () => {
    it('lista los meses con saldo final < 0, y 0 exacto no cuenta', () => {
      // S0 = 10 000, flujo 60 000. Un evento de 100 000 en el mes 1: final_1 = −30 000; final_2 = 30 000.
      const negative = healthy({
        items: [income('sal', 100_000), expense('rent', 40_000), savings('s', 10_000)],
        events: [
          event('e', {
            amountCents: 100_000,
            expectedDate: '2026-11-03',
            includeInProjection: true,
          }),
        ],
      });
      expect(result(negative, 'NEGATIVE_FINAL_BALANCE')).toMatchObject({
        passed: false,
        subjectKind: 'month',
        subjects: ['2026-11'],
      });

      const zero = healthy({
        items: [income('sal', 100_000), expense('rent', 40_000), savings('s', 10_000)],
        events: [
          event('e', {
            amountCents: 70_000,
            expectedDate: '2026-11-03',
            includeInProjection: true,
          }),
        ],
      });
      expect(result(zero, 'NEGATIVE_FINAL_BALANCE').passed).toBe(true); // final_1 = 10 000 + 60 000 − 70 000 = 0
    });

    it('usa el saldo mostrado, también en los meses pasados con datos reales', () => {
      const plan = healthy();
      const checks = calculatePlan(plan, {
        currentMonth: '2026-12',
        // 500 000 − 560 000 = −60 000 en 2026-11; en 2026-12 (plan, +60 000) el saldo vuelve a 0 y ya no cuenta
        realFlowByMonth: new Map([['2026-11', -560_000]]),
      }).checks;
      expect(
        checks.checks.find((entry) => entry.code === 'NEGATIVE_FINAL_BALANCE')?.subjects,
      ).toEqual(['2026-11']);
    });
  });

  describe('EXPENSE_NOT_BUDGETED (WARN)', () => {
    it('señala el gasto incluido que ninguna línea referencia', () => {
      const plan = healthy({
        items: [
          income('sal', 100_000),
          expense('rent', 40_000),
          expense('orphan', 5_000, 'estimated'),
          expense('orphan-paused', 5_000, 'paused'), // fuera del plan base: no se señala
          expense('orphan-hist', 5_000, 'historical'),
        ],
      });
      expect(result(plan, 'EXPENSE_NOT_BUDGETED')).toMatchObject({
        passed: false,
        subjectKind: 'item',
        subjects: ['orphan'],
      });
    });

    it('un gasto que referencia una línea está presupuestado; otros tipos de registro no cuentan', () => {
      const plan = healthy({
        items: [
          income('sal', 100_000),
          expense('rent', 40_000),
          item('o', 'one_off_payment', 'eur', 5),
        ],
      });
      expect(result(plan, 'EXPENSE_NOT_BUDGETED').passed).toBe(true);
    });
  });

  describe('SCENARIO_ITEM_ALREADY_IN_BASE (WARN)', () => {
    const items = [
      income('sal', 100_000),
      expense('rent', 40_000),
      expense('light', 6_000, 'estimated'),
      expense('gym', 4_500, 'potential'),
      expense('paused', 3_000, 'paused'),
      item('free', 'scenario', 'eur_per_month', 8_000, 'potential'),
    ];
    const budgetLines = [line('l1', 'rent'), line('l2', 'light'), line('l3', 'paused')];

    it.each([
      ['un extra que ya está en el gasto base', scenario('s', ['light', 'extra_monthly']), true],
      [
        'un extra con una fila fuera de la base (potencial, sin línea)',
        scenario('s', ['gym', 'extra_monthly']),
        false,
      ],
      [
        'un extra cuya línea tiene un estado fuera de la base',
        scenario('s', ['paused', 'extra_monthly']),
        false,
      ],
      ['un extra libre', scenario('s', ['free', 'extra_monthly']), false],
      [
        'la misma fila como pago puntual (solo mira la lista «extra»)',
        scenario('s', ['light', 'one_off']),
        false,
      ],
      ['un escenario vacío', scenario('s'), false],
    ])('%s → avisa: %s', (_name, planScenario, warns) => {
      const plan = healthy({ items, budgetLines, scenarios: [planScenario] });
      const found = result(plan, 'SCENARIO_ITEM_ALREADY_IN_BASE');
      expect(found.passed).toBe(!warns);
      expect(found.subjects).toEqual(warns ? ['s'] : []);
    });
  });

  describe('EVENT_ITEM_ALREADY_IN_BASE (WARN)', () => {
    const items = [
      income('sal', 100_000),
      expense('rent', 40_000),
      item('term', 'assumption', 'months', 1_800),
      item('car', 'one_off_payment', 'eur', 45_000),
    ];
    const budgetLines = [line('l1', 'rent')];

    it.each([
      [
        'incluido y con la fila de importe en el presupuesto',
        event('e', {
          amountCents: null,
          amountItemId: 'rent',
          expectedDate: '2026-12-01',
          includeInProjection: true,
        }),
        true,
      ],
      [
        'cuota × plazo con la cuota en el presupuesto, aunque la fecha caiga fuera de los 12 meses',
        event('e', {
          amountCents: null,
          amountItemId: 'rent',
          multiplierItemId: 'term',
          expectedDate: '2028-05-01',
          includeInProjection: true,
        }),
        true,
      ],
      [
        'no incluido en la proyección',
        event('e', { amountCents: null, amountItemId: 'rent', includeInProjection: false }),
        false,
      ],
      [
        'referencia a una fila que no está en el presupuesto',
        event('e', {
          amountCents: null,
          amountItemId: 'car',
          expectedDate: '2026-12-01',
          includeInProjection: true,
        }),
        false,
      ],
      [
        'importe literal',
        event('e', { amountCents: 500, expectedDate: '2026-12-01', includeInProjection: true }),
        false,
      ],
    ])('%s → avisa: %s', (_name, planEvent, warns) => {
      const plan = healthy({ items, budgetLines, events: [planEvent] });
      const found = result(plan, 'EVENT_ITEM_ALREADY_IN_BASE');
      expect(found.passed).toBe(!warns);
      expect(found.subjects).toEqual(warns ? ['e'] : []);
    });

    it('si el estado de la fila de la línea la deja fuera de la base, ya no hay doble cómputo', () => {
      const plan = healthy({
        items: [income('sal', 100_000), expense('rent', 40_000, 'paused')],
        budgetLines,
        events: [
          event('e', {
            amountCents: null,
            amountItemId: 'rent',
            expectedDate: '2026-12-01',
            includeInProjection: true,
          }),
        ],
      });
      expect(result(plan, 'EVENT_ITEM_ALREADY_IN_BASE').passed).toBe(true);
    });
  });
});

describe('overallStatus', () => {
  const make = (severity: 'FAIL' | 'WARN', passed: boolean): CheckResult => ({
    code: 'NEGATIVE_MARGIN',
    severity,
    passed,
    subjectKind: 'none',
    subjects: [],
  });

  it.each([
    ['sin comprobaciones', [], 'PASS'],
    ['todas cumplen', [make('FAIL', true), make('WARN', true)], 'PASS'],
    ['un aviso', [make('FAIL', true), make('WARN', false)], 'PASS_WITH_WARNINGS'],
    ['un fallo', [make('FAIL', false), make('WARN', true)], 'FAIL'],
    ['un fallo y un aviso: FAIL manda', [make('WARN', false), make('FAIL', false)], 'FAIL'],
  ] as const)('%s → %s', (_name, checks, expected) => {
    expect(overallStatus(checks)).toBe(expected);
  });
});
