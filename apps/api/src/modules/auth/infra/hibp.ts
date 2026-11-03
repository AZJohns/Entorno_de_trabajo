/**
 * Comprobación de contraseñas filtradas con la API de rangos de Pwned Passwords (Have I Been Pwned),
 * ASVS 6.2.12.
 *
 * k-anonimato: solo se envían los 5 primeros caracteres del SHA-1 de la contraseña. La API devuelve
 * todos los sufijos de ese rango y la comparación se hace aquí, así que ni la contraseña ni su hash
 * completo salen del servidor. Con `Add-Padding`, la respuesta incluye entradas de relleno (con
 * recuento 0) para que su tamaño no revele el rango.
 *
 * Fallo cerrado: si la API no responde o responde algo inesperado, se lanza un error y la contraseña
 * NO se acepta (se reintenta más tarde). Fijar una contraseña es poco frecuente, así que el coste es
 * mínimo (docs/plan.md §6.2, ASVS 16.5.3).
 */
import { createHash } from 'node:crypto';

/** Comprobador de contraseñas filtradas (en los tests se sustituye por un doble sin red). */
export interface PasswordBreachChecker {
  /** @throws {BreachCheckUnavailableError} si no se puede comprobar. */
  isBreached(password: string): Promise<boolean>;
}

/** No se pudo consultar el servicio de contraseñas filtradas. */
export class BreachCheckUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('No se pudo consultar el servicio de contraseñas filtradas', { cause });
    this.name = 'BreachCheckUnavailableError';
  }
}

/** Opciones del cliente de HIBP. */
export interface HibpOptions {
  /** `fetch` inyectable: los tests nunca salen a la red. */
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.pwnedpasswords.com/range/';

/** Crea el comprobador que usa la API de rangos de Pwned Passwords. */
export function createHibpChecker(options: HibpOptions = {}): PasswordBreachChecker {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  return {
    async isBreached(password: string): Promise<boolean> {
      const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      let body: string;
      try {
        const response = await fetchFn(`${baseUrl}${prefix}`, {
          headers: {
            'Add-Padding': 'true',
            // Identificador genérico: nunca un correo ni un dominio propio.
            'User-Agent': 'backoffice-personal',
          },
          // No se siguen redirecciones (ASVS 15.3.2).
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = await response.text();
      } catch (error) {
        throw new BreachCheckUnavailableError(error);
      }

      for (const line of body.split('\n')) {
        const [lineSuffix, count] = line.trim().split(':');
        // Las líneas de relleno tienen recuento 0: no cuentan como filtradas.
        if (lineSuffix === suffix && Number(count) > 0) return true;
      }
      return false;
    },
  };
}
