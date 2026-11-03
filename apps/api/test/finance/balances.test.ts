import { describe, expect, it } from 'vitest';
import { balanceAsOf, monthlyTotals } from '../../src/modules/finance/ledger/domain/balances.ts';
import {
  assertLocalDate,
  isInMonth,
  isLocalDate,
} from '../../src/modules/finance/ledger/domain/dates.ts';
import { ACCOUNT, OTHER_ACCOUNT, ledger, movement, transfer } from './ledger-fixtures.ts';

describe('fechas contables', () => {
  it.each([
    ['2026-11-03', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2100-02-29', false],
    ['2000-02-29', true],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-04-31', false],
    ['2026-1-03', false],
    ['2026-11-03T00:00:00Z', false],
    ['', false],
  ])('isLocalDate(%j) = %s', (value, expected) => {
    expect(isLocalDate(value)).toBe(expected);
  });

  it('assertLocalDate lanza RangeError con una fecha imposible', () => {
    expect(() => {
      assertLocalDate('2026-02-30');
    }).toThrow(RangeError);
  });

  it('isInMonth compara año y mes, no solo el mes', () => {
    expect(isInMonth('2026-10-31', '2026-10-01')).toBe(true);
    expect(isInMonth('2025-10-31', '2026-10-01')).toBe(false);
    expect(isInMonth('2026-11-01', '2026-10-01')).toBe(false);
  });
});

describe('balanceAsOf', () => {
  it('sin movimientos, el saldo es el de apertura (también negativo)', () => {
    expect(balanceAsOf(ledger({ openingBalanceCents: 120_000 }), null)).toBe(120_000);
    expect(balanceAsOf(ledger({ openingBalanceCents: -5_000 }), null)).toBe(-5_000);
  });

  it('suma ingresos y resta gastos', () => {
    const l = ledger({
      openingBalanceCents: 100_000,
      movements: [
        movement({ kind: 'income', amountCents: 200_050 }),
        movement({ kind: 'expense', amountCents: 4_599 }),
        movement({ kind: 'expense', amountCents: 1 }),
      ],
    });
    expect(balanceAsOf(l, null)).toBe(100_000 + 200_050 - 4_599 - 1);
  });

  it('ignora los movimientos pendientes', () => {
    const l = ledger({
      openingBalanceCents: 1_000,
      movements: [movement({ status: 'pending', amountCents: 999 })],
    });
    expect(balanceAsOf(l, null)).toBe(1_000);
  });

  it('ignora los movimientos de otras cuentas y los que no tienen cuenta', () => {
    const l = ledger({
      movements: [
        movement({ accountId: OTHER_ACCOUNT, amountCents: 700 }),
        movement({ accountId: null, status: 'pending', amountCents: 0 }),
        movement({ kind: 'income', amountCents: 300 }),
      ],
    });
    expect(balanceAsOf(l, null)).toBe(300);
  });

  it('las transferencias suman en el destino y restan en el origen', () => {
    const t = transfer({ amountCents: 5_000 });
    const origin = ledger({ accountId: ACCOUNT, openingBalanceCents: 10_000, transfers: [t] });
    const destination = ledger({
      accountId: OTHER_ACCOUNT,
      openingBalanceCents: 0,
      transfers: [t],
    });
    expect(balanceAsOf(origin, null)).toBe(5_000);
    expect(balanceAsOf(destination, null)).toBe(5_000);
  });

  it('una transferencia entre cuentas ajenas no cambia el saldo', () => {
    const t = transfer({ fromAccountId: 'x', toAccountId: 'y' });
    expect(balanceAsOf(ledger({ openingBalanceCents: 42, transfers: [t] }), null)).toBe(42);
  });

  it('una transferencia no altera la suma de los saldos de las dos cuentas', () => {
    const t = transfer({ amountCents: 12_345 });
    const before = [
      ledger({ accountId: ACCOUNT, openingBalanceCents: 50_000 }),
      ledger({ accountId: OTHER_ACCOUNT, openingBalanceCents: 8_000 }),
    ];
    const total = (ledgers: typeof before): number =>
      ledgers.reduce((sum, l) => sum + balanceAsOf(l, null), 0);
    const after = before.map((l) => ({ ...l, transfers: [t] }));
    expect(total(after)).toBe(total(before));
  });

  it('asOf incluye el propio día y excluye los posteriores (movimientos y transferencias)', () => {
    const l = ledger({
      movements: [
        movement({ kind: 'income', amountCents: 100, bookedOn: '2026-10-14' }),
        movement({ kind: 'income', amountCents: 10, bookedOn: '2026-10-15' }),
        movement({ kind: 'income', amountCents: 1, bookedOn: '2026-10-16' }),
      ],
      transfers: [
        transfer({
          toAccountId: ACCOUNT,
          fromAccountId: OTHER_ACCOUNT,
          amountCents: 1000,
          bookedOn: '2026-10-15',
        }),
        transfer({
          toAccountId: ACCOUNT,
          fromAccountId: OTHER_ACCOUNT,
          amountCents: 10000,
          bookedOn: '2026-10-16',
        }),
      ],
    });
    expect(balanceAsOf(l, '2026-10-15')).toBe(100 + 10 + 1000);
    expect(balanceAsOf(l, '2026-10-14')).toBe(100);
    expect(balanceAsOf(l, null)).toBe(100 + 10 + 1 + 1000 + 10000);
  });

  it('los ajustes de conciliación cuentan en el saldo', () => {
    const l = ledger({
      openingBalanceCents: 1_000,
      movements: [
        movement({
          kind: 'income',
          amountCents: 250,
          source: 'reconciliation',
          reconciliationId: 'r1',
        }),
      ],
    });
    expect(balanceAsOf(l, null)).toBe(1_250);
  });

  it('excludeReconciliationId deja fuera solo el ajuste indicado', () => {
    const l = ledger({
      movements: [
        movement({
          kind: 'income',
          amountCents: 250,
          source: 'reconciliation',
          reconciliationId: 'r1',
        }),
        movement({
          kind: 'expense',
          amountCents: 40,
          source: 'reconciliation',
          reconciliationId: 'r0',
        }),
      ],
    });
    expect(balanceAsOf(l, null, { excludeReconciliationId: 'r1' })).toBe(-40);
  });

  it('rechaza una fecha inválida y un importe no entero', () => {
    expect(() => balanceAsOf(ledger(), '2026-02-30')).toThrow(RangeError);
    expect(() =>
      balanceAsOf(ledger({ movements: [movement({ amountCents: 10.5 })] }), null),
    ).toThrow(RangeError);
  });

  it('falla en vez de perder precisión si la suma supera el entero seguro', () => {
    const l = ledger({
      openingBalanceCents: Number.MAX_SAFE_INTEGER,
      movements: [movement({ kind: 'income', amountCents: 1 })],
    });
    expect(() => balanceAsOf(l, null)).toThrow(RangeError);
  });

  it('suma exacta de importes que en coma flotante fallarían (0,10 + 0,20)', () => {
    const l = ledger({
      movements: [
        movement({ kind: 'income', amountCents: 10 }),
        movement({ kind: 'income', amountCents: 20 }),
      ],
    });
    expect(balanceAsOf(l, null)).toBe(30);
  });
});

describe('monthlyTotals', () => {
  const october = '2026-10-01';

  it('separa ingresos, gastos, neto y ajustes, solo del mes y solo confirmados', () => {
    const totals = monthlyTotals(
      [
        movement({ kind: 'income', amountCents: 200_000, bookedOn: '2026-10-01' }),
        movement({ kind: 'expense', amountCents: 30_000, bookedOn: '2026-10-31' }),
        movement({ kind: 'expense', amountCents: 5_000, bookedOn: '2026-09-30' }),
        movement({ kind: 'expense', amountCents: 6_000, bookedOn: '2026-11-01' }),
        movement({ kind: 'expense', amountCents: 7_000, status: 'pending' }),
        movement({
          kind: 'income',
          amountCents: 125,
          source: 'reconciliation',
          reconciliationId: 'r1',
        }),
        movement({
          kind: 'expense',
          amountCents: 25,
          source: 'reconciliation',
          reconciliationId: 'r2',
        }),
      ],
      october,
    );
    expect(totals).toEqual({
      incomeCents: 200_000,
      expenseCents: 30_000,
      netCents: 170_000,
      adjustmentsCents: 100,
    });
  });

  it('un mes sin movimientos da ceros', () => {
    expect(monthlyTotals([], october)).toEqual({
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
      adjustmentsCents: 0,
    });
  });

  it('las transferencias mueven el saldo pero no los gastos ni los ingresos', () => {
    const movements = [
      movement({ kind: 'income', amountCents: 100_000 }),
      movement({ kind: 'expense', amountCents: 20_000 }),
    ];
    const t = transfer({ amountCents: 50_000 });
    const withoutTransfer = ledger({ openingBalanceCents: 1_000, movements });
    const withTransfer = ledger({ openingBalanceCents: 1_000, movements, transfers: [t] });

    // El saldo cambia en el importe de la transferencia…
    expect(balanceAsOf(withTransfer, null)).toBe(balanceAsOf(withoutTransfer, null) - 50_000);
    // …pero los totales del mes no pueden cambiar: la función ni siquiera recibe transferencias.
    expect(monthlyTotals(withTransfer.movements, october)).toEqual(
      monthlyTotals(withoutTransfer.movements, october),
    );
    expect(monthlyTotals(withTransfer.movements, october).expenseCents).toBe(20_000);
  });

  it('variación del saldo total en el mes = netCents + adjustmentsCents (las transferencias se anulan)', () => {
    const [a, b, c] = ['account-a', 'account-b', 'account-c'];
    const movements = [
      // Dentro de octubre, en varias cuentas, con un ajuste de cada signo.
      movement({ accountId: a, kind: 'income', amountCents: 250_000, bookedOn: '2026-10-01' }),
      movement({ accountId: a, kind: 'expense', amountCents: 41_999, bookedOn: '2026-10-12' }),
      movement({ accountId: b, kind: 'expense', amountCents: 3_333, bookedOn: '2026-10-31' }),
      movement({ accountId: c, kind: 'income', amountCents: 1_000, bookedOn: '2026-10-15' }),
      movement({
        accountId: a,
        kind: 'income',
        amountCents: 250,
        bookedOn: '2026-10-20',
        source: 'reconciliation',
        reconciliationId: 'r1',
      }),
      movement({
        accountId: b,
        kind: 'expense',
        amountCents: 900,
        bookedOn: '2026-10-25',
        source: 'reconciliation',
        reconciliationId: 'r2',
      }),
      // Fuera del mes o sin confirmar: no cuentan ni en los saldos ni en los totales.
      movement({ accountId: a, kind: 'expense', amountCents: 7_000, bookedOn: '2026-09-30' }),
      movement({ accountId: b, kind: 'income', amountCents: 8_000, bookedOn: '2026-11-01' }),
      movement({ accountId: c, kind: 'expense', amountCents: 9_000, status: 'pending' }),
    ];
    const transfers = [
      // Dentro del mes, en cadena y en ambos sentidos.
      transfer({ fromAccountId: a, toAccountId: b, amountCents: 100_000, bookedOn: '2026-10-05' }),
      transfer({ fromAccountId: b, toAccountId: c, amountCents: 12_345, bookedOn: '2026-10-06' }),
      transfer({ fromAccountId: c, toAccountId: a, amountCents: 1, bookedOn: '2026-10-31' }),
      // Fuera del mes.
      transfer({ fromAccountId: a, toAccountId: c, amountCents: 5_000, bookedOn: '2026-09-30' }),
    ];
    const accounts = [
      ledger({ accountId: a, openingBalanceCents: 500_000, movements, transfers }),
      ledger({ accountId: b, openingBalanceCents: 20_000, movements, transfers }),
      ledger({ accountId: c, openingBalanceCents: -3_000, movements, transfers }),
    ];
    const total = (asOf: string): number =>
      accounts.reduce((sum, account) => sum + balanceAsOf(account, asOf), 0);

    const totals = monthlyTotals(movements, october);
    expect(total('2026-10-31') - total('2026-09-30')).toBe(
      totals.netCents + totals.adjustmentsCents,
    );
    // Y no es una igualdad trivial: el mes tiene ingresos, gastos y ajustes de verdad.
    expect(totals).toEqual({
      incomeCents: 251_000,
      expenseCents: 45_332,
      netCents: 205_668,
      adjustmentsCents: -650,
    });
  });

  it('rechaza un mes inválido', () => {
    expect(() => monthlyTotals([], '2026-10-32')).toThrow(RangeError);
  });
});
