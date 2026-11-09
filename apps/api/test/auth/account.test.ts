/**
 * Acciones sensibles (reautenticación, contraseña, TOTP, códigos de recuperación, sesiones),
 * auditoría y operaciones de servidor. PostgreSQL real; reloj simulado; HIBP falso (sin red).
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  problemDetailsSchema,
  recoveryCodesResponseSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  totpEnrollResponseSchema,
} from '@backoffice/shared';
import { seal } from '../../src/modules/auth/crypto/secret-box.ts';
import { base32Decode, hotp, timeStep } from '../../src/modules/auth/domain/totp.ts';
import { REAUTH_WINDOW_MS } from '../../src/modules/auth/domain/session-rules.ts';
import { buildTestApp } from '../support/app.ts';
import { PASSWORD, USERNAME, useAuthTestContext } from '../support/auth.ts';
import { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext();
const NEW_PASSWORD = 'otra frase de paso larga y distinta';

function code(res: { body: unknown }): string {
  return problemDetailsSchema.parse(res.body).code;
}

/** Sesión completa cuya reautenticación del login ya expiró (10 min). */
async function staleClient(): Promise<TestClient> {
  const ctx = getCtx();
  const client = await ctx.loggedIn();
  ctx.t.clock.advance(REAUTH_WINDOW_MS);
  await client.get('/api/v1/auth/session');
  return client;
}

async function reauth(client: TestClient): Promise<void> {
  const ctx = getCtx();
  const res = await client.post('/api/v1/auth/reauth', { password: PASSWORD, totp: ctx.totp() });
  expect(res.status).toBe(200);
  ctx.t.clock.advance(30_000);
}

describe('reautenticación para acciones sensibles', () => {
  it('el login completo cuenta como reautenticación durante 10 minutos', async () => {
    const client = await getCtx().loggedIn();
    expect((await client.post('/api/v1/auth/recovery-codes')).status).toBe(200);
  });

  it('pasados 10 minutos: 403 REAUTH_REQUIRED; tras reautenticarse (contraseña + TOTP), permitido', async () => {
    const client = await staleClient();
    const denied = await client.post('/api/v1/auth/recovery-codes');
    expect(denied.status).toBe(403);
    expect(code(denied)).toBe('REAUTH_REQUIRED');
    const before = client.cookie;
    await reauth(client);
    expect(client.cookie).not.toBe(before); // rota el token (ASVS 7.2.4)
    expect((await client.post('/api/v1/auth/recovery-codes')).status).toBe(200);
  });

  it('la reautenticación exige los dos factores', async () => {
    const ctx = getCtx();
    const client = await staleClient();
    expect(
      (await client.post('/api/v1/auth/reauth', { password: PASSWORD, totp: '000000' })).status,
    ).toBe(401);
    expect(
      (await client.post('/api/v1/auth/reauth', { password: 'mal', totp: ctx.totp() })).status,
    ).toBe(401);
    // Solo la contraseña no basta (el esquema exige el TOTP).
    expect((await client.post('/api/v1/auth/reauth', { password: PASSWORD })).status).toBe(400);
  });

  it.each([
    ['post', '/api/v1/auth/password'],
    ['post', '/api/v1/auth/totp/enroll'],
    ['post', '/api/v1/auth/totp/confirm'],
    ['post', '/api/v1/auth/recovery-codes'],
    ['delete', '/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000'],
  ])('%s %s exige reautenticación reciente', async (method, path) => {
    const client = await staleClient();
    const res = method === 'delete' ? await client.delete(path) : await client.post(path, {});
    expect(res.status).toBe(403);
    expect(code(res)).toBe('REAUTH_REQUIRED');
  });
});

