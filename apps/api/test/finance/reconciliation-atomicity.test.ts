/**
 * ASVS 2.3.3 (atomicidad): crear una conciliación y su ajuste es una operación compuesta. Si falla
 * el guardado del ajuste (aquí, forzado en el repositorio), la conciliación tampoco puede quedar
 * guardada: de lo contrario la cuenta quedaría «conciliada» sin el ajuste que cuadra su saldo y no
 * se podría rehacer sin borrarla.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerRepository } from '../../src/modules/finance/ledger/ledger.repository.ts';
import { useAuthTestContext } from '../support/auth.ts';
import { createAccount, resetLedger } from '../support/ledger.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('conciliar: atomicidad conciliación + ajuste', () => {
  it('si falla el guardado del ajuste, la conciliación no queda guardada', async () => {
    const client = await getCtx().loggedIn();
    const account = await createAccount(client);
    const { db } = getCtx().database;
    // El servicio crea su repositorio dentro de la transacción, así que se intercepta el prototipo.
    vi.spyOn(LedgerRepository.prototype, 'insertMovement').mockRejectedValue(
      new Error('fallo simulado al guardar el ajuste'),
    );

    // Diferencia distinta de 0: obliga a crear el ajuste.
    const body = { month: '2026-10', asOf: '2026-10-15', statementBalanceCents: 123_456 };
    const failed = await client.post(`/api/v1/accounts/${account.id}/reconciliations`, body);
    expect(failed.status).toBe(500);

    const reconciliations = await db.selectFrom('account_reconciliations').selectAll().execute();
    const adjustments = await db
      .selectFrom('movements')
      .select('id')
      .where('source', '=', 'reconciliation')
      .execute();
    expect(reconciliations).toEqual([]);
    expect(adjustments).toEqual([]);

    // Sin restos: al quitar el fallo, el mismo mes se puede conciliar (no hay conflicto 409).
    vi.restoreAllMocks();
    const retried = await client.post(`/api/v1/accounts/${account.id}/reconciliations`, body);
    expect(retried.status).toBe(201);
  });
});
