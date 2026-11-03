import { describe, expect, it } from 'vitest';
import { amountToInput, readAmount } from '../src/finance/amount.ts';
import { formatMonth, monthOf, todayLocal } from '../src/finance/dates.ts';

describe('readAmount', () => {
  it.each([
    ['12', 1_200],
    ['12,5', 1_250],
    ['12.50', 1_250],
    ['1.234,56', 123_456],
    ['1.234', 123_400],
    ['1,234,567', 123_456_700],
    ['  0,01 € ', 1],
    ['0,10', 10],
  ])('lee %s como %i céntimos', (text, cents) => {
    expect(readAmount(text)).toEqual({ ok: true, cents });
  });

  it.each([
    ['', 'Escribe un importe'],
    ['abc', 'Importe no válido'],
    ['0,001', 'dos decimales'],
    ['12,345', 'Usa la coma para los céntimos (12,34) o escribe el número sin separadores'],
    ['1,234', 'Usa la coma'],
    ['-5', 'no puede ser negativo'],
    ['0', 'mayor que 0'],
    ['0,00', 'mayor que 0'],
    ['9'.repeat(70), 'demasiado largo'],
  ])('rechaza «%s» con un mensaje en español', (text, fragment) => {
    const result = readAmount(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(fragment);
  });

  it('con opciones admite negativos y el 0', () => {
    expect(readAmount('-12,5', { allowNegative: true })).toEqual({ ok: true, cents: -1_250 });
    expect(readAmount('0', { allowZero: true })).toEqual({ ok: true, cents: 0 });
  });

  it('no pierde precisión con importes que un float no representa', () => {
    // 0,1 + 0,2 en coma flotante da 0,30000000000000004: en céntimos enteros es exacto.
    const a = readAmount('0,10');
    const b = readAmount('0,20');
    expect(a.ok && b.ok ? a.cents + b.cents : null).toBe(30);
    expect(readAmount('90.071.992.547.409,91')).toEqual({ ok: true, cents: 9_007_199_254_740_991 });
  });

  it('amountToInput da un texto que readAmount vuelve a leer igual', () => {
    for (const cents of [0, 1, 99, 100, 123_456, -5, -123_456, 9_007_199_254_740_991]) {
      expect(amountToInput(cents)).toMatch(/^-?\d+,\d{2}$/u);
      expect(readAmount(amountToInput(cents), { allowNegative: true, allowZero: true })).toEqual({
        ok: true,
        cents,
      });
    }
  });
});

describe('fechas', () => {
  it('todayLocal usa el día local, no el de UTC', () => {
    // 31/12 a las 23:30 hora local: toISOString podría dar ya el 1 de enero en UTC+x.
    expect(todayLocal(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
    expect(todayLocal(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
  it('monthOf y formatMonth', () => {
    expect(monthOf('2026-10-15')).toBe('2026-10');
    expect(formatMonth('2026-10')).toBe('octubre de 2026');
  });
});
