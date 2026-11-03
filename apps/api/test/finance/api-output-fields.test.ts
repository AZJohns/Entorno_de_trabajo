/**
 * Campos de salida (ASVS 8.1.2 y 15.3.1): ninguna respuesta de la API lleva hashes, semillas, códigos
 * de recuperación ni contraseñas, ni siquiera las de la propia cuenta.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthTestContext } from '../support/auth.ts';
import { createAccount, createCategory, createMovement, resetLedger } from '../support/ledger.ts';

const getCtx = useAuthTestContext();

beforeEach(async () => {
  await resetLedger(getCtx().database.db);
});

/** Todas las claves, a cualquier profundidad. */
function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keysOf(inner, found);
    }
  }
  return found;
}

const SENSITIVE_KEY = /password|hash|secret|seed|totp|recovery|cookie|salt/iu;

describe('las respuestas no llevan credenciales', () => {
  it('sesión, lista de sesiones, cuentas, categorías, movimientos e informes', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const account = await createAccount(client);
    const category = await createCategory(client, 'expense');
    await createMovement(client, { accountId: account.id, categoryId: category.id });
    const paths = [
      '/auth/session',
      '/auth/sessions',
      '/accounts',
      '/categories',
      '/movements',
      '/transfers',
      '/reports/monthly?from=2026-10&to=2026-10',
      '/reports/balances?at=2026-10-31',
    ];
    for (const path of paths) {
      const res = await client.get(`/api/v1${path}`);
      expect(res.status, path).toBe(200);
      for (const key of keysOf(res.body))
        expect(key, `${path} → ${key}`).not.toMatch(SENSITIVE_KEY);
    }
  });
});
