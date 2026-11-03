/**
 * Inicio de sesión en dos pasos, caducidad, bloqueo por inactividad, desbloqueo, CSRF, origen, límites
 * de peticiones y denegación por defecto. PostgreSQL real; reloj simulado; sin red.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemDetailsSchema, sessionResponseSchema } from '@backoffice/shared';
import {
  MFA_PENDING_LIFETIME_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from '../../src/modules/auth/domain/session-rules.ts';
import { PASSWORD, USERNAME, useAuthTestContext } from '../support/auth.ts';
import { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext();

function code(res: request.Response): string {
  return problemDetailsSchema.parse(res.body).code;
}

describe('login con contraseña (primer paso)', () => {
  it('correcto: crea una sesión pendiente del segundo factor con cookie segura', async () => {
    const client = getCtx().client();
    const res = await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ next: 'second-factor' });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toMatch(
      /^__Host-sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('el nombre de usuario no distingue mayúsculas; la contraseña sí y no se recorta', async () => {
    const ctx = getCtx();
    expect(
      (
        await ctx
          .client()
          .post('/api/v1/auth/login', { username: USERNAME.toUpperCase(), password: PASSWORD })
      ).status,
    ).toBe(200);
    for (const password of [PASSWORD.toUpperCase(), ` ${PASSWORD}`, `${PASSWORD} `]) {
      const res = await ctx.client().post('/api/v1/auth/login', { username: USERNAME, password });
      expect(res.status).toBe(401);
    }
  });

  it('incorrecto: 401 INVALID_CREDENTIALS, igual si el usuario no existe, y sin cookie', async () => {
    const ctx = getCtx();
    const wrong = await ctx
      .client()
      .post('/api/v1/auth/login', { username: USERNAME, password: 'otra cosa' });
    const unknown = await ctx
      .client()
      .post('/api/v1/auth/login', { username: 'nadie', password: PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(code(res)).toBe('INVALID_CREDENTIALS');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    // El mensaje no revela si el usuario existe.
    expect(problemDetailsSchema.parse(wrong.body).detail).toBe(
      problemDetailsSchema.parse(unknown.body).detail,
    );
  });

  it('la sesión pendiente no da acceso: solo permite el segundo factor', async () => {
    const client = getCtx().client();
    await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    const res = await client.get('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    expect(code(res)).toBe('UNAUTHENTICATED');
  });

  it('la sesión pendiente caduca a los 5 minutos', async () => {
    const ctx = getCtx();
    const client = ctx.client();
    await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    ctx.t.clock.advance(MFA_PENDING_LIFETIME_MS);
    const res = await client.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() });
    expect(res.status).toBe(401);
  });
});

describe('segundo factor (TOTP y códigos de recuperación)', () => {
  it('TOTP correcto: token NUEVO (rotación) y sesión completa de 24 h', async () => {
    const ctx = getCtx();
    const client = ctx.client();
    await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    const pendingCookie = client.cookie;
    const res = await client.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() });
    expect(res.status).toBe(200);
    const session = sessionResponseSchema.parse(res.body);
    expect(session).toMatchObject({ stage: 'full', state: 'active', user: { username: USERNAME } });
    expect(new Date(session.expiresAt).getTime() - ctx.t.clock.now().getTime()).toBe(
      SESSION_ABSOLUTE_LIFETIME_MS,
    );
    expect(client.cookie).not.toBe(pendingCookie);
    // El token anterior ya no sirve (ASVS 7.2.4).
    const old = new TestClient(ctx.t.app);
    old.cookie = pendingCookie;
    expect((await old.get('/api/v1/auth/session')).status).toBe(401);
  });

  it('acepta el código del paso anterior (desfase de reloj) y rechaza el de hace dos pasos', async () => {
    const ctx = getCtx();
    const first = ctx.client();
    await first.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (await first.post('/api/v1/auth/login/second-factor', { totp: ctx.totp(-2) })).status,
    ).toBe(401);
    expect(
      (await first.post('/api/v1/auth/login/second-factor', { totp: ctx.totp(-1) })).status,
    ).toBe(200);
  });

  it('un código TOTP solo vale una vez (ASVS 6.5.1)', async () => {
    const ctx = getCtx();
    const totp = ctx.totp();
    const a = ctx.client();
    await a.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect((await a.post('/api/v1/auth/login/second-factor', { totp })).status).toBe(200);
    const b = ctx.client();
    await b.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    const reused = await b.post('/api/v1/auth/login/second-factor', { totp });
    expect(reused.status).toBe(401);
    expect(code(reused)).toBe('INVALID_CREDENTIALS');
  });

  it('código de recuperación: vale una sola vez y admite minúsculas sin guiones', async () => {
    const ctx = getCtx();
    const recovery = ctx.recoveryCodes[0] ?? '';
    const a = ctx.client();
    await a.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    const ok = await a.post('/api/v1/auth/login/second-factor', {
      recoveryCode: recovery.toLowerCase().replaceAll('-', ''),
    });
    expect(ok.status).toBe(200);
    const b = ctx.client();
    await b.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (await b.post('/api/v1/auth/login/second-factor', { recoveryCode: recovery })).status,
    ).toBe(401);
  });

  it('5 fallos de segundo factor revocan la sesión pendiente', async () => {
    const ctx = getCtx();
    const client = ctx.client();
    await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await client.post('/api/v1/auth/login/second-factor', { totp: '000000' })).status,
      ).toBe(401);
    }
    // Ni siquiera el código correcto sirve ya: hay que volver a empezar.
    expect(
      (await client.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() })).status,
    ).toBe(401);
  });
});

describe('caducidad absoluta (24 h) y bloqueo por inactividad (1 h)', () => {
  it('a las 24 h la sesión caduca aunque se use continuamente', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    // Uso cada 50 minutos: nunca llega a bloquearse, pero sí a caducar.
    for (
      let elapsed = 0;
      elapsed < SESSION_ABSOLUTE_LIFETIME_MS - 60 * 60 * 1000;
      elapsed += 50 * 60 * 1000
    ) {
      ctx.t.clock.advance(50 * 60 * 1000);
      expect((await client.get('/api/v1/auth/sessions')).status).toBe(200);
    }
    ctx.t.clock.advance(60 * 60 * 1000);
    const res = await client.get('/api/v1/auth/session');
    expect(res.status).toBe(401);
    expect(code(res)).toBe('UNAUTHENTICATED');
  });

  it('tras 1 h sin uso, la sesión se bloquea: 401 SESSION_LOCKED en las rutas protegidas', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    // loggedIn() ya avanzó 30 s desde la última actividad (el login): justo antes de 1 h, sigue activa.
    ctx.t.clock.advance(SESSION_IDLE_TIMEOUT_MS - 30_000 - 1000);
    expect((await client.get('/api/v1/auth/sessions')).status).toBe(200);
    ctx.t.clock.advance(SESSION_IDLE_TIMEOUT_MS);
    const res = await client.get('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    expect(code(res)).toBe('SESSION_LOCKED');
    // La sesión sigue existiendo: el cliente puede consultar su estado y obtener el token CSRF.
    const state = await client.get('/api/v1/auth/session');
    expect(state.status).toBe(200);
    expect(sessionResponseSchema.parse(state.body).state).toBe('locked');
  });
});

describe('desbloqueo tras inactividad (un solo factor, NIST 800-63B-4)', () => {
  async function lockedClient() {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    ctx.t.clock.advance(SESSION_IDLE_TIMEOUT_MS);
    await client.get('/api/v1/auth/session'); // refresca el token CSRF, como haría la web
    return { ctx, client };
  }

  it('solo con la contraseña (sin TOTP): rota el token y vuelve a dar acceso', async () => {
    const { ctx, client } = await lockedClient();
    const before = client.cookie;
    const res = await client.post('/api/v1/auth/unlock', { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(sessionResponseSchema.parse(res.body).state).toBe('active');
    expect(client.cookie).not.toBe(before);
    expect((await client.get('/api/v1/auth/sessions')).status).toBe(200);
    const old = new TestClient(ctx.t.app);
    old.cookie = before;
    expect((await old.get('/api/v1/auth/session')).status).toBe(401);
  });

  it('no habilita las acciones sensibles: siguen exigiendo reautenticación completa', async () => {
    const { ctx, client } = await lockedClient();
    await client.post('/api/v1/auth/unlock', { password: PASSWORD });
    const res = await client.post('/api/v1/auth/recovery-codes');
    expect(res.status).toBe(403);
    expect(code(res)).toBe('REAUTH_REQUIRED');
    expect(ctx).toBeDefined();
  });

  it('no se puede desbloquear pasadas las 24 h, ni una sesión pendiente o inexistente', async () => {
    const { ctx, client } = await lockedClient();
    ctx.t.clock.advance(SESSION_ABSOLUTE_LIFETIME_MS);
    expect((await client.post('/api/v1/auth/unlock', { password: PASSWORD })).status).toBe(401);

    const pending = ctx.client();
    await pending.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect((await pending.post('/api/v1/auth/unlock', { password: PASSWORD })).status).toBe(401);

    const anonymous = ctx.client();
    expect((await anonymous.post('/api/v1/auth/unlock', { password: PASSWORD })).status).toBe(401);
  });

  it('una sesión activa no necesita desbloqueo (409)', async () => {
    const client = await getCtx().loggedIn();
    expect((await client.post('/api/v1/auth/unlock', { password: PASSWORD })).status).toBe(409);
  });

  it('5 intentos fallidos revocan la sesión', async () => {
    const { client } = await lockedClient();
    for (let i = 0; i < 5; i += 1) {
      const res = await client.post('/api/v1/auth/unlock', { password: 'no es la contraseña' });
      expect(res.status).toBe(401);
      expect(code(res)).toBe('INVALID_CREDENTIALS');
    }
    expect((await client.post('/api/v1/auth/unlock', { password: PASSWORD })).status).toBe(401);
    expect((await client.get('/api/v1/auth/session')).status).toBe(401);
  });
});

describe('CSRF y origen', () => {
  it('sin token CSRF o con uno incorrecto: 403 CSRF_FAILED', async () => {
    const client = await getCtx().loggedIn();
    client.sendCsrf = false;
    const missing = await client.post('/api/v1/auth/logout');
    expect(missing.status).toBe(403);
    expect(code(missing)).toBe('CSRF_FAILED');
    client.sendCsrf = true;
    const real = client.csrf;
    client.csrf = 'token-inventado';
    expect((await client.post('/api/v1/auth/logout')).status).toBe(403);
    client.csrf = real;
    expect((await client.post('/api/v1/auth/logout')).status).toBe(204);
  });

  it('Origin de otra web o ausente (sin Sec-Fetch-Site): 403, también en el login', async () => {
    const ctx = getCtx();
    const evil = ctx.client();
    evil.origin = 'https://web-maliciosa.example';
    expect(
      (await evil.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD })).status,
    ).toBe(403);
    const none = ctx.client();
    none.origin = undefined;
    expect(
      (await none.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD })).status,
    ).toBe(403);
    const sameSite = await request(ctx.t.app)
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ username: USERNAME, password: PASSWORD });
    expect(sameSite.status).toBe(200);
  });

  it('las peticiones con cuerpo deben ser JSON (415)', async () => {
    const res = await request(getCtx().t.app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('username=a&password=b');
    expect(res.status).toBe(415);
  });

  it('campos desconocidos: 400 (protección contra la asignación masiva)', async () => {
    const res = await getCtx().client().post('/api/v1/auth/login', {
      username: USERNAME,
      password: PASSWORD,
      isAdmin: true,
    });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_ERROR');
  });
});

describe('límites de peticiones', () => {
  it('login: el sexto intento desde la misma IP en 15 minutos recibe 429', async () => {
    const ctx = getCtx();
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await ctx.client().post('/api/v1/auth/login', { username: USERNAME, password: 'mal' }))
          .status,
      ).toBe(401);
    }
    const sixth = await ctx
      .client()
      .post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(sixth.status).toBe(429);
    expect(code(sixth)).toBe('RATE_LIMITED');
    expect(sixth.headers['ratelimit-policy']).toBeDefined();
  });

  it('segundo factor: el undécimo intento desde la misma IP recibe 429', async () => {
    const ctx = getCtx();
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      const client = ctx.client();
      // Cada sesión pendiente admite 5 fallos; se usan varias para llegar al límite por IP.
      if (i % 4 === 0) {
        await ctx.database.db.deleteFrom('sessions').execute();
      }
      await client
        .post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD })
        .catch(() => undefined);
      last = (await client.post('/api/v1/auth/login/second-factor', { totp: '000000' })).status;
    }
    expect(last).toBe(429);
  });
});

describe('denegar por defecto', () => {
  const protectedRoutes: [string, string][] = [
    ['get', '/api/v1/auth/session'],
    ['post', '/api/v1/auth/logout'],
    ['post', '/api/v1/auth/reauth'],
    ['post', '/api/v1/auth/password'],
    ['post', '/api/v1/auth/totp/enroll'],
    ['post', '/api/v1/auth/totp/confirm'],
    ['post', '/api/v1/auth/recovery-codes'],
    ['get', '/api/v1/auth/sessions'],
    ['delete', '/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000'],
    ['post', '/api/v1/auth/login/second-factor'],
    ['post', '/api/v1/auth/unlock'],
    // Rutas que no existen: también 401 sin sesión (no se puede descubrir qué rutas hay).
    ['get', '/api/v1/no-existe'],
    ['post', '/api/v1/finanzas/movimientos'],
  ];

  it.each(protectedRoutes)('%s %s sin sesión → 401', async (method, path) => {
    const client = getCtx().client();
    const res =
      method === 'get'
        ? await client.get(path)
        : method === 'delete'
          ? await client.delete(path)
          : await client.post(path, {});
    expect(res.status).toBe(401);
  });

  it('las únicas rutas públicas son GET /health y POST /auth/login', async () => {
    const client = getCtx().client();
    expect((await client.get('/api/v1/health')).status).toBe(200);
    expect(
      (await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD })).status,
    ).toBe(200);
  });

  it('con sesión, una ruta inexistente es 404', async () => {
    const client = await getCtx().loggedIn();
    expect((await client.get('/api/v1/no-existe')).status).toBe(404);
  });
});
