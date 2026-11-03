/**
 * Aplicación de prueba: reloj simulado, HIBP falso (los tests NUNCA salen a la red) y logger capturado.
 */
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import type { Kysely } from 'kysely';
import { createApp } from '../../src/app.ts';
import { createDatabase } from '../../src/db/database.ts';
import type { Database } from '../../src/db/schema.ts';
import type { PasswordBreachChecker } from '../../src/modules/auth/index.ts';
import { captureLogger } from '../helpers.ts';
import { FakeClock } from './clock.ts';

/** Origen público que usan los tests (no es un dominio real). */
export const TEST_ORIGIN = 'http://localhost:5173';

/** HIBP falso: considera filtradas las contraseñas de la lista; puede simular que no responde. */
export class FakeBreachChecker implements PasswordBreachChecker {
  readonly breached = new Set<string>();
  unavailable = false;
  calls = 0;

  async isBreached(password: string): Promise<boolean> {
    this.calls += 1;
    if (this.unavailable) {
      const { BreachCheckUnavailableError } = await import('../../src/modules/auth/infra/hibp.ts');
      throw new BreachCheckUnavailableError();
    }
    return this.breached.has(password);
  }
}

/** Elementos de una aplicación de prueba. */
export interface TestApp {
  readonly app: Express;
  readonly clock: FakeClock;
  readonly breachChecker: FakeBreachChecker;
  readonly totpKey: Buffer;
  readonly logs: () => Record<string, unknown>[];
}

/**
 * Crea la aplicación de prueba. Sin `db`, usa una conexión que nunca se abre (sirve para las rutas que
 * no consultan la base de datos).
 */
export function buildTestApp(
  options: { db?: Kysely<Database>; trustProxyHops?: number } = {},
): TestApp {
  const clock = new FakeClock();
  const breachChecker = new FakeBreachChecker();
  const totpKey = randomBytes(32);
  const { logger, lines } = captureLogger();
  const app = createApp({
    logger,
    db: options.db ?? createDatabase('postgres://nadie:nada@127.0.0.1:1/ninguna'),
    clock,
    breachChecker,
    publicOrigin: TEST_ORIGIN,
    trustProxyHops: options.trustProxyHops ?? 0,
    totpKey,
    totpKeyVersion: 1,
  });
  return { app, clock, breachChecker, totpKey, logs: lines };
}
