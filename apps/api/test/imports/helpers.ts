/**
 * Utilidades de los tests del importador: lectura de un libro de prueba con una correspondencia de categorías
 * que lo resuelve todo, y comprobación de un problema concreto. Datos FICTICIOS.
 */
import { expect } from 'vitest';
import type { ImportIssue } from '@backoffice/shared';
import { normalizeKey } from '../../src/modules/imports/domain/normalize.ts';
import { parsePlanExcel, type ParseOutcome } from '../../src/modules/imports/domain/parse-plan.ts';
import { FIXTURE_CATEGORIES, FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import type { WorkbookBuilder } from '../fixtures/xlsx-builder.ts';

/** UUID de relleno de la categoría `index` de la fixture. */
export const categoryId = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

/** Resuelve todas las categorías de la fixture (por su nombre normalizado). */
export const resolveAll = (key: string): string | undefined => {
  const index = FIXTURE_CATEGORIES.findIndex((name) => normalizeKey(name) === key);
  return index === -1 ? undefined : categoryId(index);
};

export interface ParseTestOptions {
  readonly fileName?: string;
  readonly month?: string;
  readonly resolveCategory?: (key: string) => string | undefined;
}

export function parseBytes(bytes: Buffer, options: ParseTestOptions = {}): ParseOutcome {
  return parsePlanExcel(bytes, {
    fileName: options.fileName ?? 'plan-ficticio.xlsx',
    month: options.month ?? FIXTURE_MONTH,
    resolveCategory: options.resolveCategory ?? resolveAll,
  });
}

export function parseBook(book: WorkbookBuilder, options: ParseTestOptions = {}): ParseOutcome {
  return parseBytes(book.toBuffer(), options);
}

/** Problemas del tipo dado. */
export function issuesWith(outcome: ParseOutcome, code: ImportIssue['code']): ImportIssue[] {
  return outcome.issues.filter((issue) => issue.code === code);
}

/** Código de cada problema, para comparar listas completas. */
export const codesOf = (outcome: ParseOutcome): string[] =>
  outcome.issues.map((issue) => `${issue.code}@${issue.sheet ?? ''}!${issue.cell ?? ''}`);

/** Comprueba que hay un problema con ese código, y opcionalmente en esa hoja y celda. */
export function expectIssue(
  outcome: ParseOutcome,
  code: ImportIssue['code'],
  where: { sheet?: string; cell?: string; severity?: ImportIssue['severity'] } = {},
): ImportIssue {
  const found = outcome.issues.filter(
    (issue) =>
      issue.code === code &&
      (where.sheet === undefined || issue.sheet === where.sheet) &&
      (where.cell === undefined || issue.cell === where.cell),
  );
  expect(
    found.length,
    `se esperaba ${code} ${JSON.stringify(where)} en ${JSON.stringify(outcome.issues)}`,
  ).toBeGreaterThan(0);
  const [first] = found;
  if (first === undefined) throw new Error('inalcanzable');
  if (where.severity !== undefined) expect(first.severity).toBe(where.severity);
  return first;
}

/** Extrae lo extraído o falla si el archivo no llegó a la vista previa. */
export function previewOf(outcome: ParseOutcome) {
  if (outcome.stage !== 'preview') {
    throw new Error(
      `Se esperaba una vista previa y fue «${outcome.stage}»: ${JSON.stringify(outcome.issues)}`,
    );
  }
  return outcome;
}
