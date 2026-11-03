/**
 * Entorno de los tests de autenticación: base de datos temporal migrada, usuario de prueba con su
 * TOTP y utilidades para iniciar sesión. Datos FICTICIOS.
 */
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createAuthService, type AuthService } from '../../src/modules/auth/index.ts';
import { base32Decode, hotp, timeStep } from '../../src/modules/auth/domain/totp.ts';
import { TEST_ORIGIN, buildTestApp, type TestApp } from './app.ts';
import { TestClient } from './client.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from './database.ts';

export const USERNAME = 'usuario-de-prueba';
export const PASSWORD = 'una frase de paso larga y ficticia';

export interface AuthTestContext {
  readonly t: TestApp;
  readonly service: AuthService;
  readonly database: TestDatabase;
  /** Códigos de recuperación del usuario de prueba. */
  readonly recoveryCodes: readonly string[];
  /** Código TOTP en el instante del reloj simulado (`offset` en pasos de 30 s). */
  totp(offset?: number): string;
  /** Cliente nuevo (otro navegador). */
  client(): TestClient;
  /** Cliente con una sesión completa (contraseña + TOTP). */
  loggedIn(): Promise<TestClient>;
}

/**
 * Registra los hooks: una base de datos por archivo; antes de cada test, aplicación nueva (reloj y
 * límites de peticiones a cero) y usuario recién creado.
 */
export function useAuthTestContext(): () => AuthTestContext {
  let database: TestDatabase;
  let context: AuthTestContext | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, DB_TIMEOUT_MS);

  afterAll(async () => {
    await database.drop();
  }, DB_TIMEOUT_MS);

  beforeEach(async () => {
    // Borrar el usuario borra en cascada sesiones, TOTP y códigos (la auditoría no se puede borrar).
    await database.db.deleteFrom('users').execute();
    const t = buildTestApp({ db: database.db });
    const service = createAuthService({
      db: database.db,
      clock: t.clock,
      totpKey: t.totpKey,
      totpKeyVersion: 1,
      breachChecker: t.breachChecker,
      publicOrigin: TEST_ORIGIN,
    });
    const credentials = await service.createInitialUser(USERNAME, PASSWORD);
    const secret = base32Decode(credentials.totpSecret);
    const ctx: AuthTestContext = {
      t,
      service,
      database,
      recoveryCodes: credentials.recoveryCodes,
      totp: (offset = 0) => hotp(secret, timeStep(t.clock.now()) + offset),
      client: () => new TestClient(t.app),
      async loggedIn() {
        const client = new TestClient(t.app);
        const login = await client.post('/api/v1/auth/login', {
          username: USERNAME,
          password: PASSWORD,
        });
        if (login.status !== 200) throw new Error(`login: ${login.status}`);
        const factor = await client.post('/api/v1/auth/login/second-factor', { totp: ctx.totp() });
        if (factor.status !== 200) throw new Error(`segundo factor: ${factor.status}`);
        // Cada código vale una vez: el siguiente uso del TOTP necesita otro paso de 30 s.
        t.clock.advance(30_000);
        return client;
      },
    };
    context = ctx;
  }, DB_TIMEOUT_MS);

  return () => {
    if (context === undefined) throw new Error('Contexto no inicializado');
    return context;
  };
}
