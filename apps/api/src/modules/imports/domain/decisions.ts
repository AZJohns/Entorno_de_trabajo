/**
 * Decisiones de la vista previa y presupuestos por categoría (docs/plan.md §3.9). Funciones puras, sin E/S.
 *
 * Las **decisiones** (qué categoría de la app corresponde a un nombre de Presupuesto) no reescriben lo que
 * se extrajo ni los problemas guardados: se guardan aparte (`import_batches.decisions`) y se aplican al
 * leer. Así, retirar una decisión devuelve el lote exactamente a como se subió, y lo guardado sigue siendo
 * lo que dijo el archivo.
 */
import { assertCents, includedInBase, type Cents } from '@backoffice/shared';
import type { ExtractedPlan, ImportDecisions, ImportIssue } from '@backoffice/shared';
import { normalizeKey } from './normalize.ts';

/**
 * Lo extraído con las decisiones aplicadas: cada línea de Presupuesto cuyo nombre normalizado tiene una
 * decisión pasa a esa categoría (también si ya tenía una por coincidencia de nombre: manda lo elegido).
 */
export function effectivePlan(plan: ExtractedPlan, decisions: ImportDecisions): ExtractedPlan {
  const mappings = decisions.categoryMappings;
  if (Object.keys(mappings).length === 0) return plan;
  return {
    ...plan,
    budgetLines: plan.budgetLines.map((line) => {
      const decided = mappings[line.categoryKey];
      return decided === undefined ? line : { ...line, categoryId: decided };
    }),
  };
}

/**
 * Los problemas que siguen vigentes: se quitan los `CATEGORY_UNMAPPED` de las categorías que ya tienen una
 * decisión. El problema lleva el nombre original en `found`; su clave es la de la correspondencia.
 */
export function effectiveIssues(
  issues: readonly ImportIssue[],
  decisions: ImportDecisions,
): ImportIssue[] {
  const mappings = decisions.categoryMappings;
  if (Object.keys(mappings).length === 0) return [...issues];
  return issues.filter(
    (issue) =>
      !(
        issue.code === 'CATEGORY_UNMAPPED' &&
        issue.found !== undefined &&
        normalizeKey(issue.found) in mappings
      ),
  );
}

/** Presupuesto de una categoría para el mes del lote. */
export interface CategoryBudget {
  readonly categoryId: string;
  readonly amountCents: Cents;
}

/**
 * Presupuesto por categoría que sale de las líneas de Presupuesto (plan.md §2.3b: «agrupar en un importe
 * por categoría las varias líneas que compartan categoría»): la suma, en céntimos enteros, del importe
 * mensual de las líneas **que cuentan en el plan base** (`includedInBase`, el predicado único de
 * `plantilla-excel.md` §9.1, aplicado al estado de la fila de Datos a la que apunta cada línea).
 *
 * Una categoría cuya suma es 0 (todas sus líneas están fuera del plan base o valen 0) **no** se incluye:
 * `category_budgets` no admite un importe 0 («sin presupuesto» es no tener fila) y se cuenta en `omitted`.
 *
 * @throws {RangeError} si una línea no tiene categoría o fila de Datos (la extracción no estaba validada) o
 *   si una suma sale del rango seguro de céntimos.
 */
export function budgetsByCategory(plan: ExtractedPlan): {
  readonly budgets: readonly CategoryBudget[];
  readonly omitted: number;
} {
  const itemByRow = new Map(plan.items.map((item) => [item.sourceRow, item]));
  const totals = new Map<string, Cents>();
  for (const line of plan.budgetLines) {
    if (line.categoryId === null)
      throw new RangeError('Una línea de Presupuesto no tiene categoría');
    const item = line.itemRow === null ? undefined : itemByRow.get(line.itemRow);
    if (item === undefined)
      throw new RangeError('Una línea de Presupuesto no apunta a una fila de Datos');
    const counts = item.status !== null && includedInBase(item.status);
    const cents = counts ? (item.amountCents ?? 0) : 0;
    totals.set(line.categoryId, assertCents((totals.get(line.categoryId) ?? 0) + cents));
  }
  const budgets: CategoryBudget[] = [];
  let omitted = 0;
  for (const [categoryId, amountCents] of totals) {
    if (amountCents > 0) budgets.push({ categoryId, amountCents });
    else omitted += 1;
  }
  return { budgets, omitted };
}
