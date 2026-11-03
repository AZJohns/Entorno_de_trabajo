/** Constructores de filas ficticias para los tests del libro (importes inventados). */
import type {
  AccountLedger,
  LedgerMovement,
  LedgerTransfer,
} from '../../src/modules/finance/ledger/domain/balances.ts';

export const ACCOUNT = 'account-a';
export const OTHER_ACCOUNT = 'account-b';

export function movement(overrides: Partial<LedgerMovement> = {}): LedgerMovement {
  return {
    accountId: ACCOUNT,
    kind: 'expense',
    amountCents: 1000,
    bookedOn: '2026-10-10',
    status: 'confirmed',
    source: 'manual',
    reconciliationId: null,
    ...overrides,
  };
}

export function transfer(overrides: Partial<LedgerTransfer> = {}): LedgerTransfer {
  return {
    fromAccountId: ACCOUNT,
    toAccountId: OTHER_ACCOUNT,
    amountCents: 5000,
    bookedOn: '2026-10-10',
    ...overrides,
  };
}

export function ledger(overrides: Partial<AccountLedger> = {}): AccountLedger {
  return {
    accountId: ACCOUNT,
    openingBalanceCents: 0,
    movements: [],
    transfers: [],
    ...overrides,
  };
}
