/**
 * Cookie de sesión. Se lee y se escribe a mano (unas líneas) en lugar de añadir cookie-parser: solo
 * hay una cookie y su formato es fijo (docs/dependencias.md).
 *
 * Atributos (ASVS 3.3): prefijo `__Host-` (exige Secure, Path=/ y ningún Domain), HttpOnly (JavaScript
 * no puede leerla) y SameSite=Lax (docs/plan.md §6.2: con Strict, al abrir la PWA desde una
 * notificación la primera petición podría llegar sin cookie).
 */

/** Nombre de la cookie de sesión. */
export const SESSION_COOKIE = '__Host-sid';

/** Una cabecera Cookie más larga se ignora: el navegador nunca debería enviarla. */
const MAX_COOKIE_HEADER = 8192;

/** Devuelve el valor de una cookie de la cabecera `Cookie`, o `undefined`. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header.length > MAX_COOKIE_HEADER) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Cabecera `Set-Cookie` de la sesión, que caduca a la vez que la sesión. */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

/** Cabecera `Set-Cookie` que borra la cookie de sesión. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