describe('cambio de contraseña', () => {
  const change = (
    client: TestClient,
    newPassword: string,
    currentPassword = PASSWORD,
    terminateOtherSessions = false,
  ) =>
    client.post('/api/v1/auth/password', { currentPassword, newPassword, terminateOtherSessions });

  it('exige la contraseña actual (ASVS 6.2.3)', async () => {
    const client = await getCtx().loggedIn();
    expect(code(await change(client, NEW_PASSWORD, 'no es la actual'))).toBe('INVALID_CREDENTIALS');
  });

  it.each([
    ['corta (14 caracteres)', 'a'.repeat(14)],
    ['común (lista local de 15+ caracteres)', '1qaz2wsx3edc4rfv'],
    ['con el nombre de usuario', `mi ${USERNAME} favorito`],
    ['con el nombre de la aplicación', 'el backoffice de casa'],
    ['con el dominio de PUBLIC_ORIGIN', 'mi servidor localhost de confianza'],
    ['igual que la actual', PASSWORD],
  ])('rechaza una contraseña %s', async (_label, newPassword) => {
    const client = await getCtx().loggedIn();
    const res = await change(client, newPassword);
    expect(res.status).toBe(400);
    expect(code(res)).toBe('PASSWORD_REJECTED');
  });

  it('rechaza una contraseña filtrada (HIBP)', async () => {
    const ctx = getCtx();
    ctx.t.breachChecker.breached.add(NEW_PASSWORD);
    const client = await ctx.loggedIn();
    const res = await change(client, NEW_PASSWORD);
    expect(res.status).toBe(400);
    expect(problemDetailsSchema.parse(res.body).detail).toContain('filtraciones');
  });

  it('si HIBP no responde, NO se cambia (fallo cerrado, 503) y se reintenta más tarde', async () => {
    const ctx = getCtx();
    ctx.t.breachChecker.unavailable = true;
    const client = await ctx.loggedIn();
    const res = await change(client, NEW_PASSWORD);
    expect(res.status).toBe(503);
    expect(code(res)).toBe('BREACH_CHECK_UNAVAILABLE');
    // La contraseña sigue siendo la anterior.
    expect(
      (await ctx.client().post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('cambia la contraseña y, si se pide, cierra las demás sesiones (ASVS 7.4.3)', async () => {
    const ctx = getCtx();
    const other = await ctx.loggedIn();
    const client = await ctx.loggedIn();
    expect((await change(client, NEW_PASSWORD, PASSWORD, true)).status).toBe(204);
    expect((await other.get('/api/v1/auth/session')).status).toBe(401);
    expect((await client.get('/api/v1/auth/session')).status).toBe(200);
    expect(
      (await ctx.client().post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD }))
        .status,
    ).toBe(401);
    expect(
      (
        await ctx
          .client()
          .post('/api/v1/auth/login', { username: USERNAME, password: NEW_PASSWORD })
      ).status,
    ).toBe(200);
  });
});

describe('cambio de TOTP', () => {
  it('alta de una semilla nueva, confirmación con su código y la anterior deja de valer', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const enroll = await client.post('/api/v1/auth/totp/enroll');
    expect(enroll.status).toBe(200);
    const { secret, otpauthUri } = totpEnrollResponseSchema.parse(enroll.body);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/Backoffice:/);
    const newSecret = base32Decode(secret);
    const newCode = () => hotp(newSecret, timeStep(ctx.t.clock.now()), 'SHA256');

    // Con un código incorrecto no se confirma.
    expect(
      (
        await client.post('/api/v1/auth/totp/confirm', {
          code: '000000',
          terminateOtherSessions: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post('/api/v1/auth/totp/confirm', {
          code: newCode(),
          terminateOtherSessions: false,
        })
      ).status,
    ).toBe(204);
    ctx.t.clock.advance(30_000);

    const login = ctx.client();
    await login.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (await login.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() })).status,
    ).toBe(401);
    expect((await login.post('/api/v1/auth/login/second-factor', { totp: newCode() })).status).toBe(
      200,
    );
  });

  it('al confirmar el TOTP nuevo se pueden cerrar las demás sesiones (ASVS 7.4.3)', async () => {
    const ctx = getCtx();
    const other = await ctx.loggedIn();
    const client = await ctx.loggedIn();
    const { secret } = totpEnrollResponseSchema.parse(
      (await client.post('/api/v1/auth/totp/enroll')).body,
    );
    const res = await client.post('/api/v1/auth/totp/confirm', {
      code: hotp(base32Decode(secret), timeStep(ctx.t.clock.now()), 'SHA256'),
      terminateOtherSessions: true,
    });
    expect(res.status).toBe(204);
    expect((await other.get('/api/v1/auth/session')).status).toBe(401);
    expect((await client.get('/api/v1/auth/session')).status).toBe(200);
  });

  it('el alta nueva es SHA256 con una semilla de 32 bytes: URI, base de datos y verificación (ASVS 11.4.1)', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const { secret, otpauthUri } = totpEnrollResponseSchema.parse(
      (await client.post('/api/v1/auth/totp/enroll')).body,
    );
    expect(new URL(otpauthUri).searchParams.get('algorithm')).toBe('SHA256');
    expect(base32Decode(secret)).toHaveLength(32);
    const pending = await ctx.database.db
      .selectFrom('totp_authenticators')
      .select('algorithm')
      .where('confirmed_at', 'is', null)
      .execute();
    expect(pending).toEqual([{ algorithm: 'SHA256' }]);
  });

  it('el alta no se confirma con un código calculado con el algoritmo equivocado (SHA-1)', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const { secret } = totpEnrollResponseSchema.parse(
      (await client.post('/api/v1/auth/totp/enroll')).body,
    );
    const seed = base32Decode(secret);
    const step = timeStep(ctx.t.clock.now());
    // Es lo que calcularía Google Authenticator con la clave escrita a mano (usa SHA-1).
    const wrongCode = hotp(seed, step, 'SHA1');
    expect(wrongCode).not.toBe(hotp(seed, step, 'SHA256'));
    const rejected = await client.post('/api/v1/auth/totp/confirm', {
      code: wrongCode,
      terminateOtherSessions: false,
    });
    expect(rejected.status).toBe(400);
    // El TOTP anterior sigue siendo el confirmado y el nuevo sigue pendiente.
    const rows = await ctx.database.db
      .selectFrom('totp_authenticators')
      .select(['algorithm', 'confirmed_at'])
      .orderBy('created_at')
      .execute();
    expect(rows.map((row) => [row.algorithm, row.confirmed_at !== null])).toEqual([
      ['SHA256', true],
      ['SHA256', false],
    ]);
    // Con el código del algoritmo correcto sí se confirma.
    const accepted = await client.post('/api/v1/auth/totp/confirm', {
      code: hotp(seed, step, 'SHA256'),
      terminateOtherSessions: false,
    });
    expect(accepted.status).toBe(204);
  });

  it('una credencial SHA1 anterior sigue funcionando en el inicio de sesión y no acepta códigos SHA256', async () => {
    const ctx = getCtx();
    // Se convierte la credencial del usuario de prueba en una de antes de la migración 0004: semilla
    // de 20 bytes y algoritmo SHA1.
    const legacySeed = randomBytes(20);
    const sealed = seal(ctx.t.totpKey, legacySeed);
    await ctx.database.db
      .updateTable('totp_authenticators')
      .set({
        secret_ciphertext: sealed.ciphertext,
        secret_nonce: sealed.nonce,
        algorithm: 'SHA1',
        last_used_step: null,
      })
      .execute();
    const step = () => timeStep(ctx.t.clock.now());

    const wrong = ctx.client();
    await wrong.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (
        await wrong.post('/api/v1/auth/login/second-factor', {
          totp: hotp(legacySeed, step(), 'SHA256'),
        })
      ).status,
    ).toBe(401);

    const right = ctx.client();
    await right.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (
        await right.post('/api/v1/auth/login/second-factor', {
          totp: hotp(legacySeed, step(), 'SHA1'),
        })
      ).status,
    ).toBe(200);
  });

  it('confirmar sin un alta en curso: 409', async () => {
    const client = await getCtx().loggedIn();
    expect(
      (
        await client.post('/api/v1/auth/totp/confirm', {
          code: '123456',
          terminateOtherSessions: false,
        })
      ).status,
    ).toBe(409);
  });
});

