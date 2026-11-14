/**
 * Aritmética entera del plan: redondeo half-up, división por exceso, sumas, fracciones y meses
 * (`finance/plan/domain/rounding.ts`, `ratio.ts`, `months.ts`). Tests de tabla; números FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import { addMonths, projectionMonthOf } from '../../src/modules/finance/plan/domain/months.ts';
import { comparePercent, ratio } from '../../src/modules/finance/plan/domain/ratio.ts';
import {
  ceilDiv,
  centsTimesMonths,
  roundHalfUpDiv,
  sumCents,
} from '../../src/modules/finance/plan/domain/rounding.ts';

describe('roundHalfUpDiv', () => {
  it.each([
    [0, 5, 0],
    [4, 2, 2], // exacto
    [1, 3, 0], // 0,33 baja
    [2, 3, 1], // 0,67 sube
    [1, 2, 1], // 0,5 sube (half-up)
    [3, 2, 2], // 1,5 sube
    [5, 2, 3], // 2,5 sube
    [5, 4, 1], // 1,25 baja
    [7, 4, 2], // 1,75 sube
    [99, 100, 1],
    [49, 100, 0],
    [50, 100, 1],
  ])('%i / %i = %i', (numerator, denominator, expected) => {
    expect(roundHalfUpDiv(numerator, denominator)).toBe(expected);
  });

  it.each([
    [-1, 2],
    [1.5, 2],
    [1, 0],
    [1, -2],
    [Number.NaN, 2],
    [Number.MAX_SAFE_INTEGER + 1, 2],
  ])('rechaza %s / %s', (numerator, denominator) => {
    expect(() => roundHalfUpDiv(numerator, denominator)).toThrow(RangeError);
  });
});

describe('centsTimesMonths (cuota × plazo y fondo de emergencia)', () => {
  it.each([
    // [céntimos, centésimas de mes, esperado]
    [12_000, 1_800, 216_000], // 120 € × 18 meses, exacto
    [133_000, 600, 798_000], // 6 meses
    [133_000, 650, 864_500], // 6,5 meses, exacto
    [133_001, 650, 864_507], // 864 506,5 → sube (half-up en x,5 céntimos)
    [1, 50, 1], // 0,5 céntimos → sube
    [1, 49, 0], // 0,49 → baja
    [1, 51, 1], // 0,51 → sube
    [3, 150, 5], // 4,5 → sube
    [3, 149, 4], // 4,47 → baja
    [101, 650, 657], // 656,5 → sube
    [0, 600, 0],
    [12_000, 0, 0],
  ])('%i × %i / 100 = %i', (cents, hundredths, expected) => {
    expect(centsTimesMonths(cents, hundredths)).toBe(expected);
  });

  it('no pierde precisión cuando el producto pasa de 2^53 pero el resultado cabe', () => {
    // 1 234 567 890 123 × 9 999 = 12 344 444 333 339 877 (> 2^53): con un `number` el producto saldría redondeado.
    expect(centsTimesMonths(1_234_567_890_123, 9_999)).toBe(123_444_443_333_399);
  });

  it('lanza si el resultado no es un importe válido', () => {
    expect(() => centsTimesMonths(Number.MAX_SAFE_INTEGER, 1_000)).toThrow(RangeError);
  });

  it.each([
    [-1, 100],
    [100, -1],
    [1.5, 100],
    [100, 1.5],
  ])('rechaza (%s, %s)', (cents, hundredths) => {
    expect(() => centsTimesMonths(cents, hundredths)).toThrow(RangeError);
  });
});

describe('ceilDiv', () => {
  it.each([
    [0, 5, 0],
    [10, 5, 2],
    [11, 5, 3],
    [1, 1_000_000, 1],
    [200_000, 15_000, 14],
    [298_000, 20_000, 15],
    [170_000, 1, 170_000],
  ])('ceil(%i / %i) = %i', (numerator, denominator, expected) => {
    expect(ceilDiv(numerator, denominator)).toBe(expected);
  });

  it.each([
    [-1, 5],
    [5, 0],
    [5, -1],
    [0.5, 5],
  ])('rechaza (%s, %s)', (numerator, denominator) => {
    expect(() => ceilDiv(numerator, denominator)).toThrow(RangeError);
  });
});

describe('sumCents', () => {
  it('suma y admite una lista vacía', () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([100, 250, -50])).toBe(300);
  });

  it('lanza si un término o la suma deja de ser un entero seguro', () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => sumCents([0.5])).toThrow(RangeError);
  });
});

describe('ratio y comparePercent', () => {
  it('una fracción sin reducir; con denominador 0, null', () => {
    expect(ratio(137_500, 280_000)).toEqual({ numerator: 137_500, denominator: 280_000 });
    expect(ratio(-5, 10)).toEqual({ numerator: -5, denominator: 10 });
    expect(ratio(7, 0)).toBeNull();
  });

  it.each([
    [1.5, 10],
    [1, 1.5],
    [1, -1],
    [Number.NaN, 1],
  ])('ratio rechaza (%s, %s)', (numerator, denominator) => {
    expect(() => ratio(numerator, denominator)).toThrow(RangeError);
  });

  it.each([
    [19, 100, 20, -1],
    [20, 100, 20, 0], // 20 % exacto
    [21, 100, 20, 1],
    [39_999, 100_000, 40, -1],
    [40_000, 100_000, 40, 0], // 40 % exacto
    [1, 3, 33, 1], // 33,33… % > 33 %
    [-1, 100, 0, -1],
    [0, 100, 0, 0],
  ])('comparePercent(%i/%i, %i %%) = %i', (numerator, denominator, percent, expected) => {
    expect(comparePercent(numerator, denominator, percent)).toBe(expected);
  });

  it('no desborda con numeradores enormes', () => {
    expect(comparePercent(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100)).toBe(0);
    expect(comparePercent(Number.MAX_SAFE_INTEGER, 1, 40)).toBe(1);
  });

  it('rechaza un denominador no positivo', () => {
    expect(() => comparePercent(1, 0, 20)).toThrow(RangeError);
    expect(() => comparePercent(1, -1, 20)).toThrow(RangeError);
  });
});

describe('meses de la proyección', () => {
  it.each([
    ['2026-11', 0, '2026-11'],
    ['2026-11', 1, '2026-12'],
    ['2026-11', 2, '2027-01'],
    ['2026-11', 11, '2027-10'],
    ['2026-01', -1, '2025-12'],
    ['2026-12', 12, '2027-12'],
  ])('addMonths(%s, %i) = %s', (month, offset, expected) => {
    expect(addMonths(month, offset)).toBe(expected);
  });

  it('addMonths rechaza un mes no válido o fuera de rango', () => {
    expect(() => addMonths('2026-13', 1)).toThrow(RangeError);
    expect(() => addMonths('0001-01', -1)).toThrow(RangeError);
  });

  it.each([
    ['2026-11-15', 1],
    ['2026-11-01', 1],
    ['2026-12-31', 2],
    ['2027-02-10', 4],
    ['2027-10-31', 12], // último día del horizonte
    ['2026-10-31', null], // el día anterior al mes 1
    ['2027-11-01', null], // el día siguiente al mes 12
    ['2028-05-01', null],
  ])('projectionMonthOf(2026-11, %s) = %s', (date, expected) => {
    expect(projectionMonthOf('2026-11', date)).toBe(expected);
  });

  it('rechaza una fecha que no existe', () => {
    expect(() => projectionMonthOf('2026-11', '2026-02-30')).toThrow(RangeError);
  });
});
