/**
 * Límites de peticiones de la autenticación (docs/seguridad/limites.md §1; ASVS 2.4.1, 6.1.1, 6.3.1).
 *
 * La app confía en un proxy (`trustProxyHops: 1`) para que cada cliente pueda simular su IP con
 * `X-Forwarded-For`. Las IP son de documentación (203.0.113.0/24, RFC 5737).
 *
 * En los tests de los segundos factores, la última petición lleva credenciales CORRECTAS y una sesión
 * válida: así el 429 solo puede venir del límite por IP, no de la guarda ni de los fallos por sesión.
 * Después se repite la misma petición desde otra IP y se acepta.
 */
import type request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemDetailsSchema } from '@backoffice/shared';
import { SESSION_IDLE_TIMEOUT_MS } from '../../src/modules/auth/domain/session-rules.ts';
import { PASSWORD, USERNAME, useAuthTestContext, type AuthTestContext } from '../support/auth.ts';
import type { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext({ trustProxyHops: 1 });

/**
 * Los tests que hacen muchos inicios de sesión calculan un Argon2id de 64 MiB por intento (unos 130 ms
 * en solitario). Con todos los archivos en paralelo superan los 5 s por defecto de Vitest.
 */
const MANY_HASHES_TIMEOUT_MS = 30_000;

const SETUP_IP = '203.0.113.1';
const ATTACKER_IP = '203.0.113.2';
const OTHER_IP = '203.0.113.3';

function code(res: request.Response): string {
  return problemDetailsSchema.parse(res.body).code;
}

/** Repite una petición fallida `times` veces y comprueba que la rechaza la credencial, no el límite. */
async function failTimes(times: number, send: () => Promise<request.Response>): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const res = await send();
    expect(res.status).toBe(401);
    expect(code(res)).toBe('INVALID_CREDENTIALS');
  }
}

/**
 * Reparte 10 fallos entre tres sesiones (4 + 4 + 2): ninguna llega a los 5 fallos que la revocan.
 * Devuelve la tercera sesión, que sigue siendo válida.
 */
async function tenFailuresAcrossSessions(
  sessions: readonly [TestClient, TestClient, TestClient],
  fail: (client: TestClient) => Promise<request.Response>,
): Promise<TestClient> {
  const [a, b, c] = sessions;
  await failTimes(4, () => fail(a));
  await failTimes(4, () => fail(b));
  await failTimes(2, () => fail(c));
  return c;
}

/** Usa una sesión ya abierta desde otra IP (la sesión no está ligada a la IP). */
function sameSessionFrom(ctx: AuthTestContext, source: TestClient, ip: string): TestClient {
  const client = ctx.client(ip);
  client.cookie = source.cookie;
  client.csrf = source.csrf;
  return client;
}

describe('login', () => {
  it(
    'el sexto intento desde la misma IP en 15 minutos recibe 429, aunque la contraseña sea correcta',
    { timeout: MANY_HASHES_TIMEOUT_MS },
    async () => {
      const ctx = getCtx();
      await failTimes(5, () =>
        ctx.client(ATTACKER_IP).post('/api/v1/auth/login', { username: USERNAME, password: 'mal' }),
      );
      const sixth = await ctx
        .client(ATTACKER_IP)
        .post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
      expect(sixth.status).toBe(429);
      expect(code(sixth)).toBe('RATE_LIMITED');
      expect(sixth.headers['ratelimit-policy']).toBeDefined();
    },
  );

  it(
    'las peticiones que rechaza el límite por IP no gastan el cupo global: otra IP aún puede entrar',
    { timeout: MANY_HASHES_TIMEOUT_MS },
    async () => {
      const ctx = getCtx();
      // 20 intentos desde una sola IP: 5 llegan a comprobarse y 15 los corta el límite por IP.
      const statuses: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        statuses.push(
          (
            await ctx
              .client(ATTACKER_IP)
              .post('/api/v1/auth/login', { username: USERNAME, password: 'mal' })
          ).status,
        );
      }
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(15);

      const owner = await ctx
        .client(OTHER_IP)
        .post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
      expect(owner.status).toBe(200);
    },
  );

  it(
    'límite global: el intento 21 de la hora recibe 429 aunque cada IP sea distinta',
    { timeout: MANY_HASHES_TIMEOUT_MS },
    async () => {
      const ctx = getCtx();
      for (let i = 0; i < 20; i += 1) {
        const res = await ctx
          .client(`203.0.113.${100 + i}`)
          .post('/api/v1/auth/login', { username: USERNAME, password: 'mal' });
        expect(res.status).toBe(401);
      }
      const res = await ctx
        .client('203.0.113.200')
        .post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
      expect(res.status).toBe(429);
      expect(code(res)).toBe('RATE_LIMITED');
    },
  );
});

