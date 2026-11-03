/**
 * Tipos de las tablas para Kysely, escritos a mano (docs/adr/0006: con pocas tablas, kysely-codegen
 * añadiría una dependencia y una base de datos en el paso de generación). Los tests de integración,
 * que usan la base de datos real, detectan cualquier desajuste con las migraciones.
 */
import type { ColumnType, Generated } from 'kysely';

/** Columna con valor por defecto en la base de datos: opcional al insertar. */
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export interface UsersTable {
  id: Generated<string>;
  username: string;
  password_hash: string;
  timezone: Defaulted<string>;
  disabled_at: Date | null;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  stage: 'mfa_pending' | 'full';
  failed_attempts: Defaulted<number>;
  created_at: Defaulted<Date>;
  last_seen_at: Defaulted<Date>;
  expires_at: Date;
  reauthenticated_at: Date | null;
  revoked_at: Date | null;
  user_agent: string | null;
}

export interface TotpAuthenticatorsTable {
  id: Generated<string>;
  user_id: string;
  secret_ciphertext: Buffer;
  secret_nonce: Buffer;
  key_version: number;
  // bigint de PostgreSQL: pg lo devuelve como cadena; se convierte en el repositorio.
  last_used_step: ColumnType<string | null, number | null, number | null>;
  confirmed_at: Date | null;
  created_at: Defaulted<Date>;
}

export interface RecoveryCodesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  used_at: Date | null;
  created_at: Defaulted<Date>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  occurred_at: Defaulted<Date>;
  actor: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  metadata: Defaulted<Record<string, unknown>>;
}

/**
 * Importe en céntimos (`bigint` de PostgreSQL): `pg` lo devuelve como cadena, para no perder precisión,
 * y se acepta un número al insertar. Se convierte con `centsFromDb` (src/db/cents.ts), nunca con `Number`.
 */
type CentsColumn = ColumnType<string, number, number>;

/**
 * Fecha contable (`date`) como `YYYY-MM-DD`. `createDatabase` configura `pg` para no convertirla en un
 * `Date` a medianoche de la zona local, que cambiaría de día según la zona del servidor.
 */
type DateColumn = ColumnType<string, string, string>;

export interface AccountsTable {
  id: Generated<string>;
  name: string;
  type: 'checking' | 'savings' | 'cash';
  currency: Defaulted<'EUR'>;
  opening_balance_cents: ColumnType<string, number | undefined, number>;
  opening_date: DateColumn;
  archived_at: Defaulted<Date | null>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface CategoriesTable {
  id: Generated<string>;
  name: string;
  kind: 'income' | 'expense';
  archived_at: Defaulted<Date | null>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface AccountReconciliationsTable {
  id: Generated<string>;
  account_id: string;
  month: DateColumn;
  as_of: DateColumn;
  statement_balance_cents: CentsColumn;
  computed_balance_cents: CentsColumn;
  note: string | null;
  created_at: Defaulted<Date>;
}

/** Incidencias que impiden confirmar un movimiento (plan §2.3). */
export type MovementFlag =
  | 'amount_missing'
  | 'amount_unparsed'
  | 'merchant_missing'
  | 'unknown_card'
  | 'possible_duplicate'
  | 'foreign_currency';

export interface MovementsTable {
  id: Generated<string>;
  kind: 'income' | 'expense';
  amount_cents: CentsColumn;
  description: string | null;
  merchant: string | null;
  account_id: string | null;
  category_id: string | null;
  booked_on: DateColumn;
  source: 'manual' | 'reconciliation';
  reconciliation_id: string | null;
  status: 'pending' | 'confirmed';
  flags: Defaulted<MovementFlag[]>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
  confirmed_at: Date | null;
}

export interface TransfersTable {
  id: Generated<string>;
  from_account_id: string;
  to_account_id: string;
  amount_cents: CentsColumn;
  booked_on: DateColumn;
  note: string | null;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

/** Esquema completo de la base de datos. */
export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  totp_authenticators: TotpAuthenticatorsTable;
  recovery_codes: RecoveryCodesTable;
  audit_events: AuditEventsTable;
  accounts: AccountsTable;
  categories: CategoriesTable;
  account_reconciliations: AccountReconciliationsTable;
  movements: MovementsTable;
  transfers: TransfersTable;
}
