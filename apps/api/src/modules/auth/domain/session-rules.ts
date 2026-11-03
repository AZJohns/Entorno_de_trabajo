/**
 * Reglas de vida de las sesiones (docs/plan.md §6.2, docs/adr/0006). Funciones puras: la hora llega
 * como parámetro para poder probarlas con un reloj simulado.
 */

/** Vida absoluta de una sesión completa: 24 h (NIST SP 800-63B-4, AAL2: «SHOULD ≤ 24 h»). */
export const SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** Inactividad que bloquea la sesión: 1 h (NIST SP 800-63B-4, AAL2: «SHOULD ≤ 1 h»). */
export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
/** Tiempo para introducir el segundo factor tras la contraseña. */
export const MFA_PENDING_LIFETIME_MS = 5 * 60 * 1000;
/** Ventana tras una reautenticación completa en la que se permiten las acciones sensibles. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
/** Intentos fallidos de segundo factor, desbloqueo o reautenticación antes de revocar la sesión. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Sesiones completas simultáneas; al abrir otra, se revoca la más antigua (ASVS 7.1.2). */
export const MAX_CONCURRENT_SESSIONS = 5;

/** Estado de una sesión en un instante dado. */
export type SessionState = 'revoked' | 'expired' | 'pending' | 'locked' | 'active';

/** Datos mínimos de una sesión para calcular su estado. */
export interface SessionTimes {
  readonly stage: 'mfa_pending' | 'full';
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
}

/**
 * Estado de la sesión en `now`.
 *
 * - `locked`: completa, sin usar durante 1 h y dentro de su vida absoluta. Se desbloquea con un solo
 *   factor (contraseña o passkey) junto con la cookie, como permite NIST; no se revoca.
 * - `expired`: pasada su vida absoluta (24 h, o 5 min si está pendiente del segundo factor).
 */
export function sessionState(session: SessionTimes, now: Date): SessionState {
  if (session.revokedAt !== null) return 'revoked';
  if (now.getTime() >= session.expiresAt.getTime()) return 'expired';
  if (session.stage === 'mfa_pending') return 'pending';
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_IDLE_TIMEOUT_MS) return 'locked';
  return 'active';
}

/** Indica si hubo una reautenticación completa en los últimos 10 minutos (ASVS 7.5.1). */
export function hasRecentReauth(reauthenticatedAt: Date | null, now: Date): boolean {
  return (
    reauthenticatedAt !== null && now.getTime() - reauthenticatedAt.getTime() < REAUTH_WINDOW_MS
  );
}
