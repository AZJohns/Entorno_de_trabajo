/**
 * Lector del Excel del plan: de los bytes del archivo a las entradas validadas (docs/plan.md §3.5).
 *
 * Cuatro niveles; se recogen todos los problemas de cada uno y nunca se hace una importación parcial:
 * 1. Archivo (`rejected`): tamaño, tipo real, límites del ZIP, macros, vínculos. No crea lote.
 * 2. Libro (`failed`): hojas, versión de la plantilla, cabeceras, resumen. Crea un lote `failed`.
 * 3. Celda y 4. Semántica (`preview`): tipos, listas, fórmulas, referencias. Crea un lote `preview`; con
 *    errores no se puede confirmar.
 *
 * Es una función pura: sin base de datos, sin disco, sin red. No evalúa ni ejecuta nada del archivo.
 */
import type { ExtractedPlan, ImportIssue } from '@backoffice/shared';
import { contentHash } from './content-hash.ts';
import { extractPlan } from './extract.ts';
import { checkFile } from './file.ts';
import { IssueCollector } from './issues.ts';
import { findSummaryStart, firstSummaryMismatch } from './layout.ts';
import { normalizeKey } from './normalize.ts';
import {
  CALCULATED_SHEETS,
  HEADERS,
  HEADER_ROW,
  METAS_SUMMARY,
  METAS_SUMMARY_START,
  PRESUPUESTO_SUMMARY,
  PRESUPUESTO_SUMMARY_START,
  SHEET,
  TEMPLATE_VERSION,
  VERSION_MARKERS,
  type InputSheetKey,
} from './template.ts';
import { openWorkbook, type Workbook } from './workbook.ts';
import { ZipFormatError, ZipLimitError } from './zip.ts';

export interface ParseOptions {
  /** Nombre del archivo que dio el usuario: solo se usa para comprobar la extensión. */
  readonly fileName: string;
  /** Mes 1 del plan, `YYYY-MM`. */
  readonly month: string;
  /** Categoría de gasto de la app para un nombre normalizado, o `undefined` si no hay correspondencia. */
  readonly resolveCategory: (key: string) => string | undefined;
}

export type ParseOutcome =
  | { readonly stage: 'rejected'; readonly issues: ImportIssue[] }
  | {
      readonly stage: 'failed';
      readonly issues: ImportIssue[];
      readonly templateVersion: number | null;
    }
  | {
      readonly stage: 'preview';
      readonly issues: ImportIssue[];
      readonly templateVersion: number;
      readonly extracted: ExtractedPlan;
      readonly contentHash: Buffer;
    };

const INPUT_KEYS = Object.keys(SHEET) as InputSheetKey[];

/** Texto de una celda de cabecera, normalizado. */
function headerText(workbook: Workbook, sheetName: string, col: number): string {
  const value = workbook.sheet(sheetName).cell(HEADER_ROW, col)?.value;
  return value === null || value === undefined ? '' : normalizeKey(String(value.value));
}

