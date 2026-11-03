/**
 * Códigos de recuperación de un solo uso (sustituyen al TOTP si se pierde el dispositivo).
 *
 * Cada código son 10 bytes aleatorios (80 bits) en base32 de Crockford: 16 caracteres sin letras que
 * se confundan (no hay I, L, O ni U), en grupos de 4 para leerlos y copiarlos. Con menos de 112 bits,
 * ASVS 6.5.2 exige guardarlos con un hash de contraseñas con sal (Argon2id), no con SHA-256.
 */

/** Número de códigos que se generan cada vez (los anteriores se invalidan). */
export const RECOVERY_CODE_COUNT = 10;
/** Bytes aleatorios de cada código (80 bits ≥ 20 bits que exige ASVS 6.5.4). */
export const RECOVERY_CODE_BYTES = 10;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

/**
 * Convierte 10 bytes aleatorios en un código legible `XXXX-XXXX-XXXX-XXXX`.
 *
 * @throws {RangeError} si no recibe exactamente {@link RECOVERY_CODE_BYTES} bytes.
 */
export function formatRecoveryCode(randomBytes: Buffer): string {
  if (randomBytes.length !== RECOVERY_CODE_BYTES) {
    throw new RangeError(`Se esperaban ${RECOVERY_CODE_BYTES} bytes`);
  }
  let value = 0n;
  for (const byte of randomBytes) value = (value << 8n) | BigInt(byte);
  let text = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    text = CROCKFORD[Number(value & 31n)] + text;
    value >>= 5n;
  }
  return text.match(/.{4}/g)?.join('-') ?? text;
}

/**
 * Forma canónica de un código introducido por el usuario: sin guiones ni espacios, en mayúsculas,
 * con I/L → 1 y O → 0 (regla de Crockford). Es la que se hashea y se compara.
 *
 * @returns El código de 16 caracteres, o `null` si no puede ser un código válido.
 */
export function normalizeRecoveryCode(input: string): string | null {
  // Límite previo: un código válido tiene como mucho 19 caracteres más algún espacio.
  if (input.length > 40) return null;
  let canonical = '';
  for (const raw of input.toUpperCase()) {
    if (raw === '-' || raw === ' ') continue;
    const char = raw === 'I' || raw === 'L' ? '1' : raw === 'O' ? '0' : raw;
    if (!CROCKFORD.includes(char)) return null;
    canonical += char;
  }
  return canonical.length === CODE_LENGTH ? canonical : null;
}