describe('códigos de recuperación', () => {
  it('regenerar devuelve 10 códigos nuevos una vez e invalida los anteriores', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const res = await client.post('/api/v1/auth/recovery-codes');
    const { codes } = recoveryCodesResponseSchema.parse(res.body);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    const old = ctx.client();
    await old.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (await old.post('/api/v1/auth/login/second-factor', { recoveryCode: ctx.recoveryCodes[1] }))
        .status,
    ).toBe(401);
    const fresh = ctx.client();
    await fresh.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect(
      (await fresh.post('/api/v1/auth/login/second-factor', { recoveryCode: codes[0] })).status,
    ).toBe(200);
  });
});

describe('sesiones', () => {
  it('lista las sesiones abiertas y permite cerrar otra (con reautenticación)', async () => {
    const ctx = getCtx();
    const other = await ctx.loggedIn();
    const client = await ctx.loggedIn();
    const { sessions } = sessionListResponseSchema.parse(
      (await client.get('/api/v1/auth/sessions')).body,
    );
    expect(sessions).toHaveLength(2);
    const target = sessions.find((s) => !s.current);
    expect((await client.delete(`/api/v1/auth/sessions/${target?.id ?? ''}`)).status).toBe(204);
    expect((await other.get('/api/v1/auth/session')).status).toBe(401);
  });

  it('como mucho 5 sesiones completas: la sexta revoca la más antigua (ASVS 7.1.2)', async () => {
    const ctx = getCtx();
    // Las 5 primeras, directamente con el servicio: por HTTP, el sexto login superaría el límite de
    // 5 por IP cada 15 minutos (que es justo lo que debe pasar).
    const meta = { ip: null, userAgent: null };
    const tokens: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const pending = await ctx.service.login(USERNAME, PASSWORD, meta);
      const session = await ctx.service.loadSession(pending.token);
      if (session === null) throw new Error('sesión pendiente no encontrada');
      tokens.push(
        (await ctx.service.completeSecondFactor(session, { totp: ctx.totp() }, meta)).token,
      );
      ctx.t.clock.advance(30_000);
    }
    const sixth = await ctx.loggedIn();
    expect(await ctx.service.loadSession(tokens[0] ?? '')).toBeNull();
    expect(await ctx.service.loadSession(tokens[1] ?? '')).not.toBeNull();
    expect((await sixth.get('/api/v1/auth/session')).status).toBe(200);
  });

  it('cerrar sesión revoca la sesión, borra la cookie y pide al navegador borrar sus datos', async () => {
    const client = await getCtx().loggedIn();
    const cookie = client.cookie;
    const res = await client.post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
    expect(res.headers['clear-site-data']).toBe('"cache", "cookies", "storage"');
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toContain('Max-Age=0');
    client.cookie = cookie;
    expect((await client.get('/api/v1/auth/session')).status).toBe(401);
  });

  it('GET /auth/session devuelve el estado y el token CSRF', async () => {
    const client = await getCtx().loggedIn();
    const body = sessionResponseSchema.parse((await client.get('/api/v1/auth/session')).body);
    expect(body).toMatchObject({ stage: 'full', state: 'active', user: { username: USERNAME } });
    expect(body.csrfToken).toBe(client.csrf);
  });
});

