/**
 * Flujo real de los meses pasados (`realFlowByMonth`, docs/plan.md §3.13): ingresos − gastos confirmados de
 * cada mes, sin pendientes ni ajustes de conciliación. Un mes sin ingresos ni gastos confirmados no entra en
 * el mapa (la proyección lo marca como NO_REAL_DATA); un mes cuyos confirmados suman 0 sí entra, con 0.
 * Importes inventados.
 */
import { describe, expect, it } from 'vitest';
import { realFlowByMonth } from '../../src/modules/finance/ledger/domain/reports.ts';
import { movement } from './ledger-fixtures.ts';

const income = (amountCents: number, bookedOn: string) =>
  movement({ kind: 'income', amountCents, bookedOn });
const expense = (amountCents: number, bookedOn: string) =>
  movement({ kind: 'expense', amountCents, bookedOn });

const flow = (movements: ReturnType<typeof movement>[], from = '2026-10', to = '2027-01') => [
  ...realFlowByMonth(movements, from, to),
];

describe('realFlowByMonth', () => {
  it('sin movimientos, ningún mes tiene datos', () => {
    expect(flow([])).toEqual([]);
  });

  it('ingresos menos gastos confirmados de cada mes', () => {
    expect(
      flow([
        income(250_000, '2026-10-01'),
        expense(100_000, '2026-10-31'),
        expense(30_000, '2026-11-15'),
        income(500, '2027-01-01'),
      ]),
    ).toEqual([
      ['2026-10', 150_000],
      ['2026-11', -30_000],
      ['2027-01', 500],
    ]);
  });

  it('un mes sin movimientos no aparece, aunque esté entre dos con datos', () => {
    const result = realFlowByMonth(
      [income(100, '2026-10-05'), income(100, '2026-12-05')],
      '2026-10',
      '2026-12',
    );
    expect(result.has('2026-11')).toBe(false);
    expect([...result.keys()]).toEqual(['2026-10', '2026-12']);
  });

  it('un mes con confirmados que suman 0 entra con 0', () => {
    const result = realFlowByMonth(
      [income(40_000, '2026-10-05'), expense(40_000, '2026-10-06')],
      '2026-10',
      '2026-10',
    );
    expect(result.has('2026-10')).toBe(true);
    expect(result.get('2026-10')).toBe(0);
  });

  it('los pendientes no cuentan: ni en el importe ni como «hay datos»', () => {
    expect(
      flow([
        movement({
          kind: 'income',
          amountCents: 900_000,
          bookedOn: '2026-10-09',
          status: 'pending',
        }),
        movement({ kind: 'expense', amountCents: 70, bookedOn: '2026-11-09', status: 'pending' }),
        income(1_000, '2026-11-10'),
      ]),
    ).toEqual([['2026-11', 1_000]]);
  });

  it('los ajustes de conciliación no cuentan: ni en el importe ni como «hay datos»', () => {
    const adjustment = (kind: 'income' | 'expense', amountCents: number, bookedOn: string) =>
      movement({ kind, amountCents, bookedOn, source: 'reconciliation', reconciliationId: 'rec' });
    expect(
      flow([
        // Octubre: solo un ajuste → sin datos.
        adjustment('income', 500, '2026-10-25'),
        // Noviembre: un ingreso real y un ajuste → solo cuenta el ingreso.
        income(2_000, '2026-11-02'),
        adjustment('expense', 300, '2026-11-25'),
      ]),
    ).toEqual([['2026-11', 2_000]]);
  });

  it('cuenta los movimientos de todas las cuentas, también los de una sin categoría', () => {
    expect(
      flow([
        income(1_000, '2026-10-02'),
        movement({ kind: 'expense', amountCents: 400, bookedOn: '2026-10-03', accountId: 'otra' }),
      ]),
    ).toEqual([['2026-10', 600]]);
  });

  it('ignora lo que cae fuera del rango pedido', () => {
    expect(flow([income(1, '2026-09-30'), income(2, '2027-02-01')])).toEqual([]);
  });

  it('con el rango invertido no hay meses', () => {
    expect(flow([income(1, '2026-10-01')], '2026-11', '2026-10')).toEqual([]);
  });

  it('el último día del mes pertenece a ese mes', () => {
    expect(flow([income(7, '2026-10-31'), income(5, '2026-11-01')])).toEqual([
      ['2026-10', 7],
      ['2026-11', 5],
    ]);
  });

  it('rechaza un mes que no es válido', () => {
    expect(() => realFlowByMonth([], '2026-13', '2027-01')).toThrow(RangeError);
  });
});
