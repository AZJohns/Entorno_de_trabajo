/**
 * Cabeceras de seguridad comunes (helmet + `no-store`) y registro de las peticiones rechazadas.
 * No necesitan base de datos: ninguna de estas peticiones llega a consultarla.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TEST_ORIGIN, buildTestApp } from './support/app.ts';

describe('cabeceras de seguridad de la API', () => {
  it('HSTS de 1 año, nosniff, no-referrer, no-store y sin CORS (ASVS 3.4.1, 3.4.2, 3.4.4, 3.4.5, 14.3.2)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://otra-web.test');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['permissions-policy']).toMatch(
      /^camera=\(\), microphone=\(\), geolocation=\(\)/,
    );
  });

  it('CSP estricta: solo el propio origen, sin inline ni eval, sin marcos (ASVS 3.4.3, 3.4.6)', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/health');
    const csp = String(res.headers['content-security-policy']);
    const directives = new Map(
      csp.split(';').map((d) => {
        const [name = '', ...values] = d.trim().split(/\s+/);
        return [name, values.join(' ')] as const;
      }),
    );
    expect(directives.get('default-src')).toBe("'self'");
    expect(directives.get('script-src')).toBe("'self'");
    expect(directives.get('connect-src')).toBe("'self'");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('frame-ancestors')).toBe("'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });
});

describe('registro de las peticiones rechazadas (ASVS 16.3.2, 16.3.3)', () => {
  it('sin sesión: se registra el código como aviso (warn)', async () => {
    const t = buildTestApp();
    const res = await request(t.app).get('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    const line = t.logs().find((l) => l.code === 'UNAUTHENTICATED');
    expect(line).toMatchObject({ level: 40, msg: 'Petición rechazada' });
  });

  it('CSRF (origen de otra web): se registra el código, nunca el cuerpo de la petición', async () => {
    const t = buildTestApp();
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://otra-web.test')
      .send({ username: 'demo', password: 'contraseña-que-no-debe-registrarse' });
    expect(res.status).toBe(403);
    expect(t.logs().find((l) => l.code === 'CSRF_FAILED')).toMatchObject({ level: 40 });
    expect(JSON.stringify(t.logs())).not.toContain('contraseña-que-no-debe-registrarse');
  });

  it('fallo de validación: se registran el código y los campos, no sus valores', async () => {
    const t = buildTestApp();
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'demo', password: 'valor-secreto-de-prueba', extra: 'otro-valor' });
    expect(res.status).toBe(400);
    expect(t.logs().find((l) => l.code === 'VALIDATION_ERROR')).toMatchObject({ level: 40 });
    const logs = JSON.stringify(t.logs());
    expect(logs).not.toContain('valor-secreto-de-prueba');
    expect(logs).not.toContain('otro-valor');
  });

  it('el origen correcto no se registra como rechazo', async () => {
    const t = buildTestApp();
    await request(t.app).get('/api/v1/health').set('Origin', TEST_ORIGIN);
    expect(t.logs().some((l) => l.level === 40)).toBe(false);
  });
});
