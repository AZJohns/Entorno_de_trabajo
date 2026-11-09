/**
 * Lógica de autenticación: inicio de sesión en dos pasos, desbloqueo tras inactividad,
 * reautenticación, cambio de contraseña y de TOTP, códigos de recuperación y sesiones.
 *
 * Decisiones (docs/adr/0006-sesiones-y-dos-factores.md, docs/plan.md §6.2):
 * - Sesiones con estado en PostgreSQL (no JWT): se pueden revocar al instante.
 * - Contraseña + TOTP obligatorio. Al pasar al estado `full` se emite un token NUEVO (ASVS 7.2.4).
 * - Tras 1 h sin uso, la sesión se bloquea y se desbloquea solo con la contraseña junto con la cookie
 *   (NIST SP 800-63B-4). El desbloqueo no habilita las acciones sensibles.
 * - Las acciones sensibles exigen una reautenticación completa (contraseña + TOTP) en los últimos 10 min.
 * - Los fallos de contraseña devuelven siempre el mismo error, exista o no el usuario.
 */
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { AuthRepository, type AuditEvent, type SessionRow } from './auth.repository.ts';
import {
  PASSWORD_ARGON2,
  RECOVERY_CODE_ARGON2,
  getDummyPasswordHash,
  hashSecret,
  needsRehash,
  verifySecret,
} from './crypto/password-hash.ts';
import { open, seal } from './crypto/secret-box.ts';
import { csrfTokenFor, hashSessionToken, newSessionToken } from './crypto/tokens.ts';
import {
  PASSWORD_REJECTION_MESSAGES,
  checkPasswordPolicy,
  type PasswordRejection,
} from './domain/password-policy.ts';
import {
  RECOVERY_CODE_BYTES,
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  normalizeRecoveryCode,
} from './domain/recovery-codes.ts';
import {
  MAX_CONCURRENT_SESSIONS,
  MAX_FAILED_ATTEMPTS,
  MFA_PENDING_LIFETIME_MS,
  REAUTH_WINDOW_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
  sessionState,
} from './domain/session-rules.ts';
import {
  NEW_TOTP_ALGORITHM,
  TOTP_SECRET_BYTES,
  base32Encode,
  otpauthUri,
  verifyTotp,
  type TotpAlgorithm,
} from './domain/totp.ts';
import { BreachCheckUnavailableError, type PasswordBreachChecker } from './infra/hibp.ts';

/** Dependencias del servicio (se inyectan; los tests usan un reloj y un HIBP falsos). */
export interface AuthServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Clave de 32 bytes para cifrar las semillas TOTP. */
  readonly totpKey: Buffer;
  readonly totpKeyVersion: number;
  readonly breachChecker: PasswordBreachChecker;
  readonly commonPasswords: ReadonlySet<string>;
  /** Palabras del contexto que una contraseña no puede contener (además del nombre de usuario). */
  readonly contextWords: readonly string[];
  /** Nombre que muestra la app de autenticación. */
  readonly issuer: string;
}

/** Datos de la petición que se registran en la auditoría. */
export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Sesión válida (no revocada ni caducada) asociada a la cookie de la petición. */
export interface SessionContext {
  readonly id: string;
  readonly userId: string;
  readonly token: string;
  readonly stage: 'mfa_pending' | 'full';
  readonly state: 'pending' | 'locked' | 'active';
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly reauthenticatedAt: Date | null;
}

/** Resultado de las operaciones que emiten un token de sesión nuevo (hay que enviarlo en la cookie). */
export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

/** Credenciales iniciales que muestra una sola vez el script `create-user`. */
export interface InitialCredentials {
  readonly totpSecret: string;
  /** Algoritmo de la semilla: las apps solo lo aplican si se escanea el QR del enlace. */
  readonly totpAlgorithm: TotpAlgorithm;
  readonly otpauthUri: string;
  readonly recoveryCodes: readonly string[];
}

const invalidCredentials = (): AppError =>
  new AppError('INVALID_CREDENTIALS', 401, 'Las credenciales no son correctas');

export class AuthService {
  readonly #deps: AuthServiceDeps;
  readonly #repo: AuthRepository;

