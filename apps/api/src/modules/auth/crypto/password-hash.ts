/**
 * Hash de contraseñas y de códigos de recuperación con Argon2id nativo de Node (`crypto.argon2`,
 * estable desde Node 24.12; docs/adr/0001 y 0006). Formato PHC, que guarda los parámetros junto al
 * hash: se pueden endurecer sin migración y recalcular el hash en el siguiente inicio de sesión.
 */
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** Parámetros de Argon2id. */
export interface Argon2Params {
  /** Memoria en KiB. */
  readonly memory: number;
  /** Iteraciones. */
  readonly passes: number;
  /** Paralelismo (carriles). */
  readonly parallelism: number;
}

/**
 * Contraseñas: segunda recomendación de RFC 9106 (64 MiB, t = 3, p = 4), por encima del mínimo de
 * OWASP (19 MiB, t = 2, p = 1). Unos 130 ms por hash en el entorno de desarrollo: asumible con un solo
 * usuario y un inicio de sesión al día (docs/adr/0006).
 */
export const PASSWORD_ARGON2: Argon2Params = { memory: 65_536, passes: 3, parallelism: 4 };

/**
 * Códigos de recuperación: mínimo de OWASP. Tienen 80 bits de entropía, así que no hace falta el coste
 * de las contraseñas, y al verificar uno hay que probar hasta 10 hashes.
 */
export const RECOVERY_CODE_ARGON2: Argon2Params = { memory: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** Base64 sin relleno (formato PHC). Sin regex: se cortan los «=» finales con un bucle lineal. */
function b64(buffer: Buffer): string {
  const text = buffer.toString('base64');
  let end = text.length;
  while (end > 0 && text[end - 1] === '=') end -= 1;
  return text.slice(0, end);
}

async function derive(secret: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: secret,
    nonce: salt,
    parallelism: params.parallelism,
    tagLength: HASH_BYTES,
    memory: params.memory,
    passes: params.passes,
  });
}

/**
 * Calcula el hash de un secreto (contraseña o código de recuperación).
 *
 * @returns Cadena PHC: `$argon2id$v=19$m=…,t=…,p=…$<sal>$<hash>` (base64 sin relleno).
 */
export async function hashSecret(secret: string, params: Argon2Params): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(secret, salt, params);
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`;
}

interface ParsedPhc {
  readonly params: Argon2Params;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{1,128})\$([A-Za-z0-9+/]{1,128})$/;

function parsePhc(phc: string): ParsedPhc | null {
  const match = PHC.exec(phc);
  if (match === null) return null;
  const [, m, t, p, salt, hash] = match;
  return {
    params: { memory: Number(m), passes: Number(t), parallelism: Number(p) },
    salt: Buffer.from(salt ?? '', 'base64'),
    hash: Buffer.from(hash ?? '', 'base64'),
  };
}

/**
 * Comprueba un secreto contra su hash PHC. La comparación es en tiempo constante.
 *
 * @returns `false` si no coincide o si el hash no tiene un formato válido.
 */
export async function verifySecret(secret: string, phc: string): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (parsed === null) return false;
  const candidate = await derive(secret, parsed.salt, parsed.params);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** Indica si un hash se calculó con parámetros distintos de los actuales y conviene recalcularlo. */
export function needsRehash(phc: string, params: Argon2Params): boolean {
  const parsed = parsePhc(phc);
  return (
    parsed === null ||
    parsed.params.memory !== params.memory ||
    parsed.params.passes !== params.passes ||
    parsed.params.parallelism !== params.parallelism
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * Hash de una contraseña aleatoria, calculado una vez. Cuando el usuario no existe, se verifica la
 * contraseña contra él para que la respuesta tarde lo mismo y no revele si el usuario existe.
 */
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashSecret(randomBytes(32).toString('hex'), PASSWORD_ARGON2);
  return dummyHash;
}
