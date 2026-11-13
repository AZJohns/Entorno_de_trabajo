/**
 * Qué cambia en `category_budgets` cuando la importación del Excel confirma un mes (docs/plan.md §2.3 y
 * pregunta 39). Función pura, sin E/S.
 *
 * Regla: los presupuestos que creó una importación (`sourceSnapshotId` no nulo) se **sustituyen** por los de
 * la foto nueva, incluido borrar los de las categorías que ahora suman 0 o ya no están; los creados a mano
 * (`sourceSnapshotId` nulo) **no se tocan**, y si la foto nueva choca con uno, es un conflicto.
 */

/** Un presupuesto que ya existe en el mes. `sourceSnapshotId` es NULL si se creó a mano. */
export interface ExistingBudget {
  readonly id: string;
  readonly categoryId: string;
  readonly amountCents: number;
  readonly sourceSnapshotId: string | null;
}

/** El presupuesto que sale de la foto nueva para una categoría (importe en céntimos, > 0). */
export interface ImportedBudget {
  readonly categoryId: string;
  readonly amountCents: number;
}

export interface BudgetChanges {
  /** Categorías sin presupuesto en el mes: se crean. */
  readonly inserts: readonly ImportedBudget[];
  /**
   * Presupuestos importados que se conservan en la foto nueva: se reasigna su origen y, si cambia, su
   * importe (`amountChanged`). El identificador no cambia.
   */
  readonly updates: readonly {
    readonly id: string;
    readonly categoryId: string;
    readonly amountCents: number;
    readonly amountChanged: boolean;
  }[];
  /** Presupuestos importados cuya categoría ya no está (o suma 0) en la foto nueva: se borran. */
  readonly deletes: readonly { readonly id: string; readonly categoryId: string }[];
  /** Categorías de la foto nueva que ya tienen un presupuesto creado a mano: impiden confirmar. */
  readonly conflicts: readonly string[];
}

/**
 * Calcula los cambios. `items` no repite categorías. El resultado conserva el orden de `items` (altas,
 * cambios y conflictos) y el de `existing` (bajas), para que dos ejecuciones escriban en el mismo orden.
 */
export function planBudgetChanges(
  existing: readonly ExistingBudget[],
  items: readonly ImportedBudget[],
): BudgetChanges {
  const byCategory = new Map(existing.map((budget) => [budget.categoryId, budget]));
  const wanted = new Set(items.map((item) => item.categoryId));
  const inserts: ImportedBudget[] = [];
  const updates: {
    id: string;
    categoryId: string;
    amountCents: number;
    amountChanged: boolean;
  }[] = [];
  const conflicts: string[] = [];
  for (const item of items) {
    const current = byCategory.get(item.categoryId);
    if (current === undefined) {
      inserts.push(item);
    } else if (current.sourceSnapshotId === null) {
      conflicts.push(item.categoryId);
    } else {
      updates.push({
        id: current.id,
        categoryId: item.categoryId,
        amountCents: item.amountCents,
        amountChanged: current.amountCents !== item.amountCents,
      });
    }
  }
  const deletes = existing
    .filter((budget) => budget.sourceSnapshotId !== null && !wanted.has(budget.categoryId))
    .map((budget) => ({ id: budget.id, categoryId: budget.categoryId }));
  return { inserts, updates, deletes, conflicts };
}
