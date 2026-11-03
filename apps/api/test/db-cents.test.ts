import { describe, expect, it } from 'vitest';
import { centsFromDb } from '../src/db/cents.ts';

describe('centsFromDb', () => {
  it.each([
    ['0', 0],
    ['125050', 125_050],
    ['-5000', -5000],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [String(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER],
    [42, 42],
  ])('convierte %j en %i', (input, expected) => {
    expect(centsFromDb(input)).toBe(expected);
  });

  it.each([
    String(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    String(BigInt(Number.MIN_SAFE_INTEGER) - 1n),
    '12.5',
    '1e3',
    '',
    ' 7',
    'abc',
    '9223372036854775807',
  ])('rechaza %j', (input) => {
    expect(() => centsFromDb(input)).toThrow(RangeError);
  });

  it('acepta un bigint de JavaScript', () => {
    expect(centsFromDb(42n)).toBe(42);
  });

  it('rechaza un número no entero', () => {
    expect(() => centsFromDb(1.5)).toThrow();
  });
});
