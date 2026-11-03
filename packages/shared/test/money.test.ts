import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_INPUT_LENGTH,
  assertCents,
  formatCents,
  isCents,
  parseEuroAmount,
} from '../src/index.ts';

describe('parseEuroAmount', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12.50', 1250],
    ['0,01', 1],
    ['0', 0],
    ['1.234', 123400],
    ['1,234', 123400],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234.567', 123456700],
    ['1.234.567,89', 123456789],
    ['12,50 €', 1250],
    ['€12.50', 1250],
    ['  EUR 7 ', 700],
    ['eur 7', 700],
    ['7 Eur', 700],
    ['€ 12,50 EUR', 1250],
    ['12 €', 1200],
    ['007,10', 710],
    // 0.1 + 0.2 en coma flotante no da 0.3; aquí no hay coma flotante.
    ['0,30', 30],
  ])('"%s" → %i céntimos', (input, cents) => {
    expect(parseEuroAmount(input)).toEqual({ ok: true, cents });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['€', 'empty'],
    ['abc', 'invalid_format'],
    ['12,', 'invalid_format'],
    [',50', 'invalid_format'],
    ['1 234', 'invalid_format'],
    ['1.23.456', 'invalid_format'],
    ['1.234,56,7', 'invalid_format'],
    ['1.2345', 'too_many_decimals'],
    ['0,001', 'too_many_decimals'],
    ['0.123.456', 'invalid_format'],
    ['1.234,567', 'too_many_decimals'],
    ['+5', 'invalid_format'],
    ['-5', 'negative_not_allowed'],
    ['1e3', 'invalid_format'],
    ['999999999999999999', 'out_of_range'],
  ])('"%s" → error %s', (input, reason) => {
    expect(parseEuroAmount(input)).toEqual({ ok: false, reason });
  });

  it('acepta negativos solo con allowNegative', () => {
    expect(parseEuroAmount('-12,50', { allowNegative: true })).toEqual({ ok: true, cents: -1250 });
    expect(parseEuroAmount('-0', { allowNegative: true })).toEqual({ ok: true, cents: 0 });
  });

  it('acepta el máximo entero seguro y rechaza el siguiente', () => {
    expect(parseEuroAmount('90071992547409,91')).toEqual({
      ok: true,
      cents: Number.MAX_SAFE_INTEGER,
    });
    expect(parseEuroAmount('90071992547409,92')).toEqual({ ok: false, reason: 'out_of_range' });
  });
});

describe('parseEuroAmount: límite de longitud y coste lineal (ReDoS)', () => {
  it('acepta un texto de exactamente la longitud máxima', () => {
    const input = `${'1'.padStart(MAX_AMOUNT_INPUT_LENGTH - 2, ' ')} €`;
    expect(input).toHaveLength(MAX_AMOUNT_INPUT_LENGTH);
    expect(parseEuroAmount(input)).toEqual({ ok: true, cents: 100 });
  });

  it('rechaza un carácter más con too_long', () => {
    expect(parseEuroAmount('1'.repeat(MAX_AMOUNT_INPUT_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('una cadena enorme de espacios falla rápido y por el motivo correcto', () => {
    // Con la regex anterior, el coste era cuadrático en el número de espacios.
    const attack = `${' '.repeat(1_000_000)}x`;
    const start = performance.now();
    const result = parseEuroAmount(attack);
    const elapsedMs = performance.now() - start;
    expect(result).toEqual({ ok: false, reason: 'too_long' });
    expect(elapsedMs).toBeLessThan(50);
  });

  it('dentro del límite, los espacios entre la moneda y el número se toleran', () => {
    expect(parseEuroAmount(`€${' '.repeat(40)}12,50${' '.repeat(10)}`)).toEqual({
      ok: true,
      cents: 1250,
    });
  });

  it('el patrón del ataque, dentro del límite, no es un importe válido', () => {
    expect(parseEuroAmount(`${' '.repeat(50)}x`)).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseEuroAmount(`${' '.repeat(50)}€x`)).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('formatCents', () => {
  it.each([
    [0, '0,00 €'],
    [1, '0,01 €'],
    [1250, '12,50 €'],
    [123456, '1234,56 €'],
    [1234567, '12.345,67 €'],
    [-1250, '-12,50 €'],
    [Number.MAX_SAFE_INTEGER, '90.071.992.547.409,91 €'],
  ])('%i → "%s"', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it('el formato y el análisis son inversos', () => {
    for (const cents of [0, 5, 99, 100, 123456, 987654321, Number.MAX_SAFE_INTEGER]) {
      expect(parseEuroAmount(formatCents(cents))).toEqual({ ok: true, cents });
    }
  });

  it('rechaza valores que no son céntimos enteros', () => {
    expect(() => formatCents(12.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  });
});

describe('isCents / assertCents', () => {
  it('distingue enteros seguros', () => {
    expect(isCents(10)).toBe(true);
    expect(isCents(-10)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(isCents('10')).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(assertCents(42)).toBe(42);
    expect(() => assertCents(0.1 + 0.2)).toThrow(RangeError);
  });
});

describe('parseEuroAmount: rejectAmbiguousComma', () => {
  const strict = { rejectAmbiguousComma: true } as const;

  it('por defecto «12,345» sigue leyéndose como miles (atajo del iPhone)', () => {
    expect(parseEuroAmount('12,345')).toEqual({ ok: true, cents: 1_234_500 });
  });

  it('con la opción, una coma seguida de exactamente 3 cifras y sin más separadores es ambigua', () => {
    for (const text of ['12,345', '1,234', '999,999', '  12,345 €']) {
      expect(parseEuroAmount(text, strict)).toEqual({ ok: false, reason: 'ambiguous_separator' });
    }
  });

  it('con la opción, lo que no es ambiguo se lee igual', () => {
    expect(parseEuroAmount('12,34', strict)).toEqual({ ok: true, cents: 1_234 });
    expect(parseEuroAmount('12,3', strict)).toEqual({ ok: true, cents: 1_230 });
    expect(parseEuroAmount('12', strict)).toEqual({ ok: true, cents: 1_200 });
    expect(parseEuroAmount('1.234', strict)).toEqual({ ok: true, cents: 123_400 });
    expect(parseEuroAmount('1.234,56', strict)).toEqual({ ok: true, cents: 123_456 });
    expect(parseEuroAmount('1,234.56', strict)).toEqual({ ok: true, cents: 123_456 });
    expect(parseEuroAmount('1,234,567', strict)).toEqual({ ok: true, cents: 123_456_700 });
    expect(parseEuroAmount('-12,34', { ...strict, allowNegative: true })).toEqual({
      ok: true,
      cents: -1_234,
    });
  });

  it('«0,001» sigue siendo too_many_decimals', () => {
    expect(parseEuroAmount('0,001', strict)).toEqual({ ok: false, reason: 'too_many_decimals' });
  });
});