/** Nivel 2: hojas, versión, cabeceras y resumen. Devuelve los nombres reales de las hojas de entrada. */
function checkWorkbook(
  workbook: Workbook,
  issues: IssueCollector,
): {
  names: Record<InputSheetKey, string> | null;
  lastRow: { budget: number; goals: number } | null;
  version: number | null;
} {
  const byKey = new Map(workbook.sheetNames.map((name) => [normalizeKey(name), name]));
  const expected = [...Object.values(SHEET), ...CALCULATED_SHEETS];
  const expectedKeys = new Set(expected.map(normalizeKey));

  for (const name of expected) {
    if (!byKey.has(normalizeKey(name))) {
      issues.add('SHEET_MISSING', name, null, null, `Falta la hoja «${name}»`);
    }
  }
  for (const name of workbook.sheetNames) {
    if (!expectedKeys.has(normalizeKey(name))) {
      issues.add('SHEET_UNEXPECTED', name, null, null, `Sobra la hoja «${name}»: no se importa`);
    }
  }

  const actual: Partial<Record<InputSheetKey, string>> = {};
  for (const key of INPUT_KEYS) {
    const found = byKey.get(normalizeKey(SHEET[key]));
    if (found !== undefined) actual[key] = found;
  }

  // Versión (§7): las tres cabeceras que distinguen la v2.
  let version: number | null = TEMPLATE_VERSION;
  const markerCells = new Set<string>();
  for (const marker of VERSION_MARKERS) {
    const name = actual[marker.sheet];
    if (name === undefined) continue;
    markerCells.add(`${marker.sheet}:${String(marker.col)}`);
    if (headerText(workbook, name, marker.col) !== normalizeKey(marker.label)) {
      version = null;
      issues.add(
        'TEMPLATE_VERSION_UNSUPPORTED',
        name,
        HEADER_ROW,
        marker.col,
        `Plantilla no admitida (v1): falta «${marker.label}». ${marker.step}`,
        { expected: marker.label },
      );
    }
  }

  // Cabeceras de la fila 5, desde la columna A (las de la versión ya se avisaron).
  for (const key of INPUT_KEYS) {
    const name = actual[key];
    if (name === undefined) continue;
    HEADERS[key].forEach((label, index) => {
      const col = index + 1;
      if (markerCells.has(`${key}:${String(col)}`)) return;
      if (headerText(workbook, name, col) !== normalizeKey(label)) {
        issues.add(
          'HEADER_MISMATCH',
          name,
          HEADER_ROW,
          col,
          `La cabecera de la fila 5 debería ser «${label}»`,
          {
            expected: label,
          },
        );
      }
    });
  }

  // Fin de la tabla de Presupuesto y Metas (§2.1).
  const lastRow = { budget: 0, goals: 0 };
  for (const [key, start, labels] of [
    ['budget', PRESUPUESTO_SUMMARY_START, PRESUPUESTO_SUMMARY],
    ['goals', METAS_SUMMARY_START, METAS_SUMMARY],
  ] as const) {
    const name = actual[key];
    if (name === undefined) continue;
    const sheet = workbook.sheet(name);
    const startRow = findSummaryStart(sheet, start);
    if (startRow === undefined) {
      issues.add(
        'SUMMARY_NOT_FOUND',
        name,
        null,
        null,
        `No se encuentra el bloque de resumen («${start[0] ?? ''}») que marca el fin de la tabla`,
        { expected: start[0] ?? '' },
      );
      continue;
    }
    lastRow[key] = startRow - 1;
    const mismatch = firstSummaryMismatch(sheet, startRow, labels);
    if (mismatch !== undefined) {
      issues.add(
        'SUMMARY_UNEXPECTED',
        name,
        mismatch.row,
        1,
        `El bloque de resumen no contiene «${mismatch.expected}» donde se esperaba: la estructura puede haber cambiado`,
        { expected: mismatch.expected },
      );
    }
  }

  const complete = INPUT_KEYS.every((key) => actual[key] !== undefined);
  return {
    names: complete ? (actual as Record<InputSheetKey, string>) : null,
    lastRow: lastRow.budget > 0 && lastRow.goals > 0 ? lastRow : null,
    version,
  };
}

/**
 * Lee y valida el archivo. Nunca lanza por el contenido del archivo: los problemas se devuelven.
 *
 * @param bytes Contenido del `.xlsx` ya recibido en memoria (el archivo no se escribe en disco).
 */
export function parsePlanExcel(bytes: Buffer, options: ParseOptions): ParseOutcome {
  const file = checkFile(bytes, options.fileName);
  if (!file.ok) return { stage: 'rejected', issues: file.issues };

  try {
    const workbook = openWorkbook(file.archive);
    const issues = new IssueCollector();
    const { names, lastRow, version } = checkWorkbook(workbook, issues);

    if (names === null || lastRow === null || issues.errorCount > 0) {
      return { stage: 'failed', issues: issues.issues, templateVersion: version };
    }

    const extracted = extractPlan({
      workbook,
      names,
      issues,
      monthStart: `${options.month}-01`,
      resolveCategory: options.resolveCategory,
      lastRow,
    });
    return {
      stage: 'preview',
      issues: issues.issues,
      templateVersion: TEMPLATE_VERSION,
      extracted,
      contentHash: contentHash(extracted, TEMPLATE_VERSION),
    };
  } catch (error) {
    // Un XML o un ZIP corrupto o hostil a mitad de lectura: se rechaza el archivo como el nivel 1.
    const collector = new IssueCollector();
    if (error instanceof ZipLimitError) {
      collector.add(
        'FILE_ZIP_LIMITS',
        null,
        null,
        null,
        `El archivo supera los límites: ${error.message}`,
      );
    } else if (error instanceof ZipFormatError) {
      collector.add(
        'FILE_NOT_OOXML',
        null,
        null,
        null,
        `El archivo no es un libro de Excel válido: ${error.message}`,
      );
    } else {
      throw error;
    }
    return { stage: 'rejected', issues: collector.issues };
  }
}