describe('auditoría y logs', () => {
  it('registra los eventos de autenticación, con éxito y con fallo (ASVS 16.3.1)', async () => {
    const ctx = getCtx();
    await ctx.client().post('/api/v1/auth/login', { username: USERNAME, password: 'mal' });
    const client = await ctx.loggedIn();
    await client.post('/api/v1/auth/logout');
    const actions = (
      await ctx.database.db.selectFrom('audit_events').select('action').orderBy('id').execute()
    ).map((row) => row.action);
    for (const action of [
      'user.created',
      'login.failure',
      'login.password_success',
      'mfa.success',
      'logout',
    ]) {
      expect(actions).toContain(action);
    }
  });

  it('la auditoría es de solo inserción: UPDATE, DELETE y TRUNCATE fallan (ASVS 16.4.2)', async () => {
    const { db } = getCtx().database;
    await expect(db.updateTable('audit_events').set({ action: 'x' }).execute()).rejects.toThrow(
      /solo inserción/,
    );
    await expect(db.deleteFrom('audit_events').execute()).rejects.toThrow(/solo inserción/);
    await expect(sql`TRUNCATE audit_events`.execute(db)).rejects.toThrow(/solo inserción/);
  });

  it('ni los logs ni la auditoría contienen contraseñas, códigos ni tokens', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await client.post('/api/v1/auth/password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      terminateOtherSessions: false,
    });
    const audit = JSON.stringify(
      await ctx.database.db.selectFrom('audit_events').selectAll().execute(),
    );
    const logs = JSON.stringify(ctx.t.logs());
    const sessionToken = client.cookie?.split('=')[1] ?? 'nunca';
    for (const secret of [
      PASSWORD,
      NEW_PASSWORD,
      sessionToken,
      client.csrf ?? 'nunca',
      ...ctx.recoveryCodes,
    ]) {
      expect(audit).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
  });
});

