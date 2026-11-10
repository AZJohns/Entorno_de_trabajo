/**
 * Recolector de problemas (docs/plantilla-excel.md §11): se recogen todos antes de responder; el proceso
 * no se detiene en el primero.
 */
import {
  ISSUE_CODES,
  type ImportIssue,
  type IssueCode,
  type IssueSeverity,
} from '@backoffice/shared';
import { a1 } from './formula.ts';
import { MAX_ISSUES } from './template.ts';
import { ZipLimitError } from './zip.ts';

export interface IssueOptions {
  /** Sustituye la severidad por defecto del código (`REF_TARGET_EMPTY`, `REF_UNIT_MISMATCH`). */
  readonly severity?: IssueSeverity;
  readonly expected?: string;
  readonly found?: string;
}

export class IssueCollector {
  readonly issues: ImportIssue[] = [];

  /** Añade un problema. `row` y `col` pueden ser `null` si el problema es de la hoja o del archivo. */
  add(
    code: IssueCode,
    sheet: string | null,
    row: number | null,
    col: number | null,
    message: string,
    options: IssueOptions = {},
  ): void {
    // Defensa: un archivo hostil no puede llenar la base de datos de problemas.
    if (this.issues.length >= MAX_ISSUES) {
      throw new ZipLimitError(`Más de ${String(MAX_ISSUES)} problemas en el archivo`);
    }
    this.issues.push({
      code,
      severity: options.severity ?? ISSUE_CODES[code],
      sheet,
      cell: row === null || col === null ? null : a1(row, col),
      message,
      ...(options.expected === undefined ? {} : { expected: options.expected }),
      ...(options.found === undefined ? {} : { found: options.found }),
    });
  }

  get errorCount(): number {
    return this.issues.filter((issue) => issue.severity === 'error').length;
  }
}
