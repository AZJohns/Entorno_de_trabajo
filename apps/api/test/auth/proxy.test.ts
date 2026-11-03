/**
 * IP de la petición y TRUST_PROXY_HOPS (docs/seguridad/limites.md, ASVS 4.1.3 y 15.3.4).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, TEST_ORIGIN } from '../support/app.ts';
import { USERNAME, useAuthTestContext } from '../support/auth.ts';

const getCtx = useAuthTestContext();

async function auditedIpAfterFailedLogin(trustProxyHops: number): Promise<string | null> {
  const { database } = getCtx();
  const { app } = buildTestApp({ db: database.db, trustProxyHops });
  await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', TEST_ORIGIN)
    .set('X-Forwarded-For', '203.0.113.7')
    .send({ username: USERNAME, password: 'incorrecta' });
  const row = await database.db
    .selectFrom('audit_events')
    .select('ip')
    .where('action', '=', 'login.failure')
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  return row.ip;
}

describe('IP de la petición', () => {
  it('sin proxy de confianza (por defecto), X-Forwarded-For se ignora: no se puede falsificar la IP', async () => {
    const ip = await auditedIpAfterFailedLogin(0);
    expect(ip).not.toBe('203.0.113.7');
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('con TRUST_PROXY_HOPS=1 (detrás de Caddy, fase 2) se usa la IP que añade el proxy', async () => {
    expect(await auditedIpAfterFailedLogin(1)).toBe('203.0.113.7');
  });
});
