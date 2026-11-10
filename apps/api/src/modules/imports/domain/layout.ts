/**
 * Fin de la tabla de datos de cada hoja y bloque de resumen (docs/plantilla-excel.md §2.1).
 *
 * El fin de la tabla no se detecta solo por la primera fila vacía: en Presupuesto y Metas lo marca la
 * etiqueta de inicio del resumen, y las filas con datos tras un hueco se avisan (`ROW_AFTER_GAP`) en lugar
 * de perderse en silencio.
 */
import { MAX_TABLE_ROWS, FIRST_DATA_ROW } from './template.ts';
import { normalizeKey } from './normalize.ts';
import type { Sheet } from './workbook.ts';
import { ZipLimitError } from './zip.ts';

export interface TableScan {
  /** Filas de datos que se importan, en orden. */
  readonly rows: readonly number[];
  /** Filas con contenido tras el hueco: no se importan y se avisan. */
  readonly afterGap: readonly number[];
}

export interface ScanOptions {
  /** Una fila es «vacía» si todas estas columnas lo están. */
  readonly emptyCols: readonly number[];
  /** Tras el hueco, una fila se avisa si alguna de estas columnas tiene contenido; `'any'` = cualquiera. */
  readonly laterCols: readonly number[] | 'any';
  /** Última fila de la zona de datos (inclusive); sin ella, hasta el final de la hoja. */
  readonly lastRow?: number;
}

/**
 * Recorre la tabla desde la fila 6. Las filas anteriores al primer hueco son datos; las posteriores con
 * contenido son `afterGap`. Los huecos al final de la zona no avisan de nada.
 */
export function scanTable(sheet: Sheet, options: ScanOptions): TableScan {
  const rows: number[] = [];
  const afterGap: number[] = [];
  const last = Math.min(options.lastRow ?? Number.POSITIVE_INFINITY, sheet.maxRow);
  let gap = false;
  for (let row = FIRST_DATA_ROW; row <= last; row += 1) {
    const empty = options.emptyCols.every((col) => sheet.isBlank(row, col));
    if (!gap) {
      if (empty) gap = true;
      else rows.push(row);
      continue;
    }
    const later =
      options.laterCols === 'any'
        ? sheet.columnsOf(row).some((col) => !sheet.isBlank(row, col))
        : options.laterCols.some((col) => !sheet.isBlank(row, col));
    if (later) afterGap.push(row);
  }
  if (rows.length > MAX_TABLE_ROWS) {
    throw new ZipLimitError(
      `La hoja «${sheet.name}» tiene más de ${String(MAX_TABLE_ROWS)} filas de datos`,
    );
  }
  return { rows, afterGap };
}

/**
 * Fila donde empieza el resumen: la primera (desde la 6) cuya columna A coincide, normalizada, con
 * alguna de las etiquetas de inicio. `undefined` si no está (`SUMMARY_NOT_FOUND`).
 */
export function findSummaryStart(sheet: Sheet, startLabels: readonly string[]): number | undefined {
  const wanted = new Set(startLabels.map(normalizeKey));
  for (let row = FIRST_DATA_ROW; row <= sheet.maxRow; row += 1) {
    const cell = sheet.cell(row, 1);
    if (cell?.value?.kind === 'text' && wanted.has(normalizeKey(cell.value.value))) return row;
  }
  return undefined;
}

/**
 * Comprueba que, desde la etiqueta de inicio, las filas siguientes llevan en la columna A las etiquetas
 * esperadas, en orden. Devuelve la primera que no coincide (para `SUMMARY_UNEXPECTED`) o `undefined`.
 */
export function firstSummaryMismatch(
  sheet: Sheet,
  startRow: number,
  expected: readonly string[],
): { row: number; expected: string } | undefined {
  for (let index = 1; index < expected.length; index += 1) {
    const row = startRow + index;
    const cell = sheet.cell(row, 1);
    const found = cell?.value?.kind === 'text' ? normalizeKey(cell.value.value) : '';
    const label = expected[index] ?? '';
    if (found !== normalizeKey(label)) return { row, expected: label };
  }
  return undefined;
}
