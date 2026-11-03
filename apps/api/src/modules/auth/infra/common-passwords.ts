/**
 * Lista local de contraseñas comunes de 15 o más caracteres (ASVS 6.2.4).
 *
 * Con un mínimo de 15 caracteres, el «top 3000» habitual queda casi vacío: ASVS pide las comunes que
 * cumplan la política. El archivo contiene las 3000 más frecuentes de 15 o más caracteres de la lista
 * de un millón de SecLists (licencia MIT); `scripts/build-common-passwords.ts` lo regenera y documenta
 * el origen exacto.
 */
import { readFileSync } from 'node:fs';

let cache: ReadonlySet<string> | undefined;

/** Conjunto de contraseñas comunes, en minúsculas. Se lee una vez. */
export function loadCommonPasswords(): ReadonlySet<string> {
  cache ??= new Set(
    readFileSync(new URL('../data/common-passwords.txt', import.meta.url), 'utf8')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  return cache;
}
