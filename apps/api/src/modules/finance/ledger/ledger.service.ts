/**
 * Reglas de negocio del libro real: validaciones que dependen de otras filas, transacciones y
 * conciliación. No conoce `req` ni `res`.
 *
 * Códigos de error (la base de datos impone además todas las restricciones de la migración 0003):
 * - 404: el recurso de la URL no existe.
 * - 422 (`UNPROCESSABLE`): el cuerpo es válido pero incoherente con el libro: referencia una cuenta o
 *   categoría que no existe, una categoría de otro tipo, o una fecha anterior a la apertura de la cuenta.
 * - 409 (`CONFLICT`): el estado actual lo impide: cuenta o categoría archivada, ajuste de conciliación
 *   (solo se borra con su conciliación), nombre duplicado, conciliación ya hecha, movimiento ya
 *   confirmado, cuenta con pendientes.
 *
 * Las referencias se comprueban ANTES de insertar. No se traducen los errores de clave ajena de
 * PostgreSQL: `isReferencedRowError` es solo para los borrados, y un 23503 al insertar significaría una
 * referencia inexistente, no un conflicto.
 */
import type { Kysely } from 'kysely';
import {
  formatCents,
  type CreateAccountRequest,
  type CreateCategoryRequest,
  type CreateMovementRequest,
  type CreateReconciliationRequest,
  type CreateTransferRequest,
  type ListMovementsQuery,
  type ListTransfersQuery,
  type UpdateAccountRequest,
  type UpdateMovementRequest,
  type UpdateTransferRequest,
} from '@backoffice/shared';
import type { Database } from '../../../db/schema.ts';
import { isUniqueViolation } from '../../../db/errors.ts';
import { AppError } from '../../../http/errors.ts';
import type { Clock } from '../../../lib/clock.ts';
import type { LocalDate } from './domain/dates.ts';
import { balanceAsOf } from './domain/balances.ts';
import { reconcile, reconciliationDiscrepancy } from './domain/reconciliation.ts';
import {
  LedgerRepository,
  type AccountRecord,
  type CategoryRecord,
  type MovementRecord,
  type PageCursor,
  type ReconciliationRecord,
  type TransferRecord,
} from './ledger.repository.ts';

export interface LedgerServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Página de una lista paginada por cursor. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Conciliación con su ajuste y la discrepancia actual. */
export interface ReconciliationView extends ReconciliationRecord {
  readonly adjustmentMovementId: string | null;
  readonly discrepancy: {
    readonly currentBalanceCents: number;
    readonly differenceCents: number;
    readonly hasDiscrepancy: boolean;
  };
}

export interface ReconcileOutcome {
  readonly id: string;
  readonly computedBalanceCents: number;
  readonly differenceCents: number;
  readonly adjustmentMovementId: string | undefined;
}

const NAME_IN_USE_ACCOUNT = 'accounts_active_name_key';
const NAME_IN_USE_CATEGORY = 'categories_kind_name_key';
const RECONCILIATION_EXISTS = 'account_reconciliations_account_month_key';

function unprocessable(path: string, message: string): AppError {
  return new AppError('UNPROCESSABLE', 422, message, [{ path, message }]);
}

function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message);
}

function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', 404, `${what} no existe`);
}

