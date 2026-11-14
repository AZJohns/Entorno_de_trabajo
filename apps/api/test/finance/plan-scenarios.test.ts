/**
 * Escenarios (`evaluateScenarios`, `readScenario`, §9.5). Tests de tabla con casos límite; importes FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateScenarios,
  readScenario,
} from '../../src/modules/finance/plan/domain/scenarios.ts';
import { expense, income, item, scenario, snapshot } from './plan-builders.ts';

describe('readScenario (umbrales con aritmética entera)', () => {
  // I = 100 000: el 20 % son 20 000 y el 40 %, 40 000.
  it.each([
    [-1, 'deficit'],
    [-50_000, 'deficit'],
    [0, 'low'], // 0 % no es déficit
    [19_999, 'low'],
    [20_000, 'moderate'], // 20 % exacto = moderado
    [39_999, 'moderate'],
    [40_000, 'high'], // 40 % exacto = alto
    [100_000, 'high'],
  ] as const)('caja libre %i sobre I = 100 000 → %s', (cash, expected) => {
    expect(readScenario(cash, 100_000)).toBe(expected);
  });

  it('I = 0 → sin ingresos, también con caja libre negativa', () => {
    expect(readScenario(0, 0)).toBe('no_income');
    expect(readScenario(-5_000, 0)).toBe('no_income');
  });

  it('los umbrales no dependen del redondeo: 1/3 de 3 € es 33,33 %', () => {
    expect(readScenario(100, 300)).toBe('moderate'); // 33,3 %
    expect(readScenario(60, 300)).toBe('moderate'); // 20 % exacto
    expect(readScenario(59, 300)).toBe('low');
    expect(readScenario(120, 300)).toBe('high'); // 40 % exacto
    expect(readScenario(119, 300)).toBe('moderate');
  });

  it('ingresos negativos no son válidos', () => {
    expect(() => readScenario(0, -1)).toThrow(RangeError);
  });
});

describe('evaluateScenarios', () => {
  const budget = { incomeCents: 280_000, expensesCents: 142_500 };
  const items = [
    expense('a', 8_000, 'potential'), // los escenarios no filtran por estado
    expense('b', 4_500, 'inactive'),
    item('puntual', 'scenario', 'eur', 60_000, 'potential'),
    income('inc', 10_000),
  ];

  it('un escenario vacío (=0) deja la base tal cual', () => {
    const [result] = evaluateScenarios(snapshot({ items, scenarios: [scenario('s')] }), budget);
    expect(result).toEqual({
      scenarioId: 's',
      name: 'Escenario s',
      extraCents: 0,
      oneOffCents: 0,
      totalOutflowCents: 142_500,
      freeCashCents: 137_500,
      freeRate: { numerator: 137_500, denominator: 280_000 },
      reading: 'high',
    });
  });

  it('suma extras y puntuales sin mirar el estado; el puntual se resta entero', () => {
    const [result] = evaluateScenarios(
      snapshot({
        items,
        scenarios: [
          scenario('s', ['a', 'extra_monthly'], ['b', 'extra_monthly'], ['puntual', 'one_off']),
        ],
      }),
      budget,
    );
    expect(result).toMatchObject({
      extraCents: 12_500,
      oneOffCents: 60_000,
      totalOutflowCents: 215_000, // 142 500 + 12 500 + 60 000
      freeCashCents: 65_000,
      reading: 'moderate', // 23,2 %
    });
  });

  it('una fila con rol puntual y otra con rol extra no se mezclan', () => {
    const [result] = evaluateScenarios(
      snapshot({
        items,
        scenarios: [scenario('s', ['a', 'one_off'], ['puntual', 'extra_monthly'])],
      }),
      budget,
    );
    expect(result).toMatchObject({ extraCents: 60_000, oneOffCents: 8_000 });
  });

  it.each([
    // [caja libre deseada, lectura]: I = 100 000, G = 50 000 → extra = 50 000 − caja
    [50_000, 'high'],
    [40_000, 'high'], // 40 % exacto
    [39_999, 'moderate'],
    [20_000, 'moderate'], // 20 % exacto
    [19_999, 'low'],
    [0, 'low'],
    [-1, 'deficit'],
  ] as const)('caja libre %i → %s', (cash, reading) => {
    const extra = 50_000 - cash;
    const [result] = evaluateScenarios(
      snapshot({
        items: [item('x', 'scenario', 'eur_per_month', extra)],
        scenarios: [scenario('s', ['x', 'extra_monthly'])],
      }),
      { incomeCents: 100_000, expensesCents: 50_000 },
    );
    expect(result?.freeCashCents).toBe(cash);
    expect(result?.reading).toBe(reading);
  });

  it('I = 0: «sin ingresos» y tasa null', () => {
    const [result] = evaluateScenarios(snapshot({ items, scenarios: [scenario('s')] }), {
      incomeCents: 0,
      expensesCents: 50_000,
    });
    expect(result).toMatchObject({ freeCashCents: -50_000, freeRate: null, reading: 'no_income' });
  });

  it('G > I: déficit', () => {
    const [result] = evaluateScenarios(snapshot({ items, scenarios: [scenario('s')] }), {
      incomeCents: 100_000,
      expensesCents: 130_000,
    });
    expect(result).toMatchObject({ freeCashCents: -30_000, reading: 'deficit' });
  });

  it('una fila en meses (sin importe) suma 0 en vez de romper: el importador solo avisa', () => {
    const [result] = evaluateScenarios(
      snapshot({
        items: [item('m', 'scenario', 'months', 600)],
        scenarios: [scenario('s', ['m', 'extra_monthly'])],
      }),
      budget,
    );
    expect(result?.extraCents).toBe(0);
  });

  it('una referencia que no existe es una foto incoherente', () => {
    expect(() =>
      evaluateScenarios(
        snapshot({ scenarios: [scenario('s', ['nope', 'extra_monthly'])] }),
        budget,
      ),
    ).toThrow(RangeError);
  });

  it('devuelve un resultado por escenario, en el orden de entrada', () => {
    const results = evaluateScenarios(
      snapshot({ items, scenarios: [scenario('uno'), scenario('dos', ['a', 'extra_monthly'])] }),
      budget,
    );
    expect(results.map((result) => result.scenarioId)).toEqual(['uno', 'dos']);
  });
});
