/**
 * Hash canónico del contenido extraído (docs/plan.md §3.6): sirve para la idempotencia. Dos archivos con las
 * mismas entradas dan el mismo hash aunque Excel haya cambiado metadatos al guardar. No incluye la
 * correspondencia de categorías elegida (`categoryId`): es una decisión, no contenido del archivo.
 */
import { createHash } from 'node:crypto';
import type { ExtractedPlan } from '@backoffice/shared';

/** JSON con las claves ordenadas, para que el orden de inserción no cambie el hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 de la serialización canónica de las entradas y la versión de la plantilla. */
export function contentHash(plan: ExtractedPlan, templateVersion: number): Buffer {
  const withoutDecisions = {
    ...plan,
    budgetLines: plan.budgetLines.map(({ categoryId: _decision, ...line }) => line),
  };
  return createHash('sha256')
    .update(canonicalJson({ templateVersion, plan: withoutDecisions }))
    .digest();
}