/** Cursor opaco: `fecha|id` en base64url. No es un secreto, solo evita que el cliente lo construya. */
function encodeCursor(row: { bookedOn: LocalDate; id: string }): string {
  return Buffer.from(`${row.bookedOn}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): PageCursor | null {
  if (cursor === undefined) return null;
  const [bookedOn = '', id = ''] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const valid =
    /^\d{4}-\d{2}-\d{2}$/u.test(bookedOn) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id);
  if (!valid) {
    throw new AppError('VALIDATION_ERROR', 400, 'Cursor no válido', [
      { path: 'cursor', message: 'Cursor no válido' },
    ]);
  }
  return { bookedOn, id };
}

/** Recorta la fila extra que pidió el repositorio y calcula el cursor de la página siguiente. */
function toPage<T extends { bookedOn: LocalDate; id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
  };
}

export class LedgerService {
  readonly #deps: LedgerServiceDeps;
  readonly #repo: LedgerRepository;

  constructor(deps: LedgerServiceDeps) {
    this.#deps = deps;
    this.#repo = new LedgerRepository(deps.db);
  }

  /** Ejecuta `work` en una transacción con un repositorio ligado a ella. */
  #transaction<T>(work: (repo: LedgerRepository) => Promise<T>): Promise<T> {
    return this.#deps.db.transaction().execute((trx) => work(new LedgerRepository(trx)));
  }

  // --- comprobaciones compartidas ---------------------------------------------------------------

  /** La cuenta a la que se refiere el CUERPO de la petición: si no existe, 422. */
  async #referencedAccount(
    repo: LedgerRepository,
    id: string,
    path: string,
  ): Promise<AccountRecord> {
    const account = await repo.findAccount(id);
    if (account === undefined) throw unprocessable(path, 'La cuenta no existe');
    return account;
  }

  /** La categoría a la que se refiere el CUERPO de la petición: si no existe, 422. */
  async #referencedCategory(repo: LedgerRepository, id: string): Promise<CategoryRecord> {
    const category = await repo.findCategory(id);
    if (category === undefined) throw unprocessable('categoryId', 'La categoría no existe');
    return category;
  }

  /** Una cuenta archivada queda congelada: no admite movimientos, transferencias ni conciliaciones. */
  #assertNotArchived(account: AccountRecord): void {
    if (account.archivedAt !== null) {
      throw conflict(`La cuenta «${account.name}» está archivada`);
    }
  }

  /**
   * El saldo de apertura es el del inicio del día `openingDate`: lo anterior a esa fecha no tiene
   * sentido en la cuenta, y el saldo calculado no lo tendría en cuenta de forma coherente.
   */
  #assertNotBeforeOpening(date: LocalDate, account: AccountRecord, path: string): void {
    if (date < account.openingDate) {
      throw unprocessable(
        path,
        `La fecha es anterior a la apertura de la cuenta «${account.name}» (${account.openingDate})`,
      );
    }
  }

  #assertCategoryMatches(category: CategoryRecord, kind: 'income' | 'expense'): void {
    if (category.kind !== kind) {
      throw unprocessable(
        'categoryId',
        'El tipo de la categoría no coincide con el del movimiento',
      );
    }
  }

  // --- cuentas ----------------------------------------------------------------------------------

  listAccounts(includeArchived: boolean): Promise<AccountRecord[]> {
    return this.#repo.listAccounts(includeArchived);
  }

  async getAccount(id: string): Promise<AccountRecord> {
    const account = await this.#repo.findAccount(id);
    if (account === undefined) throw notFound('La cuenta');
    return account;
  }

  async createAccount(input: CreateAccountRequest): Promise<AccountRecord> {
    try {
      return await this.#repo.insertAccount(input);
    } catch (error) {
      if (isUniqueViolation(error, NAME_IN_USE_ACCOUNT)) {
        throw conflict('Ya existe una cuenta activa con ese nombre');
      }
      throw error;
    }
  }

  async updateAccount(id: string, input: UpdateAccountRequest): Promise<AccountRecord> {
    return this.#transaction(async (repo) => {
      const account = await repo.findAccount(id);
      if (account === undefined) throw notFound('La cuenta');
      this.#assertNotArchived(account);

      if (input.openingDate !== undefined && input.openingDate > account.openingDate) {
        // Adelantar la apertura dejaría movimientos anteriores a ella.
        const earliest = await repo.earliestActivityDate(id);
        if (earliest !== null && earliest < input.openingDate) {
          throw unprocessable(
            'openingDate',
            `La cuenta tiene actividad desde el ${earliest}, anterior a la nueva fecha de apertura`,
          );
        }
      }
      try {
        const updated = await repo.updateAccount(id, input, this.#deps.clock.now());
        if (updated === undefined) throw notFound('La cuenta');
        return updated;
      } catch (error) {
        if (isUniqueViolation(error, NAME_IN_USE_ACCOUNT)) {
          throw conflict('Ya existe una cuenta activa con ese nombre');
        }
        throw error;
      }
    });
  }

  /**
   * Archiva la cuenta (idempotente). Una cuenta archivada queda congelada, así que solo se archiva si
   * no deja nada vivo: sin movimientos pendientes (hay que confirmarlos o borrarlos) y con saldo 0.
   *
   * El saldo es el actual, sin fecha: cuentan todos los movimientos confirmados y las transferencias,
   * también los de fecha futura. Un ajuste de conciliación que lo deje en 0 vale igual que cualquier
   * otro movimiento. Se lee dentro de la transacción junto con el recuento de pendientes.
   */
  async archiveAccount(id: string): Promise<AccountRecord> {
    return this.#transaction(async (repo) => {
      const account = await repo.findAccount(id);
      if (account === undefined) throw notFound('La cuenta');
      if (account.archivedAt !== null) return account;
      if ((await repo.countPendingMovements(id)) > 0) {
        throw conflict(
          'La cuenta tiene movimientos pendientes: confírmalos o bórralos antes de archivarla',
        );
      }
      const balance = balanceAsOf(await repo.loadLedger(account), null);
      if (balance !== 0) {
        throw conflict(
          `Para archivar la cuenta, su saldo debe ser 0 (ahora: ${formatCents(balance)}). Vacíala antes con una transferencia`,
        );
      }
      await repo.archiveAccount(id, this.#deps.clock.now());
      const archived = await repo.findAccount(id);
      if (archived === undefined) throw notFound('La cuenta');
      return archived;
    });
  }

  // --- categorías -------------------------------------------------------------------------------

  listCategories(includeArchived: boolean): Promise<CategoryRecord[]> {
    return this.#repo.listCategories(includeArchived);
  }

  async createCategory(input: CreateCategoryRequest): Promise<CategoryRecord> {
    try {
      return await this.#repo.insertCategory(input);
    } catch (error) {
      if (isUniqueViolation(error, NAME_IN_USE_CATEGORY)) {
        throw conflict('Ya existe una categoría de ese tipo con ese nombre');
      }
      throw error;
    }
  }

  async renameCategory(id: string, name: string): Promise<CategoryRecord> {
    const category = await this.#repo.findCategory(id);
    if (category === undefined) throw notFound('La categoría');
    if (category.archivedAt !== null) throw conflict('La categoría está archivada');
    try {
      const updated = await this.#repo.renameCategory(id, name, this.#deps.clock.now());
      if (updated === undefined) throw notFound('La categoría');
      return updated;
    } catch (error) {
      if (isUniqueViolation(error, NAME_IN_USE_CATEGORY)) {
        throw conflict('Ya existe una categoría de ese tipo con ese nombre');
      }
      throw error;
    }
  }

  /** Archiva la categoría (idempotente). Los movimientos que la usan la conservan. */
  async archiveCategory(id: string): Promise<CategoryRecord> {
    const category = await this.#repo.findCategory(id);
    if (category === undefined) throw notFound('La categoría');
    if (category.archivedAt !== null) return category;
    await this.#repo.archiveCategory(id, this.#deps.clock.now());
    const archived = await this.#repo.findCategory(id);
    if (archived === undefined) throw notFound('La categoría');
    return archived;
  }

  // --- movimientos ------------------------------------------------------------------------------

  /** Alta manual: el movimiento nace completo y confirmado. */
  async createMovement(input: CreateMovementRequest): Promise<MovementRecord> {
    return this.#transaction(async (repo) => {
      const account = await this.#referencedAccount(repo, input.accountId, 'accountId');
      const category = await this.#referencedCategory(repo, input.categoryId);
      this.#assertCategoryMatches(category, input.kind);
      this.#assertNotArchived(account);
      if (category.archivedAt !== null) throw conflict('La categoría está archivada');
      this.#assertNotBeforeOpening(input.bookedOn, account, 'bookedOn');

      return repo.insertMovement({
        kind: input.kind,
        amountCents: input.amountCents,
        description: input.description ?? null,
        merchant: input.merchant ?? null,
        accountId: input.accountId,
        categoryId: input.categoryId,
        bookedOn: input.bookedOn,
        source: 'manual',
        reconciliationId: null,
        status: 'confirmed',
        confirmedAt: this.#deps.clock.now(),
      });
    });
  }

  async getMovement(id: string): Promise<MovementRecord> {
    const movement = await this.#repo.findMovement(id);
    if (movement === undefined) throw notFound('El movimiento');
    return movement;
  }

  async listMovements(query: ListMovementsQuery): Promise<Page<MovementRecord>> {
    const { limit, cursor, ...filter } = query;
    const rows = await this.#repo.listMovements(filter, limit, decodeCursor(cursor));
    return toPage(rows, limit);
  }

  pendingCount(): Promise<number> {
    return this.#repo.countPendingMovements();
  }

  /**
   * Comprueba la cuenta de un movimiento existente: debe existir y no estar archivada (una cuenta
   * archivada queda congelada también para editar o borrar lo que ya tiene).
   */
  async #frozenAccountCheck(repo: LedgerRepository, movement: MovementRecord): Promise<void> {
    if (movement.accountId === null) return;
    const account = await repo.findAccount(movement.accountId);
    if (account !== undefined) this.#assertNotArchived(account);
  }

  /** Los ajustes los crea y borra la conciliación; por la API no se tocan. */
  #assertNotAdjustment(movement: MovementRecord): void {
    if (movement.source === 'reconciliation') {
      throw conflict(
        'Un ajuste de conciliación no se edita ni se borra: borra la conciliación y se borrará con ella',
      );
    }
  }

  /**
   * Valida un movimiento completo tal como quedaría: referencias existentes, tipo de categoría,
   * cuenta no archivada y fecha posterior a la apertura. Si va a quedar confirmado, además debe estar
   * completo (importe > 0, cuenta y categoría).
   *
   * @param previous El movimiento antes del cambio (o `null` en un alta). Una categoría archivada solo
   *   se rechaza si el cambio la asigna: un movimiento antiguo conserva la suya.
   */
  async #validateResult(
    repo: LedgerRepository,
    result: {
      kind: 'income' | 'expense';
      amountCents: number;
      accountId: string | null;
      categoryId: string | null;
      bookedOn: LocalDate;
    },
    status: 'pending' | 'confirmed',
    previous: MovementRecord | null,
  ): Promise<void> {
    if (status === 'confirmed') {
      if (result.amountCents <= 0)
        throw unprocessable('amountCents', 'El importe debe ser mayor que 0');
      if (result.accountId === null) throw unprocessable('accountId', 'Falta la cuenta');
      if (result.categoryId === null) throw unprocessable('categoryId', 'Falta la categoría');
    }
    if (result.accountId !== null) {
      const account = await this.#referencedAccount(repo, result.accountId, 'accountId');
      if (account.id !== previous?.accountId) this.#assertNotArchived(account);
      this.#assertNotBeforeOpening(result.bookedOn, account, 'bookedOn');
    }
    if (result.categoryId !== null) {
      const category = await this.#referencedCategory(repo, result.categoryId);
      this.#assertCategoryMatches(category, result.kind);
      if (category.id !== previous?.categoryId && category.archivedAt !== null) {
        throw conflict('La categoría está archivada');
      }
    }
  }

  async updateMovement(id: string, input: UpdateMovementRequest): Promise<MovementRecord> {
    return this.#transaction(async (repo) => {
      const movement = await repo.findMovement(id);
      if (movement === undefined) throw notFound('El movimiento');
      this.#assertNotAdjustment(movement);
      await this.#frozenAccountCheck(repo, movement);

      const result = {
        kind: input.kind ?? movement.kind,
        amountCents: input.amountCents ?? movement.amountCents,
        accountId: input.accountId ?? movement.accountId,
        categoryId: input.categoryId === undefined ? movement.categoryId : input.categoryId,
        bookedOn: input.bookedOn ?? movement.bookedOn,
      };
      await this.#validateResult(repo, result, movement.status, movement);

      const updated = await repo.updateMovement(
        id,
        { ...input, ...result },
        this.#deps.clock.now(),
      );
      if (updated === undefined) throw notFound('El movimiento');
      return updated;
    });
  }

  /** Confirma un borrador: debe estar completo. Limpia sus incidencias. */
  async confirmMovement(id: string): Promise<MovementRecord> {
    return this.#transaction(async (repo) => {
      const movement = await repo.findMovement(id);
      if (movement === undefined) throw notFound('El movimiento');
      if (movement.status === 'confirmed') throw conflict('El movimiento ya está confirmado');
      await this.#frozenAccountCheck(repo, movement);
      await this.#validateResult(repo, movement, 'confirmed', movement);

      const confirmed = await repo.confirmMovement(id, this.#deps.clock.now());
      if (confirmed === undefined) throw notFound('El movimiento');
      return confirmed;
    });
  }

  async deleteMovement(id: string): Promise<void> {
    await this.#transaction(async (repo) => {
      const movement = await repo.findMovement(id);
      if (movement === undefined) throw notFound('El movimiento');
      this.#assertNotAdjustment(movement);
      await this.#frozenAccountCheck(repo, movement);
      await repo.deleteMovement(id);
    });
  }

  // --- transferencias ---------------------------------------------------------------------------

  async #validateTransfer(
    repo: LedgerRepository,
    result: { fromAccountId: string; toAccountId: string; bookedOn: LocalDate },
    previous: TransferRecord | null,
  ): Promise<void> {
    if (result.fromAccountId === result.toAccountId) {
      const message = 'El origen y el destino deben ser cuentas distintas';
      throw new AppError('VALIDATION_ERROR', 400, message, [{ path: 'toAccountId', message }]);
    }
    const from = await this.#referencedAccount(repo, result.fromAccountId, 'fromAccountId');
    const to = await this.#referencedAccount(repo, result.toAccountId, 'toAccountId');
    // Una cuenta que ya era parte de la transferencia no se vuelve a comprobar: la congelación de las
    // archivadas se aplica antes, sobre la transferencia existente.
    if (from.id !== previous?.fromAccountId) this.#assertNotArchived(from);
    if (to.id !== previous?.toAccountId) this.#assertNotArchived(to);
    this.#assertNotBeforeOpening(result.bookedOn, from, 'bookedOn');
    this.#assertNotBeforeOpening(result.bookedOn, to, 'bookedOn');
  }

  async #frozenTransferCheck(repo: LedgerRepository, transfer: TransferRecord): Promise<void> {
    for (const id of [transfer.fromAccountId, transfer.toAccountId]) {
      const account = await repo.findAccount(id);
      if (account !== undefined) this.#assertNotArchived(account);
    }
  }

  async createTransfer(input: CreateTransferRequest): Promise<TransferRecord> {
    return this.#transaction(async (repo) => {
      await this.#validateTransfer(repo, input, null);
      return repo.insertTransfer({ ...input, note: input.note ?? null });
    });
  }

  async getTransfer(id: string): Promise<TransferRecord> {
    const transfer = await this.#repo.findTransfer(id);
    if (transfer === undefined) throw notFound('La transferencia');
    return transfer;
  }

  async listTransfers(query: ListTransfersQuery): Promise<Page<TransferRecord>> {
    const { limit, cursor, ...filter } = query;
    const rows = await this.#repo.listTransfers(filter, limit, decodeCursor(cursor));
    return toPage(rows, limit);
  }

  async updateTransfer(id: string, input: UpdateTransferRequest): Promise<TransferRecord> {
    return this.#transaction(async (repo) => {
      const transfer = await repo.findTransfer(id);
      if (transfer === undefined) throw notFound('La transferencia');
      await this.#frozenTransferCheck(repo, transfer);

      const result = {
        fromAccountId: input.fromAccountId ?? transfer.fromAccountId,
        toAccountId: input.toAccountId ?? transfer.toAccountId,
        bookedOn: input.bookedOn ?? transfer.bookedOn,
      };
      await this.#validateTransfer(repo, result, transfer);

      const updated = await repo.updateTransfer(id, input, this.#deps.clock.now());
      if (updated === undefined) throw notFound('La transferencia');
      return updated;
    });
  }

  async deleteTransfer(id: string): Promise<void> {
    await this.#transaction(async (repo) => {
      const transfer = await repo.findTransfer(id);
      if (transfer === undefined) throw notFound('La transferencia');
      await this.#frozenTransferCheck(repo, transfer);
      await repo.deleteTransfer(id);
    });
  }

  // --- conciliaciones ---------------------------------------------------------------------------

  /**
   * Concilia una cuenta en un mes: calcula el saldo, lo compara con el del banco y, si difiere, crea
   * el ajuste. La conciliación y el ajuste se guardan en la misma transacción.
   *
   * Conciliar un mes anterior a uno ya conciliado es válido: su ajuste cambia el saldo del posterior,
   * que mostrará una discrepancia.
   */
  async reconcileAccount(
    accountId: string,
    input: CreateReconciliationRequest,
  ): Promise<ReconcileOutcome> {
    try {
      return await this.#transaction(async (repo) => {
        const account = await repo.findAccount(accountId);
        if (account === undefined) throw notFound('La cuenta');
        this.#assertNotArchived(account);
        this.#assertNotBeforeOpening(input.asOf, account, 'asOf');

        const month: LocalDate = `${input.month}-01`;
        const result = reconcile({
          ledger: await repo.loadLedger(account),
          month,
          asOf: input.asOf,
          statementBalanceCents: input.statementBalanceCents,
        });
        const reconciliation = await repo.insertReconciliation({
          accountId,
          month,
          asOf: input.asOf,
          statementBalanceCents: input.statementBalanceCents,
          computedBalanceCents: result.computedBalanceCents,
          note: input.note ?? null,
        });
        let adjustmentMovementId: string | undefined;
        if (result.adjustment !== null) {
          const adjustment = await repo.insertMovement({
            kind: result.adjustment.kind,
            amountCents: result.adjustment.amountCents,
            description: result.adjustment.description,
            merchant: null,
            accountId,
            categoryId: null,
            bookedOn: result.adjustment.bookedOn,
            source: 'reconciliation',
            reconciliationId: reconciliation.id,
            status: 'confirmed',
            confirmedAt: this.#deps.clock.now(),
          });
          adjustmentMovementId = adjustment.id;
        }
        return {
          id: reconciliation.id,
          computedBalanceCents: result.computedBalanceCents,
          differenceCents: result.differenceCents,
          adjustmentMovementId,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error, RECONCILIATION_EXISTS)) {
        throw conflict(
          'Esa cuenta ya está conciliada en ese mes: borra la conciliación para rehacerla',
        );
      }
      throw error;
    }
  }

  /** Historial de conciliaciones de una cuenta, con la discrepancia actual de cada una. */
  async listReconciliations(accountId: string): Promise<ReconciliationView[]> {
    const account = await this.#repo.findAccount(accountId);
    if (account === undefined) throw notFound('La cuenta');
    const [records, ledger] = await Promise.all([
      this.#repo.listReconciliations(accountId),
      this.#repo.loadLedger(account),
    ]);
    const adjustments = await this.#repo.adjustmentIds(records.map((record) => record.id));
    return records.map((record) => {
      const discrepancy = reconciliationDiscrepancy(ledger, {
        asOf: record.asOf,
        statementBalanceCents: record.statementBalanceCents,
      });
      return {
        ...record,
        adjustmentMovementId: adjustments.get(record.id) ?? null,
        discrepancy: {
          currentBalanceCents: discrepancy.currentCents,
          differenceCents: discrepancy.differenceCents,
          hasDiscrepancy: discrepancy.hasDiscrepancy,
        },
      };
    });
  }

  /** Borra la conciliación y, en cascada, su ajuste. */
  async deleteReconciliation(id: string): Promise<void> {
    await this.#transaction(async (repo) => {
      const reconciliation = await repo.findReconciliation(id);
      if (reconciliation === undefined) throw notFound('La conciliación');
      const account = await repo.findAccount(reconciliation.accountId);
      if (account !== undefined) this.#assertNotArchived(account);
      await repo.deleteReconciliation(id);
    });
  }
}
