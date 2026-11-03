/** Cálculos de los informes (domain/reports.ts y fechas nuevas). Todo con importes inventados. */
import { describe, expect, it } from 'vitest';
import { balanceAsOf, monthlyTotals } from '../../src/modules/finance/ledger/domain/balances.ts';
import { lastDayOfMonth, monthsBetween } from '../../src/modules/finance/ledger/domain/dates.ts';
import {
  accountBalanceLine,
  adjustmentsAsOf,
  categoryBreakdown,
  monthlyReport,
  pendingTotals,
  sumCents,
  type CategorizedMovement,
} from '../../src/modules/finance/ledger/domain/reports.ts';
import { ACCOUNT, OTHER_ACCOUNT, ledger, movement, transfer } from './ledger-fixtures.ts';

const categorized = (
  categoryId: string | null,
  overrides: Partial<CategorizedMovement> = {},
): CategorizedMovement => ({ ...movement(), categoryId, ...overrides });

describe('fechas de los informes', () => {
  it.each([
    ['2026-10', '2026-10-31'],
    ['2026-02', '2026-02-28'],
    ['2028-02', '2028-02-29'],
    ['2100-02', '2100-02-28'],
    ['2026-04', '2026-04-30'],
  ])('lastDayOfMonth(%s) = %s', (month, last) => {
    expect(lastDayOfMonth(month)).toBe(last);
  });

  it('lastDayOfMonth rechaza meses no válidos', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '2026-10-01', '0000-01', '']) {
      expect(() => lastDayOfMonth(bad), bad).toThrow(RangeError);
    }
  });

  it('monthsBetween cruza el cambio de año, incluye los extremos y admite un solo mes', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween('2026-10', '2026-10')).toEqual(['2026-10']);
    expect(monthsBetween('2026-11', '2026-10')).toEqual([]);
  });
});

describe('sumCents', () => {
  it('suma con signo y vale 0 sin valores', () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([100, -250, 5])).toBe(-145);
  });

  it('rechaza una suma que deja de ser un entero seguro', () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});

describe('pendingTotals', () => {
  it('cuenta los pendientes del mes y separa ingresos de gastos', () => {
    const rows = [
      movement({ status: 'pending', amountCents: 300 }),
      movement({ status: 'pending', amountCents: 200, kind: 'income' }),
      movement({ status: 'pending', amountCents: 50, bookedOn: '2026-09-30' }),
      movement({ status: 'confirmed', amountCents: 9_999 }),
    ];
    expect(pendingTotals(rows, '2026-10-01')).toEqual({
      count: 2,
      incomeCents: 200,
      expenseCents: 300,
    });
  });

  it('sin pendientes, todo a cero', () => {
    expect(pendingTotals([], '2026-10-01')).toEqual({ count: 0, incomeCents: 0, expenseCents: 0 });
  });
});

