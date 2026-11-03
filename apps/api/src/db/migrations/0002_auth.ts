/**
 * Autenticación: usuario único, sesiones, segundo factor (TOTP), códigos de recuperación y registro
 * de auditoría (docs/plan.md §2.2, docs/adr/0006-sesiones-y-dos-factores.md).
 *
 * Solo usa funciones disponibles desde PostgreSQL 13 (gen_random_uuid está en el núcleo desde la 13).
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 64),
      -- Formato PHC ($argon2id$v=19$m=…,t=…,p=…$sal$hash): guarda los parámetros, así que se pueden
      -- endurecer sin migración (se recalcula el hash en el siguiente inicio de sesión).
      password_hash text NOT NULL,
      timezone text NOT NULL DEFAULT 'Europe/Madrid',
      disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX users_username_key ON users (lower(username))`.execute(db);
  // Garantiza en la base de datos que solo existe un usuario: todas las filas tendrían la misma clave.
  await sql`CREATE UNIQUE INDEX users_single_user ON users ((true))`.execute(db);

  await sql`
    CREATE TABLE sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- SHA-256 del token de la cookie: si se filtra la base de datos, las sesiones no se pueden usar.
      token_hash bytea NOT NULL UNIQUE,
      stage text NOT NULL CHECK (stage IN ('mfa_pending', 'full')),
      -- Intentos fallidos de segundo factor, desbloqueo o reautenticación; al llegar a 5 se revoca.
      failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      reauthenticated_at timestamptz,
      revoked_at timestamptz,
      user_agent text CHECK (char_length(user_agent) <= 512)
    )
  `.execute(db);
  await sql`CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL`.execute(
    db,
  );
  await sql`CREATE INDEX sessions_expires_at_idx ON sessions (expires_at)`.execute(db);

  await sql`
    CREATE TABLE totp_authenticators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- Semilla cifrada con AES-256-GCM (texto cifrado + etiqueta de autenticación) y su nonce.
      secret_ciphertext bytea NOT NULL,
      secret_nonce bytea NOT NULL CHECK (octet_length(secret_nonce) = 12),
      key_version smallint NOT NULL CHECK (key_version >= 1),
      -- Último paso de 30 s aceptado: cada código solo vale una vez (ASVS 6.5.1).
      last_used_step bigint,
      confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX totp_one_confirmed_per_user
      ON totp_authenticators (user_id) WHERE confirmed_at IS NOT NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX totp_one_pending_per_user
      ON totp_authenticators (user_id) WHERE confirmed_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE recovery_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- Argon2id con sal (formato PHC): los códigos tienen 80 bits, menos de 112 (ASVS 6.5.2).
      code_hash text NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX recovery_codes_unused_idx ON recovery_codes (user_id) WHERE used_at IS NULL`.execute(
    db,
  );

  await sql`
    CREATE TABLE audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor text NOT NULL CHECK (char_length(actor) <= 100),
      action text NOT NULL CHECK (char_length(action) <= 100),
      entity_type text,
      entity_id uuid,
      ip text CHECK (char_length(ip) <= 64),
      -- Nunca contiene contraseñas, códigos, tokens ni importes.
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `.execute(db);
  await sql`CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at)`.execute(db);

  // Registro de solo inserción (ASVS 16.4.2): un UPDATE, DELETE o TRUNCATE falla aunque lo intente el
  // código de la aplicación. Separar el rol de la app del que migra (que podría quitar el trigger)
  // queda para la fase 2, con el despliegue (docs/adr/0006).
  await sql`
    CREATE FUNCTION audit_events_append_only() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit_events es de solo inserción (operación %)', TG_OP;
    END
    $$
  `.execute(db);
  await sql`
    CREATE TRIGGER audit_events_no_update_delete
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()
  `.execute(db);
  await sql`
    CREATE TRIGGER audit_events_no_truncate
      BEFORE TRUNCATE ON audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS audit_events`.execute(db);
  await sql`DROP FUNCTION IF EXISTS audit_events_append_only()`.execute(db);
  await sql`DROP TABLE IF EXISTS recovery_codes`.execute(db);
  await sql`DROP TABLE IF EXISTS totp_authenticators`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
}
