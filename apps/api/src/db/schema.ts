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

/** Esquema completo de la base de datos. */
export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  totp_authenticators: TotpAuthenticatorsTable;
  recovery_codes: RecoveryCodesTable;
  audit_events: AuditEventsTable;
}
