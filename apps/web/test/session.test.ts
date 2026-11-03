import type { SessionResponse } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import { HOME_OF, hasRecentReauth, placeOf, safeInternalPath } from '../src/auth/session.ts';

describe('safeInternalPath (redirección abierta, ASVS 3.7.2)', () => {
  it.each(['/', '/ajustes/seguridad', '/ajustes/seguridad?pestaña=1'])('acepta %s', (path) => {
    expect(safeInternalPath(path)).toBe(path);
  });

  it.each([
    null,
    '',
    'https://ejemplo.test',
    '//ejemplo.test',
    '/\\ejemplo.test',
    'javascript:alert(1)',
    'ajustes',
  ])('rechaza %s y devuelve /', (value) => {
    expect(safeInternalPath(value)).toBe('/');
  });
});

const base: SessionResponse = {
  user: { username: 'demo' },
  stage: 'full',
  state: 'active',
  csrfToken: 'x',
  expiresAt: '2026-01-02T00:00:00.000Z',
  idleExpiresAt: '2026-01-01T01:00:00.000Z',
  reauthenticatedUntil: null,
};

describe('estado de la sesión en la web', () => {
  it('sin sesión lleva al login; cada estado tiene su pantalla', () => {
    expect(HOME_OF[placeOf(null)]).toBe('/entrar');
    expect(HOME_OF[placeOf({ ...base, stage: 'mfa_pending', state: 'pending' })]).toBe(
      '/entrar/segundo-factor',
    );
    expect(HOME_OF[placeOf({ ...base, state: 'locked' })]).toBe('/desbloquear');
    expect(HOME_OF[placeOf(base)]).toBe('/');
  });

  it('la reautenticación solo cuenta hasta reauthenticatedUntil', () => {
    const now = Date.parse('2026-01-01T00:05:00.000Z');
    expect(hasRecentReauth(base, now)).toBe(false);
    const recent = { ...base, reauthenticatedUntil: '2026-01-01T00:10:00.000Z' };
    expect(hasRecentReauth(recent, now)).toBe(true);
    expect(hasRecentReauth(recent, Date.parse('2026-01-01T00:10:00.000Z'))).toBe(false);
  });
});
