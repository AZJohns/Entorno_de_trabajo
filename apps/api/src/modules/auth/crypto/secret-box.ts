/**
 * Cifrado autenticado (AES-256-GCM) de las semillas TOTP en la base de datos.
 *
 * Las semillas no se pueden guardar como hash: hay que recalcular los códigos. Se cifran con una clave
 * que no está ni en la base de datos ni en las copias de seguridad (`TOTP_ENCRYPTION_KEY`), así que un
 * volcado o una copia no bastan para generar códigos (docs/plan.md §6.2).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Texto cifrado (con la etiqueta de autenticación al final) y su nonce. */
export interface SealedSecret {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
}

/**
 * Cifra un secreto. Cada llamada usa un nonce aleatorio nuevo (nunca se repite con la misma clave).
 *
 * @param key Clave de 32 bytes.
 */
export function seal(key: Buffer, plaintext: Buffer): SealedSecret {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce };
}

/**
 * Descifra y verifica la integridad (ASVS 11.3.3).
 *
 * @throws {Error} si la clave no es la correcta o el texto cifrado se ha modificado.
 */
export function open(key: Buffer, sealed: SealedSecret): Buffer {
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