  constructor(deps: AuthServiceDeps) {
    this.#deps = deps;
    this.#repo = new AuthRepository(deps.db);
  }

  // --- sesión de la petición ----------------------------------------------------------------------

  /** Busca la sesión de una cookie. Devuelve `null` si no existe, está revocada o ha caducado. */
  async loadSession(token: string): Promise<SessionContext | null> {
    const row = await this.#repo.findSessionByTokenHash(hashSessionToken(token));
    if (row === undefined) return null;
    const state = sessionState(
      {
        stage: row.stage,
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
      },
      this.#now(),
    );
    if (state === 'revoked' || state === 'expired') return null;
    return {
      id: row.id,
      userId: row.user_id,
      token,
      stage: row.stage,
      state,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      reauthenticatedAt: row.reauthenticated_at,
    };
  }

  /** Registra actividad en una sesión activa (reinicia el plazo de inactividad). */
  async touch(session: SessionContext): Promise<void> {
    await this.#repo.updateSession(session.id, { lastSeenAt: this.#now() });
  }

  /** Datos de la sesión para el cliente, incluido su token CSRF. */
  async describeSession(session: SessionContext): Promise<{
    username: string;
    stage: 'mfa_pending' | 'full';
    csrfToken: string;
    expiresAt: Date;
    idleExpiresAt: Date;
    reauthenticatedUntil: Date | null;
  }> {
    const user = await this.#requireUser(session.userId);
    const lastSeen = session.state === 'active' ? this.#now() : session.lastSeenAt;
    return {
      username: user.username,
      stage: session.stage,
      csrfToken: csrfTokenFor(session.token),
      expiresAt: session.expiresAt,
      idleExpiresAt: new Date(
        Math.min(lastSeen.getTime() + SESSION_IDLE_TIMEOUT_MS, session.expiresAt.getTime()),
      ),
      reauthenticatedUntil:
        session.reauthenticatedAt === null
          ? null
          : new Date(session.reauthenticatedAt.getTime() + REAUTH_WINDOW_MS),
    };
  }

  // --- inicio de sesión -------------------------------------------------------------------------

