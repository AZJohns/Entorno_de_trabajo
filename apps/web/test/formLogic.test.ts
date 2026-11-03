import type { AccountResponse, MovementResponse, TransferResponse } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import {
  buildAccountPatch,
  buildCreateAccount,
  buildCreateMovement,
  buildCreateTransfer,
  buildMovementPatch,
  buildReconciliation,
  buildTransferPatch,
} from '../src/finance/formLogic.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const movementValues = {
  kind: 'expense',
  amount: '12,50',
  accountId: A,
  categoryId: C,
  bookedOn: '2026-10-10',
  description: '  Compra  ',
  merchant: '',
};

const movement: MovementResponse = {
  id: B,
  kind: 'expense',
  amountCents: 1_250,
  description: 'Compra',
  merchant: null,
  accountId: A,
  categoryId: C,
  bookedOn: '2026-10-10',
  source: 'manual',
  reconciliationId: null,
  status: 'confirmed',
  flags: [],
  createdAt: '2026-10-10T10:00:00.000Z',
  confirmedAt: '2026-10-10T10:00:00.000Z',
};

describe('buildCreateMovement', () => {
  it('convierte el importe a céntimos y los textos vacíos a null', () => {
    expect(buildCreateMovement(movementValues)).toEqual({
      ok: true,
      value: {
        kind: 'expense',
        amountCents: 1_250,
        accountId: A,
        categoryId: C,
        bookedOn: '2026-10-10',
        description: 'Compra',
        merchant: null,
      },
    });
  });

  it('devuelve un mensaje por campo', () => {
    const result = buildCreateMovement({
      ...movementValues,
      amount: '',
      accountId: '',
      categoryId: '',
      bookedOn: '',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        amount: 'Escribe un importe',
        accountId: 'Este campo es obligatorio',
        categoryId: 'Este campo es obligatorio',
        bookedOn: 'Este campo es obligatorio',
      },
    });
  });

  it('un importe de 0 o negativo no pasa', () => {
    expect(buildCreateMovement({ ...movementValues, amount: '0' })).toMatchObject({ ok: false });
    expect(buildCreateMovement({ ...movementValues, amount: '-3' })).toMatchObject({ ok: false });
  });
});

describe('buildMovementPatch', () => {
  it('sin cambios devuelve null', () => {
    expect(buildMovementPatch(movementValues, movement)).toEqual({ ok: true, value: null });
  });

  it('envía solo lo cambiado', () => {
    expect(
      buildMovementPatch({ ...movementValues, amount: '13', description: '' }, movement),
    ).toEqual({ ok: true, value: { amountCents: 1_300, description: null } });
  });

  it('un borrador pendiente admite importe 0 y sin categoría; uno confirmado, no', () => {
    const draft = { ...movement, status: 'pending' as const, amountCents: 0, categoryId: null };
    const values = { ...movementValues, amount: '0', categoryId: '' };
    expect(buildMovementPatch(values, draft)).toEqual({ ok: true, value: null });
    expect(buildMovementPatch(values, movement)).toMatchObject({
      ok: false,
      errors: {
        amount: 'El importe debe ser mayor que 0',
        categoryId: 'Este campo es obligatorio',
      },
    });
  });
});

describe('cuentas', () => {
  const values = {
    name: ' Ahorro ',
    type: 'savings',
    openingBalance: '',
    openingDate: '2026-01-01',
  };
  const account: AccountResponse = {
    id: A,
    name: 'Ahorro',
    type: 'savings',
    currency: 'EUR',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    balanceCents: 0,
    archived: false,
  };

  it('el saldo de apertura vacío es 0 y admite negativos', () => {
    expect(buildCreateAccount(values)).toMatchObject({
      ok: true,
      value: { openingBalanceCents: 0 },
    });
    expect(buildCreateAccount({ ...values, openingBalance: '-1.000,50' })).toMatchObject({
      ok: true,
      value: { openingBalanceCents: -100_050 },
    });
  });

  it('un saldo no válido y un nombre vacío dan error en su campo', () => {
    expect(buildCreateAccount({ ...values, name: '  ', openingBalance: 'x' })).toMatchObject({
      ok: false,
      errors: { openingBalance: expect.stringContaining('Importe no válido') as string },
    });
    const noName = buildCreateAccount({ ...values, name: '  ' });
    expect(noName.ok === false && 'name' in noName.errors).toBe(true);
  });

  it('el PATCH solo lleva lo cambiado', () => {
    expect(buildAccountPatch(values, account)).toEqual({ ok: true, value: null });
    expect(buildAccountPatch({ ...values, openingBalance: '5' }, account)).toEqual({
      ok: true,
      value: { openingBalanceCents: 500 },
    });
  });
});

describe('transferencias', () => {
  const values = {
    fromAccountId: A,
    toAccountId: B,
    amount: '50',
    bookedOn: '2026-10-10',
    note: '',
  };
  const transfer: TransferResponse = {
    id: C,
    fromAccountId: A,
    toAccountId: B,
    amountCents: 5_000,
    bookedOn: '2026-10-10',
    note: null,
    createdAt: '2026-10-10T10:00:00.000Z',
  };

  it('origen y destino iguales: error en el destino', () => {
    expect(buildCreateTransfer({ ...values, toAccountId: A })).toMatchObject({
      ok: false,
      errors: { toAccountId: 'El origen y el destino deben ser cuentas distintas' },
    });
  });

  it('alta y PATCH', () => {
    expect(buildCreateTransfer(values)).toMatchObject({ ok: true, value: { amountCents: 5_000 } });
    expect(buildTransferPatch(values, transfer)).toEqual({ ok: true, value: null });
    expect(buildTransferPatch({ ...values, note: 'Ahorro' }, transfer)).toEqual({
      ok: true,
      value: { note: 'Ahorro' },
    });
  });
});

describe('buildReconciliation', () => {
  const values = { month: '2026-10', asOf: '2026-10-31', statementBalance: '1.234,56', note: '' };

  it('convierte el saldo del banco y admite negativos y 0', () => {
    expect(buildReconciliation(values)).toEqual({
      ok: true,
      value: { month: '2026-10', asOf: '2026-10-31', statementBalanceCents: 123_456, note: null },
    });
    expect(buildReconciliation({ ...values, statementBalance: '-20' })).toMatchObject({
      ok: true,
      value: { statementBalanceCents: -2_000 },
    });
    expect(buildReconciliation({ ...values, statementBalance: '0' })).toMatchObject({
      ok: true,
      value: { statementBalanceCents: 0 },
    });
  });

  it('la fecha debe estar dentro del mes', () => {
    expect(buildReconciliation({ ...values, asOf: '2026-11-01' })).toEqual({
      ok: false,
      errors: { asOf: 'La fecha del saldo debe estar dentro del mes conciliado' },
    });
  });

  it('un saldo vacío o no válido da error en su campo', () => {
    expect(buildReconciliation({ ...values, statementBalance: '' })).toEqual({
      ok: false,
      errors: { statementBalance: 'Escribe un importe' },
    });
    expect(buildReconciliation({ ...values, statementBalance: '1,2,3' })).toMatchObject({
      ok: false,
    });
  });
});
