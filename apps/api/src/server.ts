/**
 * Punto de entrada: valida la configuración, crea la aplicación y la pone a escuchar.
 */
import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config/env.ts';
import { createDatabase } from './db/database.ts';
import { createLogger } from './http/logger.ts';
import { createJobs, JOBS_INTERVAL_MS } from './jobs/index.ts';
import { startScheduler } from './jobs/scheduler.ts';
import { systemClock } from './lib/clock.ts';
import { createHibpChecker } from './modules/auth/index.ts';

function start(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.LOG_LEVEL);
  const db = createDatabase(config.DATABASE_URL);
  const app = createApp({
    logger,
    db,
    clock: systemClock,
    breachChecker: createHibpChecker(),
    publicOrigin: config.PUBLIC_ORIGIN,
    trustProxyHops: config.TRUST_PROXY_HOPS,
    totpKey: Buffer.from(config.TOTP_ENCRYPTION_KEY, 'base64'),
    totpKeyVersion: config.TOTP_ENCRYPTION_KEY_VERSION,
  });
  // HOST es 127.0.0.1 por defecto: en desarrollo la API no es accesible desde la red local.
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info({ host: config.HOST, port: config.PORT }, 'API escuchando');
  });

  // Recordatorios: un ciclo cada minuto dentro de este proceso (el primero, al arrancar).
  const scheduler = startScheduler({
    jobs: createJobs({ db, clock: systemClock, logger }),
    intervalMs: JOBS_INTERVAL_MS,
    logger,
  });

  // Parada ordenada: se deja de aceptar conexiones, se terminan las peticiones en curso y el ciclo del
  // planificador y, al final, se cierra el pool de la base de datos.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Parando la API');
    server.close(() => {
      void scheduler
        .stop()
        .then(() => db.destroy())
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
