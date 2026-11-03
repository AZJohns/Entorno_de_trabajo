import { describe, expect, it } from 'vitest';
import {
  balanceAsOf,
  type AccountLedger,
} from '../../src/modules/finance/ledger/domain/balances.ts';
import {
  RECONCILIATION_ADJUSTMENT_DESCRIPTION,
  reconcile,
  reconciliationDiscrepancy,
  type AdjustmentDraft,
} from '../../src/modules/finance/ledger/domain/reconciliation.ts';
import { ledger, movement, transfer } from './ledger-fixtures.ts';

/** Saldo calculado = 100.000 - 20.000 + 5.000 (transferencia recibida) = 85.000 el 15 de octubre. */
function baseLedger(): AccountLedger {
  return ledger({
    openingBalanceCents: 100_000,
    movements: [
      movement({ kind: 'expense', amountCents: 20_000, bookedOn: '2026-10-05' }),
      // Posterior a as_of: no cuenta en la conciliación del día 15.
      movement({ kind: 'expense', amountCents: 9_999, bookedOn: '2026-10-20' }),
    ],
    transfers: [
      transfer({
        fromAccountId: 'account-b',
        toAccountId: 'account-a',
        amountCents: 5_000,
        bookedOn: '2026-10-08',
      }),
    ],
  });
}

const month = '2026-10-01';
const asOf = '2026-10-15';

/** Aplica el ajuste al libro como lo haría el servicio al guardarlo. */
function withAdjustment(
  l: AccountLedger,
  draft: AdjustmentDraft,
  reconciliationId: string,
): AccountLedger {
  return {
    ...l,
    movements: [
      ...l.movements,
      movement({
        kind: draft.kind,
        amountCents: draft.amountCents,
        bookedOn: draft.bookedOn,
        source: 'reconciliation',
        reconciliationId,
      }),
    ],
  };
}

describe('reconcile', () => {
  it('con diferencia 0 no crea ajuste', () => {
    const result = reconcile({ ledger: baseLedger(), month, asOf, statementBalanceCents: 85_000 });
    expect(result).toEqual({ computedBalanceCents: 85_000, differenceCents: 0, adjustment: null });
  });

  it('con diferencia positiva crea un ajuste de ingreso', () => {
    const result = reconcile({ ledger: baseLedger(), month, asOf, statementBalanceCents: 85_250 });
    expect(result.computedBalanceCents).toBe(85_000);
    expect(result.differenceCents).toBe(250);
    expect(result.adjustment).toEqual({
      kind: 'income',
      amountCents: 250,
      bookedOn: asOf,
      description: RECONCILIATION_ADJUSTMENT_DESCRIPTION,
    });
  });

  it('con diferencia negativa crea un ajuste de gasto por el valor absoluto', () => {
    const result = reconcile({ ledger: baseLedger(), month, asOf, statementBalanceCents: 84_100 });
    expect(result.differenceCents).toBe(-900);
    expect(result.adjustment).toEqual({
      kind: 'expense',
      amountCents: 900,
      bookedOn: asOf,
      description: RECONCILIATION_ADJUSTMENT_DESCRIPTION,
    });
  });

  it.each([85_250, 84_100, 85_000, 0, -300, 1])(
    'tras conciliar, el saldo calculado es el del banco (%i)',
    (statement) => {
      const result = reconcile({
        ledger: baseLedger(),
        month,
        asOf,
        statementBalanceCents: statement,
      });
      const after =
        result.adjustment === null
          ? baseLedger()
          : withAdjustment(baseLedger(), result.adjustment, 'r1');
      expect(balanceAsOf(after, asOf)).toBe(statement);
    },
  );

  it('funciona con saldos negativos (descubierto)', () => {
    const l = ledger({ openingBalanceCents: -1_000 });
    const result = reconcile({ ledger: l, month, asOf, statementBalanceCents: -1_500 });
    expect(result.adjustment).toMatchObject({ kind: 'expense', amountCents: 500 });
  });

  it('el saldo de una conciliación anterior incluye su ajuste', () => {
    // Septiembre se concilió con un ajuste de +250; la conciliación de octubre parte de ahí.
    const september = withAdjustment(
      ledger({ openingBalanceCents: 10_000 }),
      { kind: 'income', amountCents: 250, bookedOn: '2026-09-30', description: 'x' },
      'r-sep',
    );
    const result = reconcile({ ledger: september, month, asOf, statementBalanceCents: 10_250 });
    expect(result.adjustment).toBeNull();
  });

  it('rechaza un mes que no es el día 1, un asOf fuera del mes y fechas inválidas', () => {
    const base = { ledger: baseLedger(), statementBalanceCents: 0 };
    expect(() => reconcile({ ...base, month: '2026-10-02', asOf })).toThrow(RangeError);
    expect(() => reconcile({ ...base, month, asOf: '2026-11-01' })).toThrow(RangeError);
    expect(() => reconcile({ ...base, month, asOf: '2025-10-15' })).toThrow(RangeError);
    expect(() => reconcile({ ...base, month, asOf: '2026-10-32' })).toThrow(RangeError);
  });

  it('rechaza un saldo del banco que no es un entero de céntimos', () => {
    expect(() =>
      reconcile({ ledger: baseLedger(), month, asOf, statementBalanceCents: 10.5 }),
    ).toThrow(RangeError);
  });
});

