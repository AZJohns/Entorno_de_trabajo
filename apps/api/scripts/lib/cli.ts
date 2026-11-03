/**
 * Utilidades de los scripts de servidor: configuración, servicio de autenticación y lectura de datos
 * por terminal (las contraseñas, sin mostrarlas).
 */
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../../src/config/env.ts';
import { createDatabase } from '../../src/db/database.ts';
import { systemClock } from '../../src/lib/clock.ts';
import {
  createAuthService,
  createHibpChecker,
  type AuthService,
} from '../../src/modules/auth/index.ts';

/** Crea el servicio con la configuración del entorno. Hay que llamar a `close()` al terminar. */
export function openAuthService(): { service: AuthService; close: () => Promise<void> } {
  const config = loadConfig(process.env);
  const db = createDatabase(config.DATABASE_URL);
  const service = createAuthService({
    db,
    clock: systemClock,
    totpKey: Buffer.from(config.TOTP_ENCRYPTION_KEY, 'base64'),
    totpKeyVersion: config.TOTP_ENCRYPTION_KEY_VERSION,
    breachChecker: createHibpChecker(),
  });
  return { service, close: () => db.destroy() };
}

// Si la entrada no es una terminal (p. ej., redirigida), se usa UN solo lector de líneas para todas
// las preguntas: cada `readline` nuevo leería por adelantado el resto de la entrada y lo perdería.
let pipedLines: AsyncIterator<string> | undefined;

async function nextPipedLine(question: string): Promise<string> {
  pipedLines ??= createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  process.stdout.write(question);
  const next = await pipedLines.next();
  process.stdout.write('\n');
  if (next.done === true) throw new Error('Entrada vacía');
  return next.value;
}

/** Pregunta un texto visible. */
export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return (await nextPipedLine(question)).trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Pregunta una contraseña sin mostrarla. Con una terminal interactiva, en modo «raw»; si la entrada no
 * es una terminal (p. ej., redirigida), se lee la línea tal cual. La contraseña no se recorta.
 */
export async function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return nextPipedLine(question);
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdin.setRawMode(false);
          reject(new Error('Cancelado'));
          return;
        }
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

/** Pide una contraseña nueva dos veces y comprueba que coinciden. */
export async function askNewPassword(): Promise<string> {
  const first = await askHidden('Contraseña nueva (15 caracteres o más): ');
  const second = await askHidden('Repite la contraseña: ');
  if (first !== second) throw new Error('Las contraseñas no coinciden');
  return first;
}

/** Ejecuta un script mostrando los errores sin trazas internas. */
export async function run(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
