/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226), con HMAC-SHA-1 o HMAC-SHA-256, 6 cifras y pasos de 30 s.
 *
 * Se implementa aquí (unas decenas de líneas) en lugar de usar una librería: es pequeño, se prueba
 * con los vectores oficiales del RFC y evita una dependencia (docs/dependencias.md).
 *
 * Cada credencial guarda su algoritmo (`totp_authenticators.algorithm`):
 * - `SHA256`: el de las altas nuevas (ASVS 11.4.1: HMAC-SHA-1 es *Legacy*). Solo lo aplican las apps
 *   que lo reciben escaneando un QR con `algorithm=SHA256`; con la clave escrita a mano, Google
 *   Authenticator usa SHA-1 y sus códigos no coincidirían.
 * - `SHA1`: las credenciales anteriores a la migración 0004, que siguen funcionando hasta que se
 *   cambie el TOTP. SHA-1 dentro de HMAC no se ve afectado por los ataques de colisión de SHA-1.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Algoritmo HMAC de una credencial TOTP; coincide con el CHECK de la columna `algorithm`. */
export type TotpAlgorithm = 'SHA1' | 'SHA256';

/** Algoritmo de las altas nuevas. */
export const NEW_TOTP_ALGORITHM: TotpAlgorithm = 'SHA256';

/**
 * Longitud de la semilla de las altas nuevas, en bytes: igual al tamaño de salida del hash
 * (RFC 4226 §4 pide al menos 128 bits; RFC 6238 §5.1 recomienda la longitud del hash).
 */
export const TOTP_SECRET_BYTES: Readonly<Record<TotpAlgorithm, number>> = { SHA1: 20, SHA256: 32 };

const HMAC_NAMES: Readonly<Record<TotpAlgorithm, string>> = { SHA1: 'sha1', SHA256: 'sha256' };

/** Duración de cada paso, en segundos. */
export const TOTP_PERIOD_SECONDS = 30;
/** Número de cifras del código. */
export const TOTP_DIGITS = 6;

/**
 * Paso de tiempo de una fecha: número de periodos de 30 s desde el 1970-01-01T00:00:00Z.
 * Cabe sin problema en un `number` (≈ 5,9 · 10⁷ en 2026).
 */
export function timeStep(date: Date): number {
  return Math.floor(date.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Código HOTP de 6 cifras para un contador (RFC 4226 §5.3, truncado dinámico) con el algoritmo
 * indicado. El algoritmo es obligatorio: un valor por defecto aceptaría en silencio el equivocado.
 */
export function hotp(secret: Buffer, counter: number, algorithm: TotpAlgorithm): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(HMAC_NAMES[algorithm], secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Resultado de {@link verifyTotp}. */
export type TotpVerification =
  | { readonly ok: true; readonly step: number }
  | { readonly ok: false; readonly reason: 'invalid' | 'reused' };

/**
 * Verifica un código TOTP.
 *
 * Acepta el paso actual y el anterior (RFC 6238 §5.2: tolerancia al desfase del reloj). Es una
 * desviación documentada de ASVS 6.5.5 (vida máxima de 30 s): en el peor caso, un código vale 60 s.
 * Se compensa con el uso único: un paso igual o anterior al último aceptado se rechaza.
 *
 * @param algorithm Algoritmo de la credencial. Un código calculado con el otro algoritmo no vale.
 * @param lastUsedStep Último paso aceptado para esta semilla, o `null` si nunca se usó.
 * @returns El paso aceptado (hay que guardarlo como nuevo `lastUsedStep`) o el motivo del rechazo.
 */
export function verifyTotp(
  secret: Buffer,
  algorithm: TotpAlgorithm,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): TotpVerification {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'invalid' };
  const current = timeStep(now);
  for (const step of [current, current - 1]) {
    // Comparación en tiempo constante: no revela cuántas cifras coinciden.
    if (timingSafeEqual(Buffer.from(hotp(secret, step, algorithm)), Buffer.from(code))) {
      if (lastUsedStep !== null && step <= lastUsedStep) return { ok: false, reason: 'reused' };
      return { ok: true, step };
    }
  }
  return { ok: false, reason: 'invalid' };
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica en base32 (RFC 4648) sin relleno, el formato que esperan las apps de autenticación. */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/**
 * Decodifica base32 (RFC 4648), sin distinguir mayúsculas y aceptando relleno.
 *
 * @throws {Error} si contiene caracteres fuera del alfabeto.
 */
export function base32Decode(text: string): Buffer {
  // Se quita el relleno final con un bucle (lineal), no con una regex como /=+$/, cuyo coste es
  // cuadrático con muchos «=» seguidos de otro carácter (ReDoS).
  let end = text.length;
  while (end > 0 && text[end - 1] === '=') end -= 1;
  const clean = text.slice(0, end).toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Carácter no válido en base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * URI `otpauth://` para dar de alta la semilla en una app de autenticación. Se muestra una sola vez,
 * al dar de alta o cambiar el TOTP, y debe escanearse como QR: es lo que hace que la app aplique
 * `algorithm` (con la clave escrita a mano, Google Authenticator usa SHA-1).
 */
export function otpauthUri(input: {
  secret: Buffer;
  algorithm: TotpAlgorithm;
  issuer: string;
  account: string;
}): string {
  const issuer = encodeURIComponent(input.issuer);
  const account = encodeURIComponent(input.account);
  const params = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: input.algorithm,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}
