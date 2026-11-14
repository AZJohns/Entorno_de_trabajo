/**
 * Presupuesto del plan (`summarizeBudget`, §9.2). Tests de tabla con casos límite; importes FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import { summarizeBudget } from '../../src/modules/finance/plan/domain/budget.ts';
import { expense, income, item, line, snapshot } from './plan-builders.ts';

describe('summarizeBudget', () => {
  it('I, G, M, tasa, E y % confirmadas de un presupuesto sencillo', () => {
    const summary = summarizeBudget(
      snapshot({
        items: [
          income('sal', 200_000),
          income('extra', 50_000, 'estimated'),
          expense('rent', 90_000),
          expense('food', 30_000, 'to_confirm'),
          expense('fun', 10_000, 'provisional'),
        ],
        budgetLines: [line('l1', 'rent', true), line('l2', 'food', true), line('l3', 'fun')],
      }),
    );
    expect(summary).toMatchObject({
      incomeCents: 250_000, // 200 000 + 50 000
      expensesCents: 130_000, // 90 000 + 30 000 + 10 000
      marginCents: 120_000,
      savingsRate: { numerator: 120_000, denominator: 250_000 },
      essentialCents: 120_000, // 90 000 + 30 000
      includedLineCount: 3,
      confirmedLineCount: 1, // solo «rent»
      confirmedShare: { numerator: 1, denominator: 3 },
    });
  });

  it('I = 0: la tasa y los % del ingreso son null («sin ingresos»), sin dividir por cero', () => {
    const summary = summarizeBudget(
      snapshot({ items: [expense('rent', 90_000)], budgetLines: [line('l1', 'rent', true)] }),
    );
    expect(summary.incomeCents).toBe(0);
    expect(summary.marginCents).toBe(-90_000);
    expect(summary.savingsRate).toBeNull();
    expect(summary.lines[0]?.incomeShare).toBeNull();
  });

  it('G > I: el margen es negativo y la tasa conserva el signo', () => {
    const summary = summarizeBudget(
      snapshot({
        items: [income('sal', 100_000), expense('rent', 130_000)],
        budgetLines: [line('l1', 'rent')],
      }),
    );
    expect(summary.marginCents).toBe(-30_000);
    expect(summary.savingsRate).toEqual({ numerator: -30_000, denominator: 100_000 });
  });

  it('sin líneas: G = 0, E = 0 y % confirmadas null', () => {
    const summary = summarizeBudget(snapshot({ items: [income('sal', 100_000)] }));
    expect(summary).toMatchObject({
      expensesCents: 0,
      marginCents: 100_000,
      essentialCents: 0,
      includedLineCount: 0,
      confirmedShare: null,
    });
  });

  it('solo cuentan los ingresos en €/mes, de tipo income e incluidos', () => {
    const summary = summarizeBudget(
      snapshot({
        items: [
          income('ok', 100_000),
          income('potential', 40_000, 'potential'), // estado fuera del plan base
          income('inactive', 30_000, 'inactive'),
          item('wrong-unit', 'income', 'eur', 20_000), // unidad incorrecta: no es un ingreso mensual
          item('other-type', 'assumption', 'eur_per_month', 10_000), // no es un ingreso
        ],
      }),
    );
    expect(summary.incomeCents).toBe(100_000);
  });

  it('las líneas con estado fuera del plan base no suman a G, E ni a los recuentos, pero se listan', () => {
    const summary = summarizeBudget(
      snapshot({
        items: [
          income('sal', 100_000),
          expense('a', 10_000),
          expense('b', 20_000, 'paused'),
          expense('c', 5_000, 'historical'),
        ],
        budgetLines: [line('la', 'a', true), line('lb', 'b', true), line('lc', 'c')],
      }),
    );
    expect(summary.expensesCents).toBe(10_000);
    expect(summary.essentialCents).toBe(10_000);
    expect(summary.includedLineCount).toBe(1);
    expect(summary.lines.map((entry) => [entry.lineId, entry.included])).toEqual([
      ['la', true],
      ['lb', false],
      ['lc', false],
    ]);
  });

  it('anual = 12 × mensual y % del ingreso = mensual / I, por línea', () => {
    const summary = summarizeBudget(
      snapshot({
        items: [income('sal', 280_000), expense('rent', 80_000)],
        budgetLines: [line('l1', 'rent')],
      }),
    );
    expect(summary.lines[0]).toEqual({
      lineId: 'l1',
      monthlyCents: 80_000,
      included: true,
      annualCents: 960_000,
      incomeShare: { numerator: 80_000, denominator: 280_000 },
    });
  });

  it('E incluye TODAS las líneas esenciales, también la última (error de rango de la plantilla)', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const summary = summarizeBudget(
      snapshot({
        items: lines.map((id, index) => expense(id, (index + 1) * 1_000)),
        budgetLines: lines.map((id) => line(`l-${id}`, id, true)),
      }),
    );
    expect(summary.essentialCents).toBe(10_000); // 1 000 + 2 000 + 3 000 + 4 000
    expect(summary.essentialCents).toBe(summary.expensesCents);
  });

  it('un presupuesto del que todas las líneas están confirmadas da 100 %', () => {
    const summary = summarizeBudget(
      snapshot({
        items: [income('sal', 1_000), expense('a', 100), expense('b', 200)],
        budgetLines: [line('la', 'a'), line('lb', 'b')],
      }),
    );
    expect(summary.confirmedShare).toEqual({ numerator: 2, denominator: 2 });
  });

  it('una línea que apunta a una fila inexistente o sin importe es una foto incoherente', () => {
    expect(() => summarizeBudget(snapshot({ budgetLines: [line('l1', 'missing')] }))).toThrow(
      RangeError,
    );
    expect(() =>
      summarizeBudget(
        snapshot({
          items: [item('months', 'assumption', 'months', 600)],
          budgetLines: [line('l1', 'months')],
        }),
      ),
    ).toThrow(RangeError);
  });

  it('dos filas de Datos con el mismo id son una foto incoherente', () => {
    expect(() =>
      summarizeBudget(
        snapshot({ items: [income('x', 1), income('x', 2)], budgetLines: [line('l1', 'x')] }),
      ),
    ).toThrow(RangeError);
  });
});