describe('operaciones de servidor (scripts)', () => {
  it('solo puede existir un usuario', async () => {
    await expect(
      getCtx().service.createInitialUser('otro-usuario', 'otra frase de paso muy larga'),
    ).rejects.toThrow(/un solo usuario/);
  });

  it('restablecer la contraseña revoca las sesiones y NO desactiva el TOTP (ASVS 6.4.3)', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await ctx.service.resetPassword(USERNAME, NEW_PASSWORD);
    expect((await client.get('/api/v1/auth/session')).status).toBe(401);
    const login = ctx.client();
    await login.post('/api/v1/auth/login', { username: USERNAME, password: NEW_PASSWORD });
    // Sigue haciendo falta el segundo factor.
    expect((await login.get('/api/v1/auth/sessions')).status).toBe(401);
    expect(
      (await login.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() })).status,
    ).toBe(200);
  });

  it('revocar todas las sesiones desde el servidor (ASVS 7.4.5)', async () => {
    const ctx = getCtx();
    const first = await ctx.loggedIn();
    const second = await ctx.loggedIn();
    expect(await ctx.service.revokeAllSessions(USERNAME)).toBe(2);
    expect((await first.get('/api/v1/auth/session')).status).toBe(401);
    expect((await second.get('/api/v1/auth/session')).status).toBe(401);
  });

  it('deshabilitar la cuenta revoca las sesiones e impide el login (ASVS 7.4.2)', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await ctx.service.disableUser(USERNAME);
    expect((await client.get('/api/v1/auth/session')).status).toBe(401);
    expect(
      (await ctx.client().post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD }))
        .status,
    ).toBe(401);
  });
});

describe('rotación de la clave de cifrado del TOTP (docs/adr/0006)', () => {
  it('el TOTP cifrado con la clave anterior falla cerrado; se entra con un código de recuperación y se da de alta otro', async () => {
    const ctx = getCtx();
    // La misma base de datos, servida con una clave nueva (versión 2).
    const rotated = buildTestApp({ db: ctx.database.db, totpKeyVersion: 2 });
    const client = new TestClient(rotated.app);
    expect(
      (await client.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD })).status,
    ).toBe(200);
    const withOldSeed = await client.post('/api/v1/auth/login/second-factor', {
      totp: ctx.totp(),
    });
    expect(withOldSeed.status).toBe(500);
    expect(code(withOldSeed)).toBe('INTERNAL_ERROR');

    const recovered = await client.post('/api/v1/auth/login/second-factor', {
      recoveryCode: ctx.recoveryCodes[0],
    });
    expect(recovered.status).toBe(200);
    const enroll = totpEnrollResponseSchema.parse(
      (await client.post('/api/v1/auth/totp/enroll')).body,
    );
    const newSecret = base32Decode(enroll.secret);
    const newCode = () => hotp(newSecret, timeStep(rotated.clock.now()), 'SHA256');
    const confirm = await client.post('/api/v1/auth/totp/confirm', {
      code: newCode(),
      terminateOtherSessions: true,
    });
    expect(confirm.status).toBe(204);
    rotated.clock.advance(30_000);

    const stored = await ctx.database.db
      .selectFrom('totp_authenticators')
      .select('key_version')
      .where('confirmed_at', 'is not', null)
      .execute();
    expect(stored).toEqual([{ key_version: 2 }]);
    const again = new TestClient(rotated.app);
    await again.post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    expect((await again.post('/api/v1/auth/login/second-factor', { totp: newCode() })).status).toBe(
      200,
    );
  });
});
