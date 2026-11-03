/**
 * Política de contraseñas (NIST SP 800-63B-4 y ASVS 6.2). Función pura: la consulta a la API de
 * contraseñas filtradas (HIBP, ASVS 6.2.12) se hace aparte, en el servicio.
 *
 * - Longitud entre 15 y 256 caracteres, contados como puntos de código Unicode.
 * - Sin reglas de composición (mayúsculas, símbolos…) ni caducidad.
 * - No está en la lista de contraseñas comunes de 15 o más caracteres (ASVS 6.2.4).
 * - No contiene palabras del contexto: nombre de la aplicación o del usuario (ASVS 6.1.2, 6.2.11).
 * - Se evalúa exactamente como llega, sin recortar ni cambiar mayúsculas (ASVS 6.2.8).
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@backoffice/shared';

/** Motivo de rechazo de una contraseña nueva. */
export type PasswordRejection = 'too_short' | 'too_long' | 'common' | 'context_word';

/** Datos de la política (se inyectan para poder probarla sin archivos). */
export interface PasswordPolicyInput {
  /** Contraseñas comunes en minúsculas. */
  readonly commonPasswords: ReadonlySet<string>;
  /** Palabras del contexto; se ignoran las de menos de 4 caracteres. */
  readonly contextWords: readonly string[];
}

/** Mensaje para el usuario de cada motivo de rechazo. */
export const PASSWORD_REJECTION_MESSAGES: Record<
  PasswordRejection | 'breached' | 'same_as_current',
  string
> = {
  too_short: `Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  too_long: `Debe tener como mucho ${PASSWORD_MAX_LENGTH} caracteres`,
  common: 'Es una contraseña demasiado común',
  context_word: 'No puede contener el nombre de la aplicación ni del usuario',
  breached: 'Aparece en filtraciones de datos conocidas (Have I Been Pwned)',
  same_as_current: 'Debe ser distinta de la actual',
};

/**
 * Comprueba la política local de contraseñas.
 *
 * @returns `null` si la contraseña es aceptable, o el motivo del rechazo.
 */
export function checkPasswordPolicy(
  password: string,
  { commonPasswords, contextWords }: PasswordPolicyInput,
): PasswordRejection | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';

  const lower = password.normalize('NFC').toLowerCase();
  if (commonPasswords.has(lower)) return 'common';
  for (const word of contextWords) {
    const needle = word.normalize('NFC').toLowerCase();
    if (needle.length >= 4 && lower.includes(needle)) return 'context_word';
  }
  return null;
}

/**
 * Palabras del contexto que salen del origen público (`PUBLIC_ORIGIN`): las etiquetas de su nombre de
 * host. Así el dominio forma parte de la lista sin escribirlo en el repositorio (ASVS 6.1.2). Las de
 * menos de 4 caracteres (p. ej., `com`) las ignora `checkPasswordPolicy`.
 *
 * @param origin Origen ya validado por la configuración (esquema + host + puerto).
 */
export function originContextWords(origin: string): string[] {
  return new URL(origin).hostname.split('.').filter((label) => label !== '');
}
