/**
 * Configuración de la API, leída de variables de entorno y validada al arrancar.
 *
 * Si falta una variable o tiene un valor no válido, la API no arranca (fallo rápido). El mensaje de
 * error nombra la variable, pero nunca muestra su valor: podría ser un secreto.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

/** Configuración validada y tipada. */
export type Config = z.infer<typeof envSchema>;

/** Error de configuración: enumera las variables problemáticas sin revelar sus valores. */
export class ConfigError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Configuración no válida. Revisa estas variables de entorno: ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}

/**
 * Valida las variables de entorno y devuelve la configuración.
 *
 * @param env Normalmente `process.env`; los tests pasan un objeto propio.
 * @throws {ConfigError} si alguna variable falta o no es válida.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(variables);
  }
  return result.data;
}