  /**
   * Primer paso: contraseña. Crea una sesión `mfa_pending` de 5 minutos.
   *
   * Si el usuario no existe se verifica igualmente contra un hash ficticio, para que el tiempo de
   * respuesta no revele si existe.
   */
  async login(username: string, password: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.#repo.findUserByUsername(username);
    const valid = await verifySecret(
      password,
      user?.password_hash ?? (await getDummyPasswordHash()),
    );
    if (user === undefined || !valid || user.disabled_at !== null) {
      await this.#audit({ actor: 'anonymous', action: 'login.failure', ip: meta.ip });
      throw invalidCredentials();
    }
    if (needsRehash(user.password_hash, PASSWORD_ARGON2)) {
      await this.#repo.updatePasswordHash(
        user.id,
        await hashSecret(password, PASSWORD_ARGON2),
        this.#now(),
      );
    }
    const token = newSessionToken();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + MFA_PENDING_LIFETIME_MS);
    const session = await this.#repo.insertSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      stage: 'mfa_pending',
      now,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    });
    await this.#audit({
      actor: `user:${user.id}`,
      action: 'login.password_success',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
    });
    return { token, expiresAt };
  }

  /**
   * Segundo paso: TOTP o código de recuperación. Emite un token nuevo y la sesión pasa a `full`
   * (24 h). Tras 5 fallos, la sesión se revoca y hay que empezar de nuevo.
   */
  async completeSecondFactor(
    session: SessionContext,
    input: { totp: string } | { recoveryCode: string },
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const method = 'totp' in input ? 'totp' : 'recovery_code';
    const ok =
      'totp' in input
        ? await this.#checkTotp(session.userId, input.totp)
        : await this.#useRecoveryCode(session.userId, input.recoveryCode);
    if (!ok) {
      await this.#registerFailure(session, 'mfa.failure', meta, { method });
      throw invalidCredentials();
    }

    const token = newSessionToken();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
    await this.#deps.db.transaction().execute(async (trx) => {
      const repo = new AuthRepository(trx);
      await repo.updateSession(session.id, {
        tokenHash: hashSessionToken(token),
        stage: 'full',
        lastSeenAt: now,
        expiresAt,
        // El inicio de sesión completo cuenta como reautenticación reciente.
        reauthenticatedAt: now,
        failedAttempts: 0,
      });
      // Como mucho 5 sesiones completas: se revocan las más antiguas (ASVS 7.1.2).
      const live = await repo.listLiveFullSessions(session.userId, now);
      for (const old of live.slice(MAX_CONCURRENT_SESSIONS)) await repo.revokeSession(old.id, now);
    });
    await this.#audit({
      actor: `user:${session.userId}`,
      action: method === 'totp' ? 'mfa.success' : 'recovery_code.used',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
    });
    return { token, expiresAt };
  }

  /**
   * Desbloqueo tras 1 h de inactividad: solo la contraseña, junto con la cookie de la sesión
   * (NIST SP 800-63B-4 lo permite dentro de la vida absoluta). Emite un token nuevo y NO cuenta como
   * reautenticación para las acciones sensibles.
   */
  async unlock(
    session: SessionContext,
    password: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await this.#requireUser(session.userId);
    if (!(await verifySecret(password, user.password_hash))) {
      await this.#registerFailure(session, 'unlock.failure', meta);
      throw invalidCredentials();
    }
    const token = newSessionToken();
    await this.#repo.updateSession(session.id, {
      tokenHash: hashSessionToken(token),
      lastSeenAt: this.#now(),
      failedAttempts: 0,
    });
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'unlock.success',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
    });
    return { token, expiresAt: session.expiresAt };
  }

  /** Reautenticación completa (contraseña + TOTP) para las acciones sensibles durante 10 minutos. */
  async reauthenticate(
    session: SessionContext,
    password: string,
    totp: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await this.#requireUser(session.userId);
    const passwordOk = await verifySecret(password, user.password_hash);
    // Se comprueba el TOTP solo si la contraseña es correcta, para no consumir un código válido.
    if (!passwordOk || !(await this.#checkTotp(session.userId, totp))) {
      await this.#registerFailure(session, 'reauth.failure', meta);
      throw invalidCredentials();
    }
    const token = newSessionToken();
    const now = this.#now();
    await this.#repo.updateSession(session.id, {
      tokenHash: hashSessionToken(token),
      lastSeenAt: now,
      reauthenticatedAt: now,
      failedAttempts: 0,
    });
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'reauth.success',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
    });
    return { token, expiresAt: session.expiresAt };
  }

  /** Cierra la sesión actual. */
  async logout(session: SessionContext, meta: RequestMeta): Promise<void> {
    await this.#repo.revokeSession(session.id, this.#now());
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'logout',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
    });
  }

  // --- acciones sensibles (exigen reautenticación reciente) ---------------------------------------

  /**
   * Cambia la contraseña. Exige la actual (ASVS 6.2.3) y comprueba la nueva contra la política local y
   * contra las contraseñas filtradas (fallo cerrado).
   */
  async changePassword(
    session: SessionContext,
    input: { currentPassword: string; newPassword: string; terminateOtherSessions: boolean },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.#requireUser(session.userId);
    if (!(await verifySecret(input.currentPassword, user.password_hash))) {
      await this.#audit({
        actor: `user:${user.id}`,
        action: 'password.change_failure',
        ip: meta.ip,
      });
      throw invalidCredentials();
    }
    if (input.currentPassword === input.newPassword) throw passwordRejected('same_as_current');
    await this.#assertAcceptablePassword(input.newPassword, user.username);

    const now = this.#now();
    await this.#repo.updatePasswordHash(
      user.id,
      await hashSecret(input.newPassword, PASSWORD_ARGON2),
      now,
    );
    const revoked = input.terminateOtherSessions
      ? await this.#repo.revokeUserSessions(user.id, now, session.id)
      : 0;
    await this.#audit({
      actor: `user:${user.id}`,
      action: 'password.changed',
      ip: meta.ip,
      metadata: { otherSessionsRevoked: revoked },
    });
  }

  /** Empieza el cambio de TOTP: genera una semilla nueva sin confirmar y la devuelve una vez. */
  async startTotpEnrollment(
    session: SessionContext,
    meta: RequestMeta,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.#requireUser(session.userId);
    const secret = randomBytes(TOTP_SECRET_BYTES[NEW_TOTP_ALGORITHM]);
    const sealed = seal(this.#deps.totpKey, secret);
    await this.#deps.db.transaction().execute(async (trx) => {
      const repo = new AuthRepository(trx);
      await repo.deleteTotp(user.id, 'pending');
      await repo.insertTotp({
        userId: user.id,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        keyVersion: this.#deps.totpKeyVersion,
        algorithm: NEW_TOTP_ALGORITHM,
        confirmedAt: null,
        lastUsedStep: null,
      });
    });
    await this.#audit({ actor: `user:${user.id}`, action: 'totp.enroll_started', ip: meta.ip });
    return {
      secret: base32Encode(secret),
      otpauthUri: otpauthUri({
        secret,
        algorithm: NEW_TOTP_ALGORITHM,
        issuer: this.#deps.issuer,
        account: user.username,
      }),
    };
  }

  /** Confirma la semilla nueva con un código y sustituye a la anterior. */
  async confirmTotpEnrollment(
    session: SessionContext,
    input: { code: string; terminateOtherSessions: boolean },
    meta: RequestMeta,
  ): Promise<void> {
    const pending = await this.#repo.findTotp(session.userId, 'pending');
    if (pending === undefined) {
      throw new AppError('CONFLICT', 409, 'No hay ningún cambio de TOTP en curso');
    }
    const result = verifyTotp(
      this.#openSecret(pending),
      pending.algorithm,
      input.code,
      this.#now(),
      null,
    );
    if (!result.ok) {
      throw new AppError('VALIDATION_ERROR', 400, 'El código no es correcto', [
        { path: 'code', message: 'El código no es correcto' },
      ]);
    }
    const now = this.#now();
    let revoked = 0;
    await this.#deps.db.transaction().execute(async (trx) => {
      const repo = new AuthRepository(trx);
      await repo.deleteTotp(session.userId, 'confirmed');
      await repo.confirmTotp(pending.id, now, result.step);
      if (input.terminateOtherSessions) {
        revoked = await repo.revokeUserSessions(session.userId, now, session.id);
      }
    });
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'totp.changed',
      ip: meta.ip,
      metadata: { otherSessionsRevoked: revoked },
    });
  }

  /** Genera 10 códigos de recuperación nuevos (invalida los anteriores) y los devuelve una vez. */
  async regenerateRecoveryCodes(session: SessionContext, meta: RequestMeta): Promise<string[]> {
    const codes = await this.#newRecoveryCodes(session.userId, this.#deps.db);
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'recovery_codes.regenerated',
      ip: meta.ip,
    });
    return codes;
  }

  /** Sesiones completas abiertas del usuario. */
  async listSessions(
    session: SessionContext,
  ): Promise<
    { id: string; createdAt: Date; lastSeenAt: Date; userAgent: string | null; current: boolean }[]
  > {
    const rows = await this.#repo.listLiveFullSessions(session.userId, this.#now());
    return rows.map((row: SessionRow) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      userAgent: row.user_agent,
      current: row.id === session.id,
    }));
  }

  /** Cierra una sesión del propio usuario. */
  async revokeSessionById(session: SessionContext, id: string, meta: RequestMeta): Promise<void> {
    const live = await this.#repo.listLiveFullSessions(session.userId, this.#now());
    if (!live.some((row) => row.id === id)) {
      throw new AppError('NOT_FOUND', 404, 'No existe esa sesión');
    }
    await this.#repo.revokeSession(id, this.#now());
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'session.revoked',
      entityType: 'session',
      entityId: id,
      ip: meta.ip,
    });
  }

  // --- operaciones de administración (scripts de servidor) -------------------------------------

  /**
   * Crea el único usuario con su TOTP y sus códigos de recuperación. Así nunca existe una sesión sin
   * segundo factor. Lo usa el script `create-user`.
   */
  async createInitialUser(username: string, password: string): Promise<InitialCredentials> {
    if ((await this.#repo.countUsers()) > 0) {
      throw new AppError(
        'CONFLICT',
        409,
        'Ya existe un usuario: la aplicación es de un solo usuario',
      );
    }
    await this.#assertAcceptablePassword(password, username);
    const passwordHash = await hashSecret(password, PASSWORD_ARGON2);
    const secret = randomBytes(TOTP_SECRET_BYTES[NEW_TOTP_ALGORITHM]);
    const sealed = seal(this.#deps.totpKey, secret);

    const recoveryCodes = await this.#deps.db.transaction().execute(async (trx) => {
      const repo = new AuthRepository(trx);
      const user = await repo.insertUser(username, passwordHash);
      await repo.insertTotp({
        userId: user.id,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        keyVersion: this.#deps.totpKeyVersion,
        algorithm: NEW_TOTP_ALGORITHM,
        confirmedAt: this.#now(),
        lastUsedStep: null,
      });
      const codes = await this.#newRecoveryCodes(user.id, trx);
      await repo.insertAuditEvent({
        actor: 'system:cli',
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
      });
      return codes;
    });
    return {
      totpSecret: base32Encode(secret),
      totpAlgorithm: NEW_TOTP_ALGORITHM,
      otpauthUri: otpauthUri({
        secret,
        algorithm: NEW_TOTP_ALGORITHM,
        issuer: this.#deps.issuer,
        account: username,
      }),
      recoveryCodes,
    };
  }

  /**
   * Restablece la contraseña desde el servidor. NO desactiva el TOTP (ASVS 6.4.3) y revoca todas las
   * sesiones.
   */
  async resetPassword(username: string, newPassword: string): Promise<void> {
    const user = await this.#repo.findUserByUsername(username);
    if (user === undefined) throw new AppError('NOT_FOUND', 404, 'No existe ese usuario');
    await this.#assertAcceptablePassword(newPassword, user.username);
    const now = this.#now();
    await this.#repo.updatePasswordHash(
      user.id,
      await hashSecret(newPassword, PASSWORD_ARGON2),
      now,
    );
    const revoked = await this.#repo.revokeUserSessions(user.id, now);
    await this.#audit({
      actor: 'system:cli',
      action: 'password.reset',
      entityType: 'user',
      entityId: user.id,
      metadata: { sessionsRevoked: revoked },
    });
  }

  /** Revoca todas las sesiones del usuario (ASVS 7.4.5). */
  async revokeAllSessions(username: string): Promise<number> {
    const user = await this.#repo.findUserByUsername(username);
    if (user === undefined) throw new AppError('NOT_FOUND', 404, 'No existe ese usuario');
    const revoked = await this.#repo.revokeUserSessions(user.id, this.#now());
    await this.#audit({
      actor: 'system:cli',
      action: 'sessions.revoked_all',
      entityType: 'user',
      entityId: user.id,
      metadata: { sessionsRevoked: revoked },
    });
    return revoked;
  }

  /** Deshabilita la cuenta y revoca todas sus sesiones (ASVS 7.4.2). */
  async disableUser(username: string): Promise<void> {
    const user = await this.#repo.findUserByUsername(username);
    if (user === undefined) throw new AppError('NOT_FOUND', 404, 'No existe ese usuario');
    const now = this.#now();
    await this.#repo.disableUser(user.id, now);
    await this.#repo.revokeUserSessions(user.id, now);
    await this.#audit({
      actor: 'system:cli',
      action: 'user.disabled',
      entityType: 'user',
      entityId: user.id,
    });
  }

  // --- auxiliares ---------------------------------------------------------------------------------

  #now(): Date {
    return this.#deps.clock.now();
  }

  async #requireUser(userId: string) {
    const user = await this.#repo.findUserById(userId);
    if (user === undefined || user.disabled_at !== null) {
      throw new AppError('UNAUTHENTICATED', 401, 'Sesión no válida');
    }
    return user;
  }

  #openSecret(totp: { ciphertext: Buffer; nonce: Buffer; keyVersion: number }): Buffer {
    if (totp.keyVersion !== this.#deps.totpKeyVersion) {
      // La rotación de la clave exige volver a dar de alta el TOTP (docs/adr/0006).
      throw new Error('La semilla TOTP está cifrada con otra versión de la clave');
    }
    return open(this.#deps.totpKey, { ciphertext: totp.ciphertext, nonce: totp.nonce });
  }

  /** Verifica un TOTP contra la semilla confirmada y lo marca como usado de forma atómica. */
  async #checkTotp(userId: string, code: string): Promise<boolean> {
    const totp = await this.#repo.findTotp(userId, 'confirmed');
    if (totp === undefined) return false;
    const result = verifyTotp(
      this.#openSecret(totp),
      totp.algorithm,
      code,
      this.#now(),
      totp.lastUsedStep,
    );
    return result.ok && (await this.#repo.claimTotpStep(totp.id, result.step));
  }

  /** Busca un código de recuperación sin usar que coincida y lo marca como usado. */
  async #useRecoveryCode(userId: string, input: string): Promise<boolean> {
    const canonical = normalizeRecoveryCode(input);
    if (canonical === null) return false;
    for (const code of await this.#repo.listUnusedRecoveryCodes(userId)) {
      if (await verifySecret(canonical, code.codeHash)) {
        return this.#repo.claimRecoveryCode(code.id, this.#now());
      }
    }
    return false;
  }

  async #newRecoveryCodes(userId: string, db: Kysely<Database>): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      formatRecoveryCode(randomBytes(RECOVERY_CODE_BYTES)),
    );
    const hashes = await Promise.all(
      codes.map((code) => hashSecret(normalizeRecoveryCode(code) ?? code, RECOVERY_CODE_ARGON2)),
    );
    await new AuthRepository(db).replaceRecoveryCodes(userId, hashes);
    return codes;
  }

  /** Cuenta un intento fallido; al quinto, revoca la sesión (hay que volver a iniciar sesión). */
  async #registerFailure(
    session: SessionContext,
    action: string,
    meta: RequestMeta,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const attempts = await this.#repo.incrementFailedAttempts(session.id);
    const revoked = attempts >= MAX_FAILED_ATTEMPTS;
    if (revoked) await this.#repo.revokeSession(session.id, this.#now());
    await this.#audit({
      actor: `user:${session.userId}`,
      action,
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
      metadata: { ...metadata, attempts, sessionRevoked: revoked },
    });
  }

  /** Política local + contraseñas filtradas. Fallo cerrado si HIBP no responde (503). */
  async #assertAcceptablePassword(password: string, username: string): Promise<void> {
    const rejection = checkPasswordPolicy(password, {
      commonPasswords: this.#deps.commonPasswords,
      contextWords: [...this.#deps.contextWords, username],
    });
    if (rejection !== null) throw passwordRejected(rejection);
    let breached: boolean;
    try {
      breached = await this.#deps.breachChecker.isBreached(password);
    } catch (error) {
      if (error instanceof BreachCheckUnavailableError) {
        throw new AppError(
          'BREACH_CHECK_UNAVAILABLE',
          503,
          'No se pudo comprobar si la contraseña está filtrada. Inténtalo más tarde.',
        );
      }
      throw error;
    }
    if (breached) throw passwordRejected('breached');
  }

  /**
   * Deja constancia en la auditoría de una exportación de datos (`data.exported`). `counts` son
   * recuentos por tipo de dato: nunca los datos exportados (ASVS 16.2.5).
   */
  async recordDataExport(
    session: SessionContext,
    meta: RequestMeta,
    counts: Readonly<Record<string, number>>,
  ): Promise<void> {
    await this.#audit({
      actor: `user:${session.userId}`,
      action: 'data.exported',
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
      metadata: { counts },
    });
  }

  async #audit(event: AuditEvent): Promise<void> {
    await this.#repo.insertAuditEvent(event);
  }
}

function passwordRejected(reason: PasswordRejection | 'breached' | 'same_as_current'): AppError {
  const message = PASSWORD_REJECTION_MESSAGES[reason];
  return new AppError('PASSWORD_REJECTED', 400, message, [{ path: 'newPassword', message }]);
}