describe('reconciliationDiscrepancy', () => {
  /** Concilia octubre con una diferencia y devuelve el libro con el ajuste y lo registrado. */
  function reconciled(statement: number): {
    l: AccountLedger;
    recorded: { id: string; asOf: string; computedBalanceCents: number };
  } {
    const result = reconcile({
      ledger: baseLedger(),
      month,
      asOf,
      statementBalanceCents: statement,
    });
    const l =
      result.adjustment === null
        ? baseLedger()
        : withAdjustment(baseLedger(), result.adjustment, 'r1');
    return { l, recorded: { id: 'r1', asOf, computedBalanceCents: result.computedBalanceCents } };
  }

  it('recién conciliada no hay discrepancia, con ajuste o sin él', () => {
    for (const statement of [85_000, 85_250, 84_100]) {
      const { l, recorded } = reconciled(statement);
      expect(reconciliationDiscrepancy(l, recorded)).toEqual({
        recordedCents: 85_000,
        currentCents: 85_000,
        differenceCents: 0,
        hasDiscrepancy: false,
      });
    }
  });

  it('un movimiento editado después del periodo produce un aviso de discrepancia', () => {
    const { l, recorded } = reconciled(85_250);
    // El gasto del 5 de octubre pasa de 20.000 a 18.000: el saldo calculado sube 2.000.
    const edited: AccountLedger = {
      ...l,
      movements: l.movements.map((m) =>
        m.amountCents === 20_000 ? { ...m, amountCents: 18_000 } : m,
      ),
    };
    const result = reconciliationDiscrepancy(edited, recorded);
    expect(result.hasDiscrepancy).toBe(true);
    expect(result.differenceCents).toBe(2_000);
    expect(result.recordedCents).toBe(85_000);
    expect(result.currentCents).toBe(87_000);
    // Es lo mismo que comparar el saldo actual (con el ajuste) con el del banco.
    expect(balanceAsOf(edited, asOf) - 85_250).toBe(2_000);
  });

  it('un movimiento añadido o borrado dentro del periodo también se detecta', () => {
    const { l, recorded } = reconciled(85_000);
    const added = {
      ...l,
      movements: [...l.movements, movement({ bookedOn: '2026-10-10', amountCents: 300 })],
    };
    expect(reconciliationDiscrepancy(added, recorded).differenceCents).toBe(-300);
    const deleted = { ...l, movements: l.movements.filter((m) => m.amountCents !== 20_000) };
    expect(reconciliationDiscrepancy(deleted, recorded).differenceCents).toBe(20_000);
  });

  it('un cambio posterior a asOf no es una discrepancia', () => {
    const { l, recorded } = reconciled(85_000);
    const later = {
      ...l,
      movements: [...l.movements, movement({ bookedOn: '2026-10-16', amountCents: 300 })],
    };
    expect(reconciliationDiscrepancy(later, recorded).hasDiscrepancy).toBe(false);
  });
});