describe('segundo factor, desbloqueo y reautenticación (límite común: 10 cada 15 min por IP)', () => {
  it(
    'segundo factor: tras 10 fallos desde una IP, el undécimo intento (código correcto) recibe 429',
    { timeout: MANY_HASHES_TIMEOUT_MS },
    async () => {
      const ctx = getCtx();
      // Tres sesiones pendientes abiertas desde otra IP (el login tiene su propio límite).
      const pending: TestClient[] = [];
      for (let i = 0; i < 3; i += 1) {
        const setup = ctx.client(SETUP_IP);
        expect(
          (await setup.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD }))
            .status,
        ).toBe(200);
        pending.push(sameSessionFrom(ctx, setup, ATTACKER_IP));
      }
      const [a, b, c] = pending as [TestClient, TestClient, TestClient];
      const session = await tenFailuresAcrossSessions([a, b, c], (client) =>
        client.post('/api/v1/auth/login/second-factor', { totp: '000000' }),
      );

      const eleventh = await session.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() });
      expect(eleventh.status).toBe(429);
      expect(code(eleventh)).toBe('RATE_LIMITED');

      const fromOtherIp = sameSessionFrom(ctx, session, OTHER_IP);
      expect(
        (await fromOtherIp.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() })).status,
      ).toBe(200);
    },
  );

  it(
    'desbloqueo: tras 10 fallos desde una IP, el undécimo intento (contraseña correcta) recibe 429',
    { timeout: MANY_HASHES_TIMEOUT_MS },
    async () => {
      const ctx = getCtx();
      const sessions: TestClient[] = [];
      for (let i = 0; i < 3; i += 1) sessions.push(await ctx.loggedIn(SETUP_IP));
      ctx.t.clock.advance(SESSION_IDLE_TIMEOUT_MS); // 1 h sin uso: las tres quedan bloqueadas
      const locked: TestClient[] = [];
      for (const s of sessions) {
        const client = sameSessionFrom(ctx, s, ATTACKER_IP);
        await client.get('/api/v1/auth/session'); // token CSRF, como haría la web
        locked.push(client);
      }
      const [a, b, c] = locked as [TestClient, TestClient, TestClient];
      const session = await tenFailuresAcrossSessions([a, b, c], (client) =>
        client.post('/api/v1/auth/unlock', { password: 'no es la contraseña' }),
      );

      const eleventh = await session.post('/api/v1/auth/unlock', { password: PASSWORD });
      expect(eleventh.status).toBe(429);
      expect(code(eleventh)).toBe('RATE_LIMITED');

      const fromOtherIp = sameSessionFrom(ctx, session, OTHER_IP);
      expect((await fromOtherIp.post('/api/v1/auth/unlock', { password: PASSWORD })).status).toBe(
        200,
      );
    },
  );

  it(
    'reautenticación: tras 10 fallos desde una IP, el undécimo intento (credenciales correctas) recibe 429',
    { timeout: MANY_HASHES_TIMEOUT_MS },
    async () => {
      const ctx = getCtx();
      const active: TestClient[] = [];
      for (let i = 0; i < 3; i += 1) {
        active.push(sameSessionFrom(ctx, await ctx.loggedIn(SETUP_IP), ATTACKER_IP));
      }
      const [a, b, c] = active as [TestClient, TestClient, TestClient];
      const session = await tenFailuresAcrossSessions([a, b, c], (client) =>
        client.post('/api/v1/auth/reauth', { password: 'no es la contraseña', totp: '000000' }),
      );

      const eleventh = await session.post('/api/v1/auth/reauth', {
        password: PASSWORD,
        totp: ctx.totp(),
      });
      expect(eleventh.status).toBe(429);
      expect(code(eleventh)).toBe('RATE_LIMITED');

      const fromOtherIp = sameSessionFrom(ctx, session, OTHER_IP);
      expect(
        (await fromOtherIp.post('/api/v1/auth/reauth', { password: PASSWORD, totp: ctx.totp() }))
          .status,
      ).toBe(200);
    },
  );
});
