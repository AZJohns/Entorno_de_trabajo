/** Cálculo del progreso del presupuesto (domain/budget.ts) y fechas nuevas. Importes inventados. */
import { describe, expect, it } from 'vitest';
import { previousMonth } from '../../src/modules/finance/ledger/domain/dates.ts';
import type { CategorizedMovement } from '../../src/modules/finance/ledger/domain/reports.ts';
import {
  budgetProgress,
  type BudgetEntry,
} from '../../src/modules/finance/budget/domain/budget.ts';
import { movement } from './ledger-fixtures.ts';

const FOOD = 'cat-food';
const LEISURE = 'cat-leisure';
const SALARY = 'cat-salary';

const spent = (
  categoryId: string | null,
  amountCents: number,
  overrides: Partial<CategorizedMovement> = {},
): CategorizedMovement => ({ ...movement({ amountCents }), categoryId, ...overrides });

const budget = (categoryId: string, amountCents: number): BudgetEntry => ({
  id: `budget-${categoryId}`,
  categoryId,
  amountCents,
});

describe('previousMonth', () => {
  it.each([
    ['2026-10', '2026-09'],
    ['2026-01', '2025-12'],
    ['2026-12', '2026-11'],
    ['0002-01', '0001-12'],
  ])('previousMonth(%s) = %s', (month, previous) => {
    expect(previousMonth(month)).toBe(previous);
  });

  it('no hay mes anterior al año 1', () => {
    expect(previousMonth('0001-01')).toBeNull();
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026-10-01', ''])('rechaza %j', (bad) => {
    expect(() => previousMonth(bad)).toThrow(RangeError);
  });
});

describe('budgetProgress', () => {
  it('un mes sin gastos: gastado 0 y queda todo el presupuesto', () => {
    const progress = budgetProgress([budget(FOOD, 30_000)], [], '2026-10-01');
    expect(progress.lines).toEqual([
      { ...budget(FOOD, 30_000), spentCents: 0, remainingCents: 30_000 },
    ]);
    expect(progress.unbudgeted).toEqual([]);
    expect(progress.totals).toEqual({
      budgetedCents: 30_000,
      spentCents: 0,
      remainingCents: 30_000,
      unbudgetedSpentCents: 0,
    });
  });

  it('un mes sin presupuestos ni gastos está vacío', () => {
    expect(budgetProgress([], [], '2026-10-01')).toEqual({
      lines: [],
      unbudgeted: [],
      totals: { budgetedCents: 0, spentCents: 0, remainingCents: 0, unbudgetedSpentCents: 0 },
    });
  });

  it('suma los gastos confirmados de la categoría y deja lo que queda', () => {
    const progress = budgetProgress(
      [budget(FOOD, 30_000)],
      [spent(FOOD, 12_000), spent(FOOD, 5_050, { bookedOn: '2026-10-31' })],
      '2026-10-15',
    );
    expect(progress.lines[0]).toMatchObject({ spentCents: 17_050, remainingCents: 12_950 });
  });

  it('si el gasto supera el presupuesto, lo que queda es negativo', () => {
    const progress = budgetProgress([budget(FOOD, 10_000)], [spent(FOOD, 10_001)], '2026-10-01');
    expect(progress.lines[0]).toMatchObject({ spentCents: 10_001, remainingCents: -1 });
    expect(progress.totals.remainingCents).toBe(-1);
  });

  it('solo cuentan los gastos confirmados del mes: no los pendientes, ingresos ni otros meses', () => {
    const progress = budgetProgress(
      [budget(FOOD, 30_000)],
      [
        spent(FOOD, 1_000),
        spent(FOOD, 7_000, { status: 'pending' }),
        spent(FOOD, 9_000, { kind: 'income' }),
        spent(FOOD, 4_000, { bookedOn: '2026-09-30' }),
        spent(FOOD, 3_000, { bookedOn: '2026-11-01' }),
      ],
      '2026-10-01',
    );
    expect(progress.lines[0]?.spentCents).toBe(1_000);
    expect(progress.unbudgeted).toEqual([]);
  });

  it('los ajustes de conciliación no son gasto de ninguna categoría ni «sin categoría»', () => {
    const progress = budgetProgress(
      [budget(FOOD, 30_000)],
      [spent(null, 500, { source: 'reconciliation', reconciliationId: 'rec-1' })],
      '2026-10-01',
    );
    expect(progress.lines[0]?.spentCents).toBe(0);
    expect(progress.unbudgeted).toEqual([]);
  });

  it('los gastos de categorías sin presupuesto salen aparte, de mayor a menor', () => {
    const progress = budgetProgress(
      [budget(FOOD, 30_000)],
      [spent(FOOD, 2_000), spent(LEISURE, 800), spent(LEISURE, 700), spent('cat-other', 1_600)],
      '2026-10-01',
    );
    expect(progress.unbudgeted).toEqual([
      { categoryId: 'cat-other', spentCents: 1_600 },
      { categoryId: LEISURE, spentCents: 1_500 },
    ]);
    // El total gastado solo cuenta las categorías con presupuesto.
    expect(progress.totals).toEqual({
      budgetedCents: 30_000,
      spentCents: 2_000,
      remainingCents: 28_000,
      unbudgetedSpentCents: 3_100,
    });
  });

  it('un gasto sin categoría (no debería ocurrir) se avisa como sin presupuesto', () => {
    const progress = budgetProgress([], [spent(null, 900)], '2026-10-01');
    expect(progress.unbudgeted).toEqual([{ categoryId: null, spentCents: 900 }]);
  });

  it('los ingresos de una categoría nunca restan de un presupuesto', () => {
    const progress = budgetProgress(
      [budget(SALARY, 5_000)],
      [spent(SALARY, 200_000, { kind: 'income' })],
      '2026-10-01',
    );
    expect(progress.lines[0]).toMatchObject({ spentCents: 0, remainingCents: 5_000 });
  });

  it('mantiene el orden de los presupuestos y las cifras de cada línea', () => {
    const progress = budgetProgress(
      [budget(LEISURE, 1_000), budget(FOOD, 2_000)],
      [spent(FOOD, 500)],
      '2026-10-01',
    );
    expect(progress.lines.map((line) => line.categoryId)).toEqual([LEISURE, FOOD]);
    expect(progress.totals).toMatchObject({ budgetedCents: 3_000, spentCents: 500 });
  });

  it('rechaza una fecha que no es válida', () => {
    expect(() => budgetProgress([], [], '2026-02-30')).toThrow(RangeError);
  });
});
