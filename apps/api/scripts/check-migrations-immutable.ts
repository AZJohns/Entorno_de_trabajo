/**
 * Falla si un cambio modifica, renombra o borra una migración que ya existe en la rama base.
 *
 * Solo se permiten migraciones **nuevas**. Editar una migración ya aplicada desincroniza las bases
 * de datos que ya la ejecutaron (ver docs/adr/0003).
 *
 * Uso: `node scripts/check-migrations-immutable.ts <ref-base>` (p. ej., `origin/main`).
 */
import { execFileSync } from 'node:child_process';

/** Carpeta de migraciones, relativa a la raíz del repositorio. */
export const MIGRATIONS_PATH = 'apps/api/src/db/migrations';

/**
 * Extrae, de la salida de `git diff --name-status`, las migraciones existentes que han cambiado.
 *
 * @param nameStatus Salida de `git diff --name-status` (una línea por archivo: estado TAB ruta).
 * @returns Líneas con cambios no permitidos (todo lo que no sea "A", añadido).
 */
export function findForbiddenMigrationChanges(nameStatus: string): string[] {
  return nameStatus
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => !line.startsWith('A\t'));
}

function main(): void {
  const baseRef = process.argv[2];
  if (baseRef === undefined || baseRef === '') {
    console.error('Uso: check-migrations-immutable <ref-base>');
    process.exit(2);
  }
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const diff = execFileSync(
    'git',
    ['diff', '--name-status', '--no-renames', `${baseRef}...HEAD`, '--', MIGRATIONS_PATH],
    { encoding: 'utf8', cwd: repoRoot },
  );
  const forbidden = findForbiddenMigrationChanges(diff);
  if (forbidden.length > 0) {
    console.error(
      'Se han modificado o borrado migraciones existentes (crea una nueva en su lugar):',
    );
    for (const line of forbidden) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`Migraciones inmutables respecto a ${baseRef}: OK`);
}

// import.meta.main (Node ≥ 24.2) indica si este archivo es el punto de entrada. No se compara
// import.meta.url con process.argv[1]: en Windows pueden diferir (mayúsculas de la unidad, «c:» frente a
// «C:») y el script terminaría sin comprobar nada, con éxito: un falso verde.
if (import.meta.main) {
  main();
}
