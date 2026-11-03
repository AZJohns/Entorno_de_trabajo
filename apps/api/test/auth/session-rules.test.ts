import { describe, expect, it } from 'vitest';
import {
  MFA_PENDING_LIFETIME_MS,
  REAUTH_WINDOW_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
  hasRecentReauth,
  sessionState,
} from '../../src/modules/auth/domain/session-rules.ts';

const t0 = new Date('2026-11-03T10:00:00Z');
const at = (ms: number): Date => new Date(t0.getTime() + ms);
const full = {
  stage: 'full' as const,
  revokedAt: null,
  lastSeenAt: t0,
  expiresAt: at(SESSION_ABSOLUTE_LIFETIME_MS),
};

describe('reglas de sesión', () => {
  it('24 h de vida absoluta y 1 h de inactividad (NIST 800-63B-4, AAL2)', () => {
    expect(SESSION_ABSOLUTE_LIFETIME_MS).toBe(24 * 60 * 60 * 1000);
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(60 * 60 * 1000);
  });

  it('activa mientras no pase 1 h sin uso', () => {
    expect(sessionState(full, at(SESSION_IDLE_TIMEOUT_MS - 1))).toBe('active');
  });

  it('bloqueada al cumplir 1 h sin uso, dentro de las 24 h', () => {
    expect(sessionState(full, at(SESSION_IDLE_TIMEOUT_MS))).toBe('locked');
  });

  it('caducada al cumplir 24 h, aunque se haya usado hace un momento', () => {
    const recent = { ...full, lastSeenAt: at(SESSION_ABSOLUTE_LIFETIME_MS - 1000) };
    expect(sessionState(recent, at(SESSION_ABSOLUTE_LIFETIME_MS))).toBe('expired');
  });

  it('revocada siempre gana', () => {
    expect(sessionState({ ...full, revokedAt: t0 }, t0)).toBe('revoked');
  });

  it('pendiente de segundo factor durante 5 minutos', () => {
    const pending = {
      ...full,
      stage: 'mfa_pending' as const,
      expiresAt: at(MFA_PENDING_LIFETIME_MS),
    };
    expect(sessionState(pending, at(MFA_PENDING_LIFETIME_MS - 1))).toBe('pending');
    expect(sessionState(pending, at(MFA_PENDING_LIFETIME_MS))).toBe('expired');
  });

  it('reautenticación válida durante 10 minutos', () => {
    expect(hasRecentReauth(null, t0)).toBe(false);
    expect(hasRecentReauth(t0, at(REAUTH_WINDOW_MS - 1))).toBe(true);
    expect(hasRecentReauth(t0, at(REAUTH_WINDOW_MS))).toBe(false);
  });
});
