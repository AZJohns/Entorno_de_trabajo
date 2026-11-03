/**
 * Acceso a las tablas del libro real. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción, así que el servicio puede agrupar varias operaciones en una
 * transacción creando un repositorio con la transacción (ASVS 2.3.3).
 *
 * Los importes salen ya convertidos a céntimos (`centsFromDb`) y las fechas contables como
 * `YYYY-MM-DD`; los instantes (`timestamptz`) como `Date`.
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import type { AccountType, MovementKind, MovementSource, MovementStatus } from '@backoffice/shared';
import { centsFromDb } from '../../../db/cents.ts';
import type {
  AccountReconciliationsTable,
  AccountsTable,
  CategoriesTable,
  Database,
  MovementFlag,
  MovementsTable,
  TransfersTable,
} from '../../../db/schema.ts';
import type { AccountLedger, LedgerMovement, LedgerTransfer } from './domain/balances.ts';
import type { LocalDate } from './domain/dates.ts';
import type { CategorizedMovement } from './domain/reports.ts';

export interface AccountRecord {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  /** Saldo al inicio del día `openingDate`. */
  readonly openingBalanceCents: number;
  readonly openingDate: LocalDate;
  readonly archivedAt: Date | null;
}

export interface CategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: MovementKind;
  readonly archivedAt: Date | null;
}

export interface MovementRecord {
  readonly id: string;
  readonly kind: MovementKind;
  readonly amountCents: number;
  readonly description: string | null;
  readonly merchant: string | null;
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly bookedOn: LocalDate;
  readonly source: MovementSource;
  readonly reconciliationId: string | null;
  readonly status: MovementStatus;
  readonly flags: readonly MovementFlag[];
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
}

export interface TransferRecord {
  readonly id: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: number;
  readonly bookedOn: LocalDate;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface ReconciliationRecord {
  readonly id: string;
  readonly accountId: string;
  /** Primer día del mes conciliado (`YYYY-MM-01`). */
  readonly month: LocalDate;
  readonly asOf: LocalDate;
  readonly statementBalanceCents: number;
  readonly computedBalanceCents: number;
  readonly note: string | null;
  readonly createdAt: Date;
}

/** Valores de una cuenta nueva. */
export interface NewAccount {
  readonly name: string;
  readonly type: AccountType;
  readonly openingBalanceCents: number;
  readonly openingDate: LocalDate;
}

/** Valores de un movimiento nuevo (la base de datos valida la coherencia). */
export interface NewMovement {
  readonly kind: MovementKind;
  readonly amountCents: number;
  readonly description: string | null;
  readonly merchant: string | null;
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly bookedOn: LocalDate;
  readonly source: MovementSource;
  readonly reconciliationId: string | null;
  readonly status: MovementStatus;
  readonly confirmedAt: Date | null;
}

/** Filtros y página de la lista de movimientos. */
export interface MovementFilter {
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
  readonly accountId?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly status?: MovementStatus | undefined;
  readonly kind?: MovementKind | undefined;
  readonly source?: MovementSource | undefined;
  readonly q?: string | undefined;
}

/** Posición de un cursor: se ordena por fecha contable y, a igualdad, por id, ambos descendentes. */
export interface PageCursor {
  readonly bookedOn: LocalDate;
  readonly id: string;
}

export interface TransferFilter {
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
  readonly accountId?: string | undefined;
}

type AccountRow = Selectable<AccountsTable>;
type CategoryRow = Selectable<CategoriesTable>;
type MovementRow = Selectable<MovementsTable>;
type TransferRow = Selectable<TransfersTable>;
type ReconciliationRow = Selectable<AccountReconciliationsTable>;

function toAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    openingBalanceCents: centsFromDb(row.opening_balance_cents),
    openingDate: row.opening_date,
    archivedAt: row.archived_at,
  };
}

function toCategory(row: CategoryRow): CategoryRecord {
  return { id: row.id, name: row.name, kind: row.kind, archivedAt: row.archived_at };
}

