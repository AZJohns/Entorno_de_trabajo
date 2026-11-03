import { describe, expect, it } from 'vitest';
import { createMovementRequestSchema, createTransferRequestSchema } from '../src/index.ts';

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
