/**
 * Regla de ESLint propia: impone las fronteras del monolito modular.
 *
 * Un archivo que no pertenece al módulo M solo puede importar de M a través de
 * `modules/M/index.ts`, que es su API pública. Así, los repositorios y servicios internos de un
 * módulo no se pueden usar desde fuera por accidente (ver docs/adr/0002-express-monolito-modular.md).
 *
 * Se escribe como regla propia porque `no-restricted-imports` compara textos de import y no puede
 * saber, desde una ruta relativa como `../finance/x.ts`, si el destino está en otro módulo.
 *
 * Rutas: todas se normalizan a separadores `/` antes de compararlas. En Windows, ESLint puede
 * entregar el nombre del archivo con `\` o con `/`; si la regla dependiera de un único separador,
 * no reconocería la carpeta `src/modules` y no detectaría ninguna violación (el lint pasaría sin
 * comprobar nada).
 */
import path from 'node:path';
import type { Rule } from 'eslint';

const MODULES_SEGMENT = '/src/modules/';

/** Convierte una ruta a separadores `/` (no cambia nada en Linux ni en macOS). */
export function toPosixPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

/**
 * Resuelve un import relativo a partir del archivo que lo contiene.
 *
 * Usa `path.posix.join` (y no `resolve`) para no depender del directorio de trabajo ni del sistema:
 * funciona igual con `C:/repo/...` que con `/repo/...`.
 */
export function resolveImport(filename: string, source: string): string {
  return path.posix.join(path.posix.dirname(toPosixPath(filename)), source);
}

/** Devuelve el nombre del módulo al que pertenece una ruta, o `null` si no es de un módulo. */
export function moduleOf(filePath: string): string | null {
  const normalized = toPosixPath(filePath);
  const index = normalized.indexOf(MODULES_SEGMENT);
  if (index === -1) return null;
  const [name] = normalized.slice(index + MODULES_SEGMENT.length).split('/');
  return name === undefined || name === '' ? null : name;
}

function isModuleEntry(filePath: string, moduleName: string): boolean {
  const normalized = toPosixPath(filePath);
  return normalized.endsWith(`${MODULES_SEGMENT}${moduleName}/index.ts`);
}

/**
 * Indica si importar `source` desde `filename` cruza la frontera de un módulo sin pasar por su
 * `index.ts`. Devuelve el nombre del módulo invadido o `null` si el import está permitido.
 */
export function deepImportTarget(filename: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  const target = resolveImport(filename, source);
  const targetModule = moduleOf(target);
  if (targetModule === null || targetModule === moduleOf(filename)) return null;
  return isModuleEntry(target, targetModule) ? null : targetModule;
}

export const moduleBoundaries: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Un módulo solo se importa desde fuera a través de su index.ts' },
    messages: {
      deepImport:
        'Importación interna del módulo "{{target}}". Usa su API pública: modules/{{target}}/index.ts.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename;

    function check(node: Rule.Node, source: unknown): void {
      if (typeof source !== 'string') return;
      const target = deepImportTarget(filename, source);
      if (target !== null) context.report({ node, messageId: 'deepImport', data: { target } });
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) =>
        check(node, node.source.type === 'Literal' ? node.source.value : undefined),
    };
  },
};
