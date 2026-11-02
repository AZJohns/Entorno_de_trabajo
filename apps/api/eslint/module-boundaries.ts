/**
 * Regla de ESLint propia: impone las fronteras del monolito modular.
 *
 * Un archivo que no pertenece al módulo M solo puede importar de M a través de
 * `modules/M/index.ts`, que es su API pública. Así, los repositorios y servicios internos de un
 * módulo no se pueden usar desde fuera por accidente (ver docs/adr/0002-express-monolito-modular.md).
 *
 * Se escribe como regla propia porque `no-restricted-imports` compara textos de import y no puede
 * saber, desde una ruta relativa como `../finance/x.ts`, si el destino está en otro módulo.
 */
import path from 'node:path';
import type { Rule } from 'eslint';

const MODULES_SEGMENT = `${path.sep}src${path.sep}modules${path.sep}`;

/** Devuelve el nombre del módulo al que pertenece una ruta absoluta, o `null` si no es de un módulo. */
export function moduleOf(absolutePath: string): string | null {
  const index = absolutePath.indexOf(MODULES_SEGMENT);
  if (index === -1) return null;
  const rest = absolutePath.slice(index + MODULES_SEGMENT.length);
  const [name] = rest.split(path.sep);
  return name ?? null;
}

function isModuleEntry(absolutePath: string, moduleName: string): boolean {
  const index = absolutePath.indexOf(MODULES_SEGMENT);
  const rest = absolutePath.slice(index + MODULES_SEGMENT.length);
  return rest === `${moduleName}${path.sep}index.ts`;
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
    const ownModule = moduleOf(filename);

    function check(node: Rule.Node, source: unknown): void {
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = path.resolve(path.dirname(filename), source);
      const targetModule = moduleOf(target);
      if (targetModule === null || targetModule === ownModule) return;
      if (isModuleEntry(target, targetModule)) return;
      context.report({ node, messageId: 'deepImport', data: { target: targetModule } });
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
