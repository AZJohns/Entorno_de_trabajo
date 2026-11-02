/**
 * Activa los hooks versionados en `.githooks/` (pre-commit con gitleaks).
 *
 * Se ejecuta en el script `prepare` de la raíz, es decir, al hacer `pnpm install`. Sin este paso,
 * un clon nuevo no ejecutaría el hook, porque git no lee `core.hooksPath` del repositorio.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Fuera de un clon de git (p. ej., al construir una imagen de contenedor) no hay nada que activar.
if (!existsSync('.git')) {
  console.log('setup-git-hooks: no es un clon de git; no se configuran hooks.');
} else {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  console.log('setup-git-hooks: core.hooksPath = .githooks');
}
