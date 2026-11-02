/**
 * Punto de entrada: valida la configuración, crea la aplicación y la pone a escuchar.
 */
import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config/env.ts';
import { createLogger } from './http/logger.ts';

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
  const app = createApp({ logger });
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'API escuchando');
  });

  // Parada ordenada: se deja de aceptar conexiones y se terminan las peticiones en curso.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Parando la API');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
