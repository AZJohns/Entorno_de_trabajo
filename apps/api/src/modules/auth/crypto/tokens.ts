/**
 * Tokens de sesión y CSRF.
 *
 * - El token de sesión son 32 bytes aleatorios (256 bits, ASVS 7.2.3). En la base de datos solo se
 *   guarda su SHA-256: al ser aleatorio y largo, un hash rápido basta (a diferencia de una contraseña,
 *   no se puede adivinar por fuerza bruta) y permite buscar la sesión por índice.
 * - El token CSRF se deriva del de sesión con HMAC-SHA256, así que no hace falta guardarlo: quien no
 *   tiene la cookie no puede calcularlo. Cambia cuando cambia el token de sesión.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Genera un token de sesión nuevo (base64url, 43 caracteres). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 del token, que es lo que se guarda y se busca en la base de datos. */
export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Token CSRF de una sesión. */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update('csrf-v1').digest('base64url');
}

/** Compara dos cadenas en tiempo constante (sin revelar por el tiempo cuántos caracteres coinciden). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
