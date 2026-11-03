/**
 * Configuración de la API, leída de variables de entorno y validada al arrancar.
 *
 * Si falta una variable o tiene un valor no válido, la API no arranca (fallo rápido). El mensaje de
 * error nombra la variable, pero nunca muestra su valor: podría ser un secreto.
 */
import { z } from 'zod';

/** Longitud de la clave de cifrado de las semillas TOTP (AES-256-GCM): 32 bytes. */
const TOTP_KEY_BYTES = 32;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Por defecto solo escucha en el propio equipo: en desarrollo, la API no es accesible desde la
    // red local por HTTP. En el contenedor de la fase 2 se fijará de forma explícita (ASVS 13.4.x).
    HOST: z.union([z.ipv4(), z.ipv6(), z.literal('localhost')]).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Origen público de la web (esquema + host + puerto, sin ruta). Las peticiones que modifican datos
    // deben llegar con este Origin (protección CSRF). Nunca se escribe un dominio real en el código.
    PUBLIC_ORIGIN: z
      .url({ protocol: /^https?$/ })
      .refine((value) => new URL(value).origin === value, {
        message: 'Debe ser solo un origen (p. ej. https://ejemplo.test), sin ruta ni barra final',
      }),
    // Número de proxies inversos de confianza delante de la API (0 = ninguno). Con 0, la IP de cada
    // petición es la de la conexión. Detrás de un proxy sin configurarlo, todas las peticiones
    // parecerían venir de la misma IP y los límites por IP serían globales (docs/seguridad/limites.md).
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Clave de cifrado de las semillas TOTP en la base de datos: 32 bytes en base64.
    TOTP_ENCRYPTION_KEY: z
      .base64()
      .refine((value) => Buffer.from(value, 'base64').length === TOTP_KEY_BYTES, {
        message: `Debe codificar exactamente ${TOTP_KEY_BYTES} bytes`,
      }),
    TOTP_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(32_767).default(1),
  })
  .superRefine((env, context) => {
    // En producción, la cookie de sesión exige HTTPS de extremo a extremo.
    if (env.NODE_ENV === 'production' && !env.PUBLIC_ORIGIN.startsWith('https://')) {
      context.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'Debe ser https' });
    }
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
