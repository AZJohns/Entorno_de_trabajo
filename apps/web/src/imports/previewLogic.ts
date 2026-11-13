/**
 * Lógica pura de la vista previa: agrupar los problemas y las categorías. Solo reorganiza lo que ya calculó
 * la API (problemas, resúmenes, correspondencias); no calcula totales ni importes nuevos.
 */
import type {
  ExtractedBudgetLine,
  ExtractedPlan,
  ImportIssue,
  IssueSeverity,
} from '@backoffice/shared';

export const SEVERITY_ORDER: readonly IssueSeverity[] = ['error', 'warning', 'info'];

export interface IssueGroup {
  readonly severity: IssueSeverity;
  /** Una entrada por hoja (`null`: problemas que no son de ninguna hoja), en orden de aparición. */
  readonly sheets: readonly {
    readonly sheet: string | null;
    readonly issues: readonly ImportIssue[];
  }[];
  readonly total: number;
}

/** Agrupa por severidad (errores, avisos, información) y, dentro, por hoja. Omite las severidades vacías. */
export function groupIssues(issues: readonly ImportIssue[]): IssueGroup[] {
  return SEVERITY_ORDER.flatMap((severity) => {
    const ofSeverity = issues.filter((issue) => issue.severity === severity);
    if (ofSeverity.length === 0) return [];
    const sheets: { sheet: string | null; issues: ImportIssue[] }[] = [];
    for (const issue of ofSeverity) {
      const existing = sheets.find((entry) => entry.sheet === issue.sheet);
      if (existing === undefined) sheets.push({ sheet: issue.sheet, issues: [issue] });
      else existing.issues.push(issue);
    }
    return [{ severity, sheets, total: ofSeverity.length }];
  });
}

export interface CategoryRow {
  /** Nombre normalizado: la clave que usa `PATCH /decisions`. */
  readonly key: string;
  /** Nombre tal como lo escribió el Excel (texto no confiable: se pinta como texto). */
  readonly label: string;
  readonly lines: number;
  /** Categoría de gasto de la app asignada (por nombre, guardada o decidida), o `null`. */
  readonly categoryId: string | null;
}

/** Una fila por categoría distinta de la hoja Presupuesto, en orden de aparición. */
export function categoryRows(extracted: ExtractedPlan): CategoryRow[] {
  const rows = new Map<string, { label: string; lines: number; categoryId: string | null }>();
  for (const line of extracted.budgetLines) {
    const row = rows.get(line.categoryKey);
    if (row === undefined) {
      rows.set(line.categoryKey, {
        label: line.categoryLabel,
        lines: 1,
        categoryId: line.categoryId,
      });
    } else {
      row.lines += 1;
      row.categoryId ??= line.categoryId;
    }
  }
  return [...rows].map(([key, row]) => ({ key, ...row }));
}

/**
 * Importe mensual de una línea de Presupuesto: el de la fila de Datos a la que apunta (céntimos), o
 * `null` si no apunta a ninguna o esa fila no tiene importe (p. ej. está en meses).
 */
export function lineAmountCents(
  extracted: ExtractedPlan,
  line: ExtractedBudgetLine,
): number | null {
  if (line.itemRow === null) return null;
  return extracted.items.find((item) => item.sourceRow === line.itemRow)?.amountCents ?? null;
}

/** Qué pasó al confirmar, para decirlo con claridad (`docs/plan.md` §3.10). */
export type ConfirmOutcome =
  /** 201: se creó la foto del plan; `budgets` trae los recuentos. */
  | 'created'
  /** 200 y el lote ya figura como confirmado: no se ha vuelto a escribir nada. */
  | 'already-confirmed'
  /** 200 y el lote sigue en vista previa: su contenido es igual al plan vigente; no se creó nada. */
  | 'no-changes';

/**
 * Resultado de confirmar a partir del código HTTP y del estado del lote releído después. El 200 tiene dos
 * significados distintos y solo el estado del lote los separa.
 */
export function confirmOutcome(
  httpStatus: number,
  budgets: object | null,
  batchStatus: string,
): ConfirmOutcome {
  if (httpStatus === 201 && budgets !== null) return 'created';
  return batchStatus === 'confirmed' ? 'already-confirmed' : 'no-changes';
}

/** Número de errores del resumen que bloquean (para el texto junto al botón de confirmar). */
export function blockingText(errors: number): string {
  return errors === 1
    ? 'Hay 1 error sin resolver: no se puede confirmar.'
    : `Hay ${String(errors)} errores sin resolver: no se puede confirmar.`;
}
