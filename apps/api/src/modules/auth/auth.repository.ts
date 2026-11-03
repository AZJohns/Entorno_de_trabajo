/**
 * Acceso a las tablas de autenticación. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción, así que el servicio puede agrupar varias operaciones en una
 * transacción (ASVS 2.3.3).
 */
import type { Kysely, Selectable } from 'kysely';
import type { Database, SessionsTable, UsersTable } from '../../db/schema.ts';

export type UserRow = Selectable<UsersTable>;
export type SessionRow = Selectable<SessionsTable>;

/** TOTP con `last_used_step` ya convertido a número. */
export interface TotpRow {
  readonly id: string;
  readonly userId: string;
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly keyVersion: number;
  readonly lastUsedStep: number | null;
  readonly confirmedAt: Date | null;
}

/** Datos de un evento de auditoría. Nunca contraseñas, códigos ni tokens (ASVS 16.2.5). */
export interface AuditEvent {
  readonly actor: string;
  readonly action: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly ip?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export class AuthRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  // --- usuarios ---------------------------------------------------------------------------------

  async findUserByUsername(username: string): Promise<UserRow | undefined> {
    return this.#db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
      .executeTakeFirst();
  }

  async findUserById(id: string): Promise<UserRow | undefined> {
    return this.#db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async countUsers(): Promise<number> {
    const row = await this.#db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async insertUser(username: string, passwordHash: string): Promise<UserRow> {
    return this.#db
      .insertInto('users')
      .values({ username, password_hash: passwordHash, disabled_at: null })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updatePasswordHash(userId: string, passwordHash: string, now: Date): Promise<void> {
    await this.#db
      .updateTable('users')
      .set({ password_hash: passwordHash, updated_at: now })
      .where('id', '=', userId)
      .execute();
  }

  async disableUser(userId: string, now: Date): Promise<void> {
    await this.#db
      .updateTable('users')
      .set({ disabled_at: now, updated_at: now })
      .where('id', '=', userId)
      .execute();
  }

  // --- sesiones ---------------------------------------------------------------------------------

  async insertSession(values: {
    userId: string;
    tokenHash: Buffer;
    stage: 'mfa_pending' | 'full';
    now: Date;
    expiresAt: Date;
    userAgent: string | null;
  }): Promise<SessionRow> {
    return this.#db
      .insertInto('sessions')
      .values({
        user_id: values.userId,
        token_hash: values.tokenHash,
        stage: values.stage,
        created_at: values.now,
        last_seen_at: values.now,
        expires_at: values.expiresAt,
        reauthenticated_at: null,
        revoked_at: null,
        user_agent: values.userAgent,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findSessionByTokenHash(tokenHash: Buffer): Promise<SessionRow | undefined> {
    return this.#db
      .selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async updateSession(
    id: string,
    patch: Partial<{
      tokenHash: Buffer;
      stage: 'mfa_pending' | 'full';
      lastSeenAt: Date;
      expiresAt: Date;
      reauthenticatedAt: Date | null;
      failedAttempts: number;
    }>,
  ): Promise<void> {
    await this.#db
      .updateTable('sessions')
      .set({
        ...(patch.tokenHash === undefined ? {} : { token_hash: patch.tokenHash }),
        ...(patch.stage === undefined ? {} : { stage: patch.stage }),
        ...(patch.lastSeenAt === undefined ? {} : { last_seen_at: patch.lastSeenAt }),
        ...(patch.expiresAt === undefined ? {} : { expires_at: patch.expiresAt }),
        ...(patch.reauthenticatedAt === undefined
          ? {}
          : { reauthenticated_at: patch.reauthenticatedAt }),
        ...(patch.failedAttempts === undefined ? {} : { failed_attempts: patch.failedAttempts }),
      })
      .where('id', '=', id)
      .execute();
  }

  /** Suma un intento fallido y devuelve el total. */
  async incrementFailedAttempts(id: string): Promise<number> {
    const row = await this.#db
      .updateTable('sessions')
      .set((eb) => ({ failed_attempts: eb('failed_attempts', '+', 1) }))
      .where('id', '=', id)
      .returning('failed_attempts')
      .executeTakeFirstOrThrow();
    return row.failed_attempts;
  }

  async revokeSession(id: string, now: Date): Promise<void> {
    await this.#db
      .updateTable('sessions')
      .set({ revoked_at: now })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Revoca todas las sesiones del usuario salvo `exceptId` (si se indica). */
  async revokeUserSessions(userId: string, now: Date, exceptId?: string): Promise<number> {
    let query = this.#db
      .updateTable('sessions')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null);
    if (exceptId !== undefined) query = query.where('id', '!=', exceptId);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** Sesiones completas no revocadas y no caducadas, de la más reciente a la más antigua. */
  async listLiveFullSessions(userId: string, now: Date): Promise<SessionRow[]> {
    return this.#db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('stage', '=', 'full')
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .orderBy('created_at', 'desc')
      .execute();
  }

  // --- TOTP -------------------------------------------------------------------------------------

  async findTotp(userId: string, which: 'confirmed' | 'pending'): Promise<TotpRow | undefined> {
    const row = await this.#db
      .selectFrom('totp_authenticators')
      .selectAll()
      .where('user_id', '=', userId)
      .where('confirmed_at', which === 'confirmed' ? 'is not' : 'is', null)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          id: row.id,
          userId: row.user_id,
          ciphertext: row.secret_ciphertext,
          nonce: row.secret_nonce,
          keyVersion: row.key_version,
          lastUsedStep: row.last_used_step === null ? null : Number(row.last_used_step),
          confirmedAt: row.confirmed_at,
        };
  }

  async insertTotp(values: {
    userId: string;
    ciphertext: Buffer;
    nonce: Buffer;
    keyVersion: number;
    confirmedAt: Date | null;
    lastUsedStep: number | null;
  }): Promise<void> {
    await this.#db
      .insertInto('totp_authenticators')
      .values({
        user_id: values.userId,
        secret_ciphertext: values.ciphertext,
        secret_nonce: values.nonce,
        key_version: values.keyVersion,
        confirmed_at: values.confirmedAt,
        last_used_step: values.lastUsedStep,
      })
      .execute();
  }

  async deleteTotp(userId: string, which: 'confirmed' | 'pending'): Promise<void> {
    await this.#db
      .deleteFrom('totp_authenticators')
      .where('user_id', '=', userId)
      .where('confirmed_at', which === 'confirmed' ? 'is not' : 'is', null)
      .execute();
  }

  async confirmTotp(id: string, now: Date, step: number): Promise<void> {
    await this.#db
      .updateTable('totp_authenticators')
      .set({ confirmed_at: now, last_used_step: step })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Marca un paso como usado solo si es posterior al último. Es atómico: si dos peticiones usan el
   * mismo código a la vez, solo una lo consigue (uso único, ASVS 6.5.1).
   */
  async claimTotpStep(id: string, step: number): Promise<boolean> {
    const result = await this.#db
      .updateTable('totp_authenticators')
      .set({ last_used_step: step })
      .where('id', '=', id)
      .where((eb) =>
        eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', String(step))]),
      )
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }

  // --- códigos de recuperación ------------------------------------------------------------------

  async listUnusedRecoveryCodes(userId: string): Promise<{ id: string; codeHash: string }[]> {
    const rows = await this.#db
      .selectFrom('recovery_codes')
      .select(['id', 'code_hash'])
      .where('user_id', '=', userId)
      .where('used_at', 'is', null)
      .execute();
    return rows.map((row) => ({ id: row.id, codeHash: row.code_hash }));
  }

  /** Marca un código como usado de forma atómica (solo una petición puede usarlo). */
  async claimRecoveryCode(id: string, now: Date): Promise<boolean> {
    const result = await this.#db
      .updateTable('recovery_codes')
      .set({ used_at: now })
      .where('id', '=', id)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }

  async replaceRecoveryCodes(userId: string, codeHashes: readonly string[]): Promise<void> {
    await this.#db.deleteFrom('recovery_codes').where('user_id', '=', userId).execute();
    await this.#db
      .insertInto('recovery_codes')
      .values(codeHashes.map((hash) => ({ user_id: userId, code_hash: hash, used_at: null })))
      .execute();
  }

  // --- auditoría --------------------------------------------------------------------------------

  async insertAuditEvent(event: AuditEvent): Promise<void> {
    await this.#db
      .insertInto('audit_events')
      .values({
        actor: event.actor,
        action: event.action,
        entity_type: event.entityType ?? null,
        entity_id: event.entityId ?? null,
        ip: event.ip ?? null,
        metadata: event.metadata ?? {},
      })
      .execute();
  }
}
