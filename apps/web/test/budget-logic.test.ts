import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  buildBudgetAmount,
  buildCreateBudget,
  copyResultMessage,
} from '../src/finance/budgetLogic.ts';

const C = '33333333-3333-4333-8333-333333333333';

describe('budgetStatus', () => {
  it.each([
    // [presupuestado, gastado, estado, porcentaje]
    [10_000, 0, 'ok', 0],
    [10_000, 7_999, 'ok', 79],
    [10_000, 8_000, 'near', 80],
    [10_000, 9_999, 'near', 99],
    [10_000, 10_000, 'near', 100], // gastar justo el límite no lo supera
    [10_000, 10_001, 'over', 100],
    [10_000, 25_000, 'over', 250],
    [10_000, -500, 'ok', 0], // devolución neta: cuenta como 0
  ] as const)('%i presupuestado, %i gastado → %s (%i %%)', (amount, spent, state, percent) => {
    expect(budgetStatus(amount, spent)).toMatchObject({ state, percent });
  });

  it('la barra nunca pasa del 100 % aunque el gasto lo supere', () => {
    expect(budgetStatus(10_000, 25_000).barPercent).toBe(100);
  });

  it('el umbral es exacto: 79,99 % no es «cerca del límite»', () => {
    // 7_999 de 10_000 = 79,99 %: el redondeo a 80 no debe adelantar el aviso.
    expect(budgetStatus(10_000, 7_999).state).toBe('ok');
    expect(budgetStatus(3, 2).state).toBe('ok'); // 66,6 %
    expect(budgetStatus(5, 4).state).toBe('near'); // 80 % exacto con importes pequeños
  });

  it('cada estado trae su texto', () => {
    expect(budgetStatus(100, 10).label).toBe('Dentro del presupuesto');
    expect(budgetStatus(100, 90).label).toBe('Cerca del límite');
    expect(budgetStatus(100, 150).label).toBe('Presupuesto superado');
  });
});

describe('buildBudgetAmount', () => {
  it('convierte el texto a céntimos', () => {
    expect(buildBudgetAmount('300')).toEqual({ ok: true, value: { amountCents: 30_000 } });
    expect(buildBudgetAmount('1.234,56')).toEqual({ ok: true, value: { amountCents: 123_456 } });
  });

  it.each([
    ['', 'Escribe un importe'],
    ['0', 'El importe debe ser mayor que 0'],
    ['-5', 'El importe no puede ser negativo'],
    ['12,345', 'Usa la coma para los céntimos (12,34) o escribe el número sin separadores'],
    ['abc', 'Importe no válido. Ejemplos: 12,50 · 1.234,56'],
  ])('«%s» no es válido', (text, message) => {
    expect(buildBudgetAmount(text)).toEqual({ ok: false, errors: { amount: message } });
  });
});

describe('buildCreateBudget', () => {
  it('arma la petición con el mes de la pantalla', () => {
    expect(buildCreateBudget({ categoryId: C, amount: '250,50' }, '2026-10')).toEqual({
      ok: true,
      value: { month: '2026-10', categoryId: C, amountCents: 25_050 },
    });
  });

  it('pide la categoría y el importe a la vez', () => {
    expect(buildCreateBudget({ categoryId: '', amount: '' }, '2026-10')).toEqual({
      ok: false,
      errors: { amount: 'Escribe un importe', categoryId: 'Este campo es obligatorio' },
    });
  });
});

describe('copyResultMessage', () => {
  const base = { month: '2026-10', sourceMonth: '2026-09' };

  it('cuenta lo copiado y lo omitido', () => {
    expect(copyResultMessage({ ...base, copied: 3, skippedExisting: 1, skippedArchived: 2 })).toBe(
      'Se han copiado 3 presupuestos de septiembre de 2026 (omitidos: 1 ya existían, 2 de categorías archivadas).',
    );
    expect(copyResultMessage({ ...base, copied: 1, skippedExisting: 0, skippedArchived: 0 })).toBe(
      'Se ha copiado 1 presupuesto de septiembre de 2026.',
    );
  });

  it('si ya estaba todo copiado, lo dice', () => {
    expect(copyResultMessage({ ...base, copied: 0, skippedExisting: 2, skippedArchived: 0 })).toBe(
      'No se ha copiado ningún presupuesto de septiembre de 2026 (omitidos: 2 ya existían).',
    );
  });

  it('si el mes anterior no tiene presupuestos (todo a cero), lo dice', () => {
    expect(copyResultMessage({ ...base, copied: 0, skippedExisting: 0, skippedArchived: 0 })).toBe(
      'Septiembre de 2026 no tiene presupuestos que copiar.',
    );
  });
});
