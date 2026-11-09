import { describe, expect, it } from 'vitest';
import {
  budgetMonthSchema,
  copyBudgetsRequestSchema,
  createBudgetRequestSchema,
  createMovementRequestSchema,
  createTransferRequestSchema,
  updateBudgetRequestSchema,
} from '../src/index.ts';

// ASVS 1.4.2: un importe fuera del entero seguro nunca llega al servicio ni a la base de datos.
describe('importes en los esquemas de la API: sin desbordamientos', () => {
  const movement = {
    kind: 'expense',
    accountId: '00000000-0000-4000-8000-000000000001',
    categoryId: '00000000-0000-4000-8000-000000000002',
    bookedOn: '2026-01-15',
  };

  it('acepta el máximo entero seguro y rechaza el siguiente', () => {
    const ok = createMovementRequestSchema.safeParse({
      ...movement,
      amountCents: Number.MAX_SAFE_INTEGER,
    });
    expect(ok.success).toBe(true);
    const tooBig = createMovementRequestSchema.safeParse({
      ...movement,
      amountCents: Number.MAX_SAFE_INTEGER + 1,
    });
    expect(tooBig.success).toBe(false);
  });

  it.each([Infinity, NaN, 1.5, '100'])('rechaza el importe %j', (amountCents) => {
    expect(createMovementRequestSchema.safeParse({ ...movement, amountCents }).success).toBe(false);
  });

  it('las transferencias también rechazan importes fuera del entero seguro', () => {
    const base = {
      fromAccountId: '00000000-0000-4000-8000-000000000001',
      toAccountId: '00000000-0000-4000-8000-000000000003',
      bookedOn: '2026-01-15',
    };
    expect(
      createTransferRequestSchema.safeParse({ ...base, amountCents: Number.MAX_SAFE_INTEGER + 1 })
        .success,
    ).toBe(false);
  });
});

describe('esquemas del presupuesto', () => {
  const categoryId = '00000000-0000-4000-8000-000000000002';

  it('el importe del presupuesto es un entero seguro estrictamente positivo', () => {
    const ok = { month: '2026-10', categoryId };
    expect(createBudgetRequestSchema.safeParse({ ...ok, amountCents: 1 }).success).toBe(true);
    for (const amountCents of [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(createBudgetRequestSchema.safeParse({ ...ok, amountCents }).success).toBe(false);
    }
  });

  it('el mes es YYYY-MM y desde el año 1', () => {
    expect(budgetMonthSchema.safeParse('2026-10').success).toBe(true);
    expect(budgetMonthSchema.safeParse('0001-01').success).toBe(true);
    for (const month of ['0000-12', '2026-00', '2026-13', '2026-10-01', '26-10', '']) {
      expect(budgetMonthSchema.safeParse(month).success).toBe(false);
    }
  });

  it('las peticiones son estrictas: un campo desconocido es un error', () => {
    expect(updateBudgetRequestSchema.safeParse({ amountCents: 5, month: '2026-10' }).success).toBe(
      false,
    );
    expect(copyBudgetsRequestSchema.safeParse({ month: '2026-10', from: '2026-09' }).success).toBe(
      false,
    );
  });
});
