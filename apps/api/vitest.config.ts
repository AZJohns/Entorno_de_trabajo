import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// En local, TEST_DATABASE_URL se lee del .env de la raíz (si existe). En la CI llega como variable.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Vitest 5 oculta por defecto la salida de consola de los tests que pasan. Se muestra para que
    // quede en los logs de la CI el tiempo de CREATE DATABASE (ver test/migrations.test.ts).
    silent: false,
  },
});
