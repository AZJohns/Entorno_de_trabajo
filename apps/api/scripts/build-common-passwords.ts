/**
 * Regenera `src/modules/auth/data/common-passwords.txt`: las 3000 contraseñas más frecuentes de 15 o
 * más caracteres de la lista de un millón de SecLists (licencia MIT, Daniel Miessler).
 *
 * El origen está fijado por commit y comprobado por SHA-256: si el archivo cambia, el script falla.
 * Uso: `node scripts/build-common-passwords.ts`.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const COMMIT = 'ac8a76c5ddfb31385195448f501d7b915b307e4b';
const SOURCE = `https://raw.githubusercontent.com/danielmiessler/SecLists/${COMMIT}/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`;
const SOURCE_SHA256 = '424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51';
const MIN_LENGTH = 15;
const COUNT = 3000;

const response = await fetch(SOURCE, { redirect: 'error' });
if (!response.ok) throw new Error(`No se pudo descargar la lista: HTTP ${response.status}`);
const raw = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(raw).digest('hex');
if (digest !== SOURCE_SHA256) throw new Error(`SHA-256 inesperado: ${digest}`);

// La lista está ordenada por frecuencia: se conserva el orden y se quitan duplicados sin mayúsculas.
const seen = new Set<string>();
const selected: string[] = [];
for (const line of raw.toString('utf8').split('\n')) {
  const password = line.replace(/\r$/u, '');
  const key = password.toLowerCase();
  if ([...password].length >= MIN_LENGTH && !seen.has(key)) {
    seen.add(key);
    selected.push(password);
    if (selected.length === COUNT) break;
  }
}

const header = [
  `# ${COUNT} contraseñas más frecuentes de ${MIN_LENGTH} o más caracteres.`,
  '# Origen: SecLists (MIT, Daniel Miessler), xato-net-10-million-passwords-1000000.txt',
  `# Commit ${COMMIT}, SHA-256 ${SOURCE_SHA256}`,
  '# Generado con apps/api/scripts/build-common-passwords.ts. No editar a mano.',
];
writeFileSync(
  new URL('../src/modules/auth/data/common-passwords.txt', import.meta.url),
  [...header, ...selected, ''].join('\n'),
);
console.log(`Escritas ${selected.length} contraseñas.`);