function toMovement(row: MovementRow): MovementRecord {
  return {
    id: row.id,
    kind: row.kind,
    amountCents: centsFromDb(row.amount_cents),
    description: row.description,
    merchant: row.merchant,
    accountId: row.account_id,
    categoryId: row.category_id,
    bookedOn: row.booked_on,
    source: row.source,
    reconciliationId: row.reconciliation_id,
    status: row.status,
    flags: row.flags,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

function toTransfer(row: TransferRow): TransferRecord {
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    amountCents: centsFromDb(row.amount_cents),
    bookedOn: row.booked_on,
    note: row.note,
    createdAt: row.created_at,
  };
}

function toReconciliation(row: ReconciliationRow): ReconciliationRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    month: row.month,
    asOf: row.as_of,
    statementBalanceCents: centsFromDb(row.statement_balance_cents),
    computedBalanceCents: centsFromDb(row.computed_balance_cents),
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Quita las claves con valor `undefined`: en un PATCH, «no enviado» significa «no cambiar». */
function definedOnly<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Escapa `\`, `%` y `_` para usar un texto del usuario dentro de un `LIKE`. */
function escapeLike(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export class LedgerRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  // --- cuentas ----------------------------------------------------------------------------------

  async listAccounts(includeArchived: boolean): Promise<AccountRecord[]> {
    let query = this.#db.selectFrom('accounts').selectAll();
    if (!includeArchived) query = query.where('archived_at', 'is', null);
    const rows = await query
      .orderBy('archived_at', (ob) => ob.asc().nullsFirst())
      .orderBy('name')
      .execute();
    return rows.map(toAccount);
  }

  async findAccount(id: string): Promise<AccountRecord | undefined> {
    const row = await this.#db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toAccount(row);
  }

  async insertAccount(values: NewAccount): Promise<AccountRecord> {
    const row = await this.#db
      .insertInto('accounts')
      .values({
        name: values.name,
        type: values.type,
        opening_balance_cents: values.openingBalanceCents,
        opening_date: values.openingDate,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAccount(row);
  }

  async updateAccount(
    id: string,
    patch: Partial<NewAccount>,
    now: Date,
  ): Promise<AccountRecord | undefined> {
    const row = await this.#db
      .updateTable('accounts')
      .set({
        ...definedOnly({
          name: patch.name,
          type: patch.type,
          opening_balance_cents: patch.openingBalanceCents,
          opening_date: patch.openingDate,
        }),
        updated_at: now,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toAccount(row);
  }

  async archiveAccount(id: string, now: Date): Promise<void> {
    await this.#db
      .updateTable('accounts')
      .set({ archived_at: now, updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async countPendingMovements(accountId: string | null = null): Promise<number> {
    let query = this.#db
      .selectFrom('movements')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('status', '=', 'pending');
    if (accountId !== null) query = query.where('account_id', '=', accountId);
    const row = await query.executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /**
   * Fecha más antigua con actividad en la cuenta (movimientos de cualquier estado, transferencias y
   * conciliaciones), o `null` si no hay ninguna. Limita cuánto se puede adelantar la fecha de apertura.
   */
  async earliestActivityDate(accountId: string): Promise<LocalDate | null> {
    const { rows } = await sql<{ earliest: string | null }>`
      SELECT min(d)::text AS earliest FROM (
        SELECT booked_on AS d FROM movements WHERE account_id = ${accountId}
        UNION ALL
        SELECT booked_on FROM transfers
          WHERE from_account_id = ${accountId} OR to_account_id = ${accountId}
        UNION ALL
        SELECT as_of FROM account_reconciliations WHERE account_id = ${accountId}
      ) AS activity
    `.execute(this.#db);
    return rows[0]?.earliest ?? null;
  }

  // --- categorías -------------------------------------------------------------------------------

  async listCategories(includeArchived: boolean): Promise<CategoryRecord[]> {
    let query = this.#db.selectFrom('categories').selectAll();
    if (!includeArchived) query = query.where('archived_at', 'is', null);
    const rows = await query.orderBy('kind').orderBy('name').execute();
    return rows.map(toCategory);
  }

  async findCategory(id: string): Promise<CategoryRecord | undefined> {
    const row = await this.#db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toCategory(row);
  }

  async insertCategory(values: { name: string; kind: MovementKind }): Promise<CategoryRecord> {
    const row = await this.#db
      .insertInto('categories')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toCategory(row);
  }

  async renameCategory(id: string, name: string, now: Date): Promise<CategoryRecord | undefined> {
    const row = await this.#db
      .updateTable('categories')
      .set({ name, updated_at: now })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toCategory(row);
  }

  async archiveCategory(id: string, now: Date): Promise<void> {
    await this.#db
      .updateTable('categories')
      .set({ archived_at: now, updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  // --- movimientos ------------------------------------------------------------------------------

  async findMovement(id: string): Promise<MovementRecord | undefined> {
    const row = await this.#db
      .selectFrom('movements')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toMovement(row);
  }

  async insertMovement(values: NewMovement): Promise<MovementRecord> {
    const row = await this.#db
      .insertInto('movements')
      .values({
        kind: values.kind,
        amount_cents: values.amountCents,
        description: values.description,
        merchant: values.merchant,
        account_id: values.accountId,
        category_id: values.categoryId,
        booked_on: values.bookedOn,
        source: values.source,
        reconciliation_id: values.reconciliationId,
        status: values.status,
        confirmed_at: values.confirmedAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toMovement(row);
  }

  /** Cambia los campos indicados. Las claves ausentes (`undefined`) no se tocan; `null` borra el valor. */
  async updateMovement(
    id: string,
    patch: Partial<
      Pick<
        NewMovement,
        | 'kind'
        | 'amountCents'
        | 'description'
        | 'merchant'
        | 'accountId'
        | 'categoryId'
        | 'bookedOn'
      >
    >,
    now: Date,
  ): Promise<MovementRecord | undefined> {
    const row = await this.#db
      .updateTable('movements')
      .set({
        ...definedOnly({
          kind: patch.kind,
          amount_cents: patch.amountCents,
          description: patch.description,
          merchant: patch.merchant,
          account_id: patch.accountId,
          category_id: patch.categoryId,
          booked_on: patch.bookedOn,
        }),
        updated_at: now,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toMovement(row);
  }

  /** Pasa un borrador a confirmado y limpia sus incidencias (un confirmado no puede tenerlas). */
  async confirmMovement(id: string, now: Date): Promise<MovementRecord | undefined> {
    const row = await this.#db
      .updateTable('movements')
      .set({ status: 'confirmed', confirmed_at: now, flags: [], updated_at: now })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toMovement(row);
  }

  async deleteMovement(id: string): Promise<void> {
    await this.#db.deleteFrom('movements').where('id', '=', id).execute();
  }

  /**
   * Movimientos más recientes primero. Pide `limit + 1` filas para que el servicio sepa si hay otra
   * página sin una consulta de recuento.
   */
  async listMovements(
    filter: MovementFilter,
    limit: number,
    after: PageCursor | null,
  ): Promise<MovementRecord[]> {
    let query = this.#db.selectFrom('movements').selectAll();
    if (filter.from !== undefined) query = query.where('booked_on', '>=', filter.from);
    if (filter.to !== undefined) query = query.where('booked_on', '<=', filter.to);
    if (filter.accountId !== undefined) query = query.where('account_id', '=', filter.accountId);
    if (filter.categoryId !== undefined) query = query.where('category_id', '=', filter.categoryId);
    if (filter.status !== undefined) query = query.where('status', '=', filter.status);
    if (filter.kind !== undefined) query = query.where('kind', '=', filter.kind);
    if (filter.source !== undefined) query = query.where('source', '=', filter.source);
    if (filter.q !== undefined) {
      // unaccent: «cafe» encuentra «café». El texto va como parámetro, nunca concatenado.
      const pattern = `%${escapeLike(filter.q)}%`;
      query = query.where(
        sql<boolean>`unaccent(coalesce(description, '') || ' ' || coalesce(merchant, '')) ILIKE unaccent(${pattern})`,
      );
    }
    if (after !== null) {
      query = query.where(
        sql<boolean>`(booked_on, id) < (${after.bookedOn}::date, ${after.id}::uuid)`,
      );
    }
    const rows = await query
      .orderBy('booked_on', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    return rows.map(toMovement);
  }

  // --- transferencias ---------------------------------------------------------------------------

  async findTransfer(id: string): Promise<TransferRecord | undefined> {
    const row = await this.#db
      .selectFrom('transfers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toTransfer(row);
  }

  async insertTransfer(values: {
    fromAccountId: string;
    toAccountId: string;
    amountCents: number;
    bookedOn: LocalDate;
    note: string | null;
  }): Promise<TransferRecord> {
    const row = await this.#db
      .insertInto('transfers')
      .values({
        from_account_id: values.fromAccountId,
        to_account_id: values.toAccountId,
        amount_cents: values.amountCents,
        booked_on: values.bookedOn,
        note: values.note,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toTransfer(row);
  }

  async updateTransfer(
    id: string,
    patch: {
      fromAccountId?: string | undefined;
      toAccountId?: string | undefined;
      amountCents?: number | undefined;
      bookedOn?: LocalDate | undefined;
      note?: string | null | undefined;
    },
    now: Date,
  ): Promise<TransferRecord | undefined> {
    const row = await this.#db
      .updateTable('transfers')
      .set({
        ...definedOnly({
          from_account_id: patch.fromAccountId,
          to_account_id: patch.toAccountId,
          amount_cents: patch.amountCents,
          booked_on: patch.bookedOn,
          note: patch.note,
        }),
        updated_at: now,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toTransfer(row);
  }

  async deleteTransfer(id: string): Promise<void> {
    await this.#db.deleteFrom('transfers').where('id', '=', id).execute();
  }

  async listTransfers(
    filter: TransferFilter,
    limit: number,
    after: PageCursor | null,
  ): Promise<TransferRecord[]> {
    let query = this.#db.selectFrom('transfers').selectAll();
    if (filter.from !== undefined) query = query.where('booked_on', '>=', filter.from);
    if (filter.to !== undefined) query = query.where('booked_on', '<=', filter.to);
    if (filter.accountId !== undefined) {
      const accountId = filter.accountId;
      query = query.where((eb) =>
        eb.or([eb('from_account_id', '=', accountId), eb('to_account_id', '=', accountId)]),
      );
    }
    if (after !== null) {
      query = query.where(
        sql<boolean>`(booked_on, id) < (${after.bookedOn}::date, ${after.id}::uuid)`,
      );
    }
    const rows = await query
      .orderBy('booked_on', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    return rows.map(toTransfer);
  }

  // --- conciliaciones ---------------------------------------------------------------------------

  async findReconciliation(id: string): Promise<ReconciliationRecord | undefined> {
    const row = await this.#db
      .selectFrom('account_reconciliations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toReconciliation(row);
  }

  async listReconciliations(accountId: string): Promise<ReconciliationRecord[]> {
    const rows = await this.#db
      .selectFrom('account_reconciliations')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('month', 'desc')
      .execute();
    return rows.map(toReconciliation);
  }

  async insertReconciliation(
    values: Omit<ReconciliationRecord, 'id' | 'createdAt'>,
  ): Promise<ReconciliationRecord> {
    const row = await this.#db
      .insertInto('account_reconciliations')
      .values({
        account_id: values.accountId,
        month: values.month,
        as_of: values.asOf,
        statement_balance_cents: values.statementBalanceCents,
        computed_balance_cents: values.computedBalanceCents,
        note: values.note,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toReconciliation(row);
  }

  /** Borra la conciliación; la base de datos borra en cascada su ajuste. */
  async deleteReconciliation(id: string): Promise<void> {
    await this.#db.deleteFrom('account_reconciliations').where('id', '=', id).execute();
  }

  /** Id del movimiento de ajuste de cada conciliación (las que no tienen ajuste no aparecen). */
  async adjustmentIds(reconciliationIds: readonly string[]): Promise<Map<string, string>> {
    if (reconciliationIds.length === 0) return new Map();
    const rows = await this.#db
      .selectFrom('movements')
      .select(['id', 'reconciliation_id'])
      .where('reconciliation_id', 'in', [...reconciliationIds])
      .execute();
    const ids = new Map<string, string>();
    for (const row of rows) {
      if (row.reconciliation_id !== null) ids.set(row.reconciliation_id, row.id);
    }
    return ids;
  }

  // --- exportación ------------------------------------------------------------------------------

  /** Todos los movimientos, en un orden estable. Los mapeadores quitan cualquier columna que no sea del dominio. */
  async listAllMovements(): Promise<MovementRecord[]> {
    const rows = await this.#db
      .selectFrom('movements')
      .selectAll()
      .orderBy('booked_on')
      .orderBy('id')
      .execute();
    return rows.map(toMovement);
  }

  async listAllTransfers(): Promise<TransferRecord[]> {
    const rows = await this.#db
      .selectFrom('transfers')
      .selectAll()
      .orderBy('booked_on')
      .orderBy('id')
      .execute();
    return rows.map(toTransfer);
  }

  async listAllReconciliations(): Promise<ReconciliationRecord[]> {
    const rows = await this.#db
      .selectFrom('account_reconciliations')
      .selectAll()
      .orderBy('month')
      .orderBy('id')
      .execute();
    return rows.map(toReconciliation);
  }

  // --- informes ---------------------------------------------------------------------------------

  /**
   * Todos los movimientos (de cualquier cuenta, también archivada, y pendientes) con fecha contable
   * entre `from` y `to`, ambos incluidos. Solo lee filas: las sumas las hace `domain/reports.ts`.
   */
  async listMovementsBetween(from: LocalDate, to: LocalDate): Promise<CategorizedMovement[]> {
    const rows = await this.#db
      .selectFrom('movements')
      .select([
        'account_id',
        'category_id',
        'kind',
        'amount_cents',
        'booked_on',
        'status',
        'source',
        'reconciliation_id',
      ])
      .where('booked_on', '>=', from)
      .where('booked_on', '<=', to)
      .execute();
    return rows.map((row) => ({
      accountId: row.account_id,
      categoryId: row.category_id,
      kind: row.kind,
      amountCents: centsFromDb(row.amount_cents),
      bookedOn: row.booked_on,
      status: row.status,
      source: row.source,
      reconciliationId: row.reconciliation_id,
    }));
  }

  // --- saldos -----------------------------------------------------------------------------------

  /**
   * Lo necesario para calcular el saldo de una cuenta con las funciones puras de `domain/`: sus
   * movimientos y las transferencias que la tocan. Los pendientes se incluyen: el dominio los ignora.
   */
  async loadLedger(account: AccountRecord): Promise<AccountLedger> {
    const ledgers = await this.loadLedgers([account]);
    return ledgers.get(account.id) ?? emptyLedger(account);
  }

  /**
   * Igual que {@link loadLedger} para varias cuentas, con DOS consultas en total (movimientos y
   * transferencias) sea cual sea su número, para no lanzar una por cuenta. Cada transferencia se
   * reparte entre sus dos cuentas, si ambas están en la lista.
   */
  async loadLedgers(accounts: readonly AccountRecord[]): Promise<Map<string, AccountLedger>> {
    const result = new Map<string, AccountLedger>();
    if (accounts.length === 0) return result;
    const ids = accounts.map((account) => account.id);
    const [movements, transfers] = await Promise.all([
      this.#db.selectFrom('movements').selectAll().where('account_id', 'in', ids).execute(),
      this.#db
        .selectFrom('transfers')
        .selectAll()
        .where((eb) => eb.or([eb('from_account_id', 'in', ids), eb('to_account_id', 'in', ids)]))
        .execute(),
    ]);

    const movementsOf = new Map<string, LedgerMovement[]>();
    for (const row of movements) {
      if (row.account_id === null) continue;
      const list = movementsOf.get(row.account_id) ?? [];
      list.push({
        accountId: row.account_id,
        kind: row.kind,
        amountCents: centsFromDb(row.amount_cents),
        bookedOn: row.booked_on,
        status: row.status,
        source: row.source,
        reconciliationId: row.reconciliation_id,
      });
      movementsOf.set(row.account_id, list);
    }
    const transfersOf = new Map<string, LedgerTransfer[]>();
    for (const row of transfers) {
      const transfer: LedgerTransfer = {
        fromAccountId: row.from_account_id,
        toAccountId: row.to_account_id,
        amountCents: centsFromDb(row.amount_cents),
        bookedOn: row.booked_on,
      };
      for (const id of new Set([row.from_account_id, row.to_account_id])) {
        const list = transfersOf.get(id) ?? [];
        list.push(transfer);
        transfersOf.set(id, list);
      }
    }
    for (const account of accounts) {
      result.set(account.id, {
        accountId: account.id,
        openingBalanceCents: account.openingBalanceCents,
        movements: movementsOf.get(account.id) ?? [],
        transfers: transfersOf.get(account.id) ?? [],
      });
    }
    return result;
  }
}

function emptyLedger(account: AccountRecord): AccountLedger {
  return {
    accountId: account.id,
    openingBalanceCents: account.openingBalanceCents,
    movements: [],
    transfers: [],
  };
}