describe('monthlyReport', () => {
  const movements = [
    movement({ kind: 'income', amountCents: 200_000, bookedOn: '2026-10-01' }),
    movement({ kind: 'expense', amountCents: 20_000, bookedOn: '2026-10-05' }),
    movement({ kind: 'expense', amountCents: 5_000, bookedOn: '2026-12-02' }),
    movement({
      kind: 'income',
      amountCents: 250,
      bookedOn: '2026-10-15',
      source: 'reconciliation',
      reconciliationId: 'rec-1',
    }),
    movement({ status: 'pending', amountCents: 700, bookedOn: '2026-12-03' }),
  ];

  it('da una fila por mes del rango, también los vacíos, y coincide con monthlyTotals', () => {
    const rows = monthlyReport(movements, '2026-10', '2026-12');
    expect(rows.map((row) => row.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    for (const row of rows) {
      const { incomeCents, expenseCents, netCents, adjustmentsCents } = monthlyTotals(
        movements,
        `${row.month}-01`,
      );
      expect(row).toMatchObject({ incomeCents, expenseCents, netCents, adjustmentsCents });
    }
    expect(rows[0]).toMatchObject({
      incomeCents: 200_000,
      expenseCents: 20_000,
      adjustmentsCents: 250,
    });
    expect(rows[1]).toMatchObject({ incomeCents: 0, expenseCents: 0, netCents: 0 });
    expect(rows[1]?.pending.count).toBe(0);
    expect(rows[2]?.pending).toEqual({ count: 1, incomeCents: 0, expenseCents: 700 });
  });

  it('las transferencias no existen para el informe: solo recibe movimientos', () => {
    // El tipo de la función no admite transferencias; este test fija que el neto no depende de ellas.
    const withoutTransfers = monthlyReport(movements, '2026-10', '2026-10');
    expect(withoutTransfers[0]?.netCents).toBe(180_000);
  });
});

describe('categoryBreakdown', () => {
  it('agrupa por tipo y categoría, ordena por importe y deja los ajustes y pendientes fuera', () => {
    const rows = [
      categorized('c-comida', { amountCents: 1_000 }),
      categorized('c-comida', { amountCents: 2_500 }),
      categorized('c-ocio', { amountCents: 4_000 }),
      categorized(null, { amountCents: 10 }),
      categorized('c-sueldo', { kind: 'income', amountCents: 150_000 }),
      categorized('c-comida', { status: 'pending', amountCents: 9_999 }),
      categorized('c-comida', { bookedOn: '2026-09-30', amountCents: 9_999 }),
      categorized(null, {
        kind: 'income',
        amountCents: 300,
        source: 'reconciliation',
        reconciliationId: 'rec-1',
      }),
    ];
    expect(categoryBreakdown(rows, '2026-10-01')).toEqual([
      { kind: 'income', categoryId: 'c-sueldo', totalCents: 150_000 },
      { kind: 'expense', categoryId: 'c-ocio', totalCents: 4_000 },
      { kind: 'expense', categoryId: 'c-comida', totalCents: 3_500 },
      { kind: 'expense', categoryId: null, totalCents: 10 },
    ]);
  });

  it('la suma de cada tipo coincide con monthlyTotals', () => {
    const rows = [
      categorized('a', { amountCents: 1_001 }),
      categorized('b', { amountCents: 2_002 }),
      categorized(null, { amountCents: 3 }),
      categorized('c', { kind: 'income', amountCents: 7_000 }),
    ];
    const breakdown = categoryBreakdown(rows, '2026-10-01');
    const totals = monthlyTotals(rows, '2026-10-01');
    const of = (kind: 'income' | 'expense') =>
      sumCents(breakdown.filter((line) => line.kind === kind).map((line) => line.totalCents));
    expect(of('expense')).toBe(totals.expenseCents);
    expect(of('income')).toBe(totals.incomeCents);
  });

  it('a igualdad de importe el orden es estable (por categoryId)', () => {
    const rows = [categorized('b', { amountCents: 5 }), categorized('a', { amountCents: 5 })];
    expect(categoryBreakdown(rows, '2026-10-01').map((line) => line.categoryId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('sin movimientos, lista vacía; con una fecha no válida, error', () => {
    expect(categoryBreakdown([], '2026-10-01')).toEqual([]);
    expect(() => categoryBreakdown([], '2026-10-32')).toThrow(RangeError);
  });
});

describe('adjustmentsAsOf y accountBalanceLine', () => {
  const adjustment = (overrides: Partial<CategorizedMovement>) =>
    movement({ source: 'reconciliation', reconciliationId: 'rec', ...overrides });
  const account = ledger({
    openingBalanceCents: 100_000,
    movements: [
      movement({ kind: 'income', amountCents: 20_000, bookedOn: '2026-10-01' }),
      adjustment({ kind: 'income', amountCents: 500, bookedOn: '2026-10-15' }),
      adjustment({ kind: 'expense', amountCents: 120, bookedOn: '2026-11-15' }),
      adjustment({ kind: 'income', amountCents: 9_999, accountId: OTHER_ACCOUNT }),
    ],
    transfers: [transfer({ amountCents: 1_000, bookedOn: '2026-10-20' })],
  });

  it('suma los ajustes con signo hasta la fecha y solo los de su cuenta', () => {
    expect(adjustmentsAsOf(account, '2026-10-31')).toBe(500);
    expect(adjustmentsAsOf(account, '2026-11-30')).toBe(380);
    expect(adjustmentsAsOf(account, '2026-10-14')).toBe(0);
    expect(adjustmentsAsOf(account, null)).toBe(380);
  });

  it('un ajuste pendiente no cuenta', () => {
    const pending = ledger({ movements: [adjustment({ status: 'pending', amountCents: 5 })] });
    expect(adjustmentsAsOf(pending, null)).toBe(0);
  });

  it('el saldo incluye los ajustes y es el de balanceAsOf', () => {
    const line = accountBalanceLine(account, '2026-01-01', '2026-10-31');
    expect(line).toEqual({
      accountId: ACCOUNT,
      balanceCents: balanceAsOf(account, '2026-10-31'),
      adjustmentsCents: 500,
    });
    // 100.000 + 20.000 + 500 − 1.000 (transferencia enviada)
    expect(line?.balanceCents).toBe(119_500);
  });

  it('una cuenta aún no abierta en esa fecha no tiene línea', () => {
    expect(accountBalanceLine(account, '2026-11-01', '2026-10-31')).toBeNull();
    expect(accountBalanceLine(account, '2026-10-31', '2026-10-31')).not.toBeNull();
  });
});
