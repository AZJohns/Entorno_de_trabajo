/**
 * Catálogo de problemas del importador (docs/plantilla-excel.md §11): UN test por cada código. Cada caso
 * parte de una copia del libro válido y estropea justo lo que el código describe. El último test falla si
 * aparece un código nuevo en el catálogo sin su caso, así que no puede quedar ninguno sin probar.
 *
 * `CACHED_VALUE_DIFF` queda para la fase 3b.2: compara el recálculo de la app con los valores en caché de
 * Excel y todavía no hay cálculos.
 */
import { describe, expect, it } from 'vitest';
import { ISSUE_CODES, type ImportIssue, type IssueCode } from '@backoffice/shared';
import type { ParseOutcome } from '../../src/modules/imports/domain/parse-plan.ts';
import {
  buildValidWorkbook,
  CHECKS,
  DATA_ROW,
  DATOS,
  ESCENARIOS,
  EVENTOS,
  METAS,
  PRESUPUESTO,
  dataRef,
} from '../fixtures/plan-workbook.ts';
import type { WorkbookBuilder } from '../fixtures/xlsx-builder.ts';
import { expectIssue, parseBook, parseBytes, resolveAll } from './helpers.ts';

type Stage = ParseOutcome['stage'];

interface Case {
  readonly code: IssueCode;
  readonly name: string;
  /** Estropea el libro válido. Si devuelve bytes, se usan tal cual en lugar del libro. */
  readonly mutate: (book: WorkbookBuilder) => Buffer | void;
  readonly stage: Stage;
  readonly sheet?: string;
  readonly cell?: string;
  readonly severity?: ImportIssue['severity'];
  readonly fileName?: string;
  readonly resolveCategory?: (key: string) => string | undefined;
}

const CASES: readonly Case[] = [
  // --- nivel 1: el archivo ---
  {
    code: 'FILE_TOO_LARGE',
    name: 'un archivo de más de 5 MB',
    stage: 'rejected',
    mutate: () => Buffer.alloc(5 * 1024 * 1024 + 1),
  },
  {
    code: 'FILE_NOT_OOXML',
    name: 'bytes que no son un ZIP (aunque se llame .xlsx)',
    stage: 'rejected',
    mutate: () => Buffer.from('esto no es un libro de Excel'),
  },
  {
    code: 'FILE_ZIP_LIMITS',
    name: 'más de 200 entradas en el ZIP',
    stage: 'rejected',
    mutate: (book) => {
      for (let index = 0; index < 201; index += 1) {
        book.extraFiles.push({ name: `relleno/${String(index)}.txt`, data: Buffer.from('x') });
      }
    },
  },
  {
    code: 'FILE_HAS_MACROS',
    name: 'contiene xl/vbaProject.bin',
    stage: 'rejected',
    mutate: (book) => {
      book.extraFiles.push({ name: 'xl/vbaProject.bin', data: Buffer.from('macro ficticia') });
    },
  },
  {
    code: 'FILE_EXTERNAL_LINKS',
    name: 'contiene xl/externalLinks/',
    stage: 'rejected',
    mutate: (book) => {
      book.extraFiles.push({
        name: 'xl/externalLinks/externalLink1.xml',
        data: Buffer.from('<externalLink/>'),
      });
    },
  },
  // --- nivel 2: el libro ---
  {
    code: 'SHEET_MISSING',
    name: 'falta una hoja',
    stage: 'failed',
    sheet: CHECKS,
    mutate: (book) => {
      book.removeSheet(CHECKS);
    },
  },
  {
    code: 'SHEET_UNEXPECTED',
    name: 'sobra una hoja',
    stage: 'preview',
    sheet: 'Hoja de más',
    severity: 'warning',
    mutate: (book) => {
      book.addSheet('Hoja de más').set('A1', 'x');
    },
  },
  {
    code: 'HEADER_MISMATCH',
    name: 'la cabecera de la fila 5 no coincide',
    stage: 'failed',
    sheet: DATOS,
    cell: 'B5',
    mutate: (book) => {
      book.sheet(DATOS).set('B5', 'Descripción');
    },
  },
  {
    code: 'TEMPLATE_VERSION_UNSUPPORTED',
    name: 'plantilla v1: falta «Tipo de registro»',
    stage: 'failed',
    sheet: DATOS,
    cell: 'I5',
    mutate: (book) => {
      book.sheet(DATOS).clear('I5');
    },
  },
  {
    code: 'SUMMARY_NOT_FOUND',
    name: 'no está la etiqueta de inicio del resumen de Presupuesto',
    stage: 'failed',
    sheet: PRESUPUESTO,
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('A14', 'Otra cosa');
    },
  },
  {
    code: 'SUMMARY_UNEXPECTED',
    name: 'el resumen de Presupuesto cambia de estructura',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'A16',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('A16', 'Una etiqueta nueva');
    },
  },
  {
    code: 'ROW_AFTER_GAP',
    name: 'datos tras una fila vacía en Datos y supuestos',
    stage: 'preview',
    sheet: DATOS,
    cell: 'A21',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(DATOS).clearRow(20);
    },
  },
  // --- nivel 3: la celda ---
  {
    code: 'CELL_REQUIRED',
    name: 'falta el concepto',
    stage: 'preview',
    sheet: DATOS,
    cell: 'B8',
    mutate: (book) => {
      book.sheet(DATOS).clear('B8');
    },
  },
  {
    code: 'CELL_TYPE',
    name: 'un importe escrito como texto «12,50»',
    stage: 'preview',
    sheet: DATOS,
    cell: 'C8',
    mutate: (book) => {
      book.sheet(DATOS).set('C8', '12,50');
    },
  },
  {
    code: 'VALUE_NOT_IN_LIST',
    name: 'una unidad fuera del catálogo después del rango validado por Excel',
    stage: 'preview',
    sheet: DATOS,
    cell: 'D29',
    mutate: (book) => {
      book.sheet(DATOS).set('D29', 'EUR al mes');
    },
  },
  {
    code: 'AMOUNT_PRECISION',
    name: 'un importe con 3 decimales',
    stage: 'preview',
    sheet: DATOS,
    cell: 'C8',
    mutate: (book) => {
      book.sheet(DATOS).set('C8', 800.005);
    },
  },
  {
    code: 'AMOUNT_NEGATIVE',
    name: 'un importe negativo',
    stage: 'preview',
    sheet: DATOS,
    cell: 'C8',
    mutate: (book) => {
      book.sheet(DATOS).set('C8', -5);
    },
  },
  {
    code: 'FORMULA_NOT_ALLOWED',
    name: 'una fórmula en la columna Valor',
    stage: 'preview',
    sheet: DATOS,
    cell: 'C8',
    mutate: (book) => {
      book.sheet(DATOS).set('C8', { f: '400*2', v: 800 });
    },
  },
  {
    code: 'FORMULA_REQUIRED',
    name: 'un literal donde Mensual exige una referencia',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'E12',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('E12', 120);
    },
  },
  {
    code: 'REF_UNSUPPORTED',
    name: 'una fórmula que no es una forma cerrada (suma con una constante)',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'E12',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('E12', { f: `'${DATOS}'!$C$26+10`, v: 130 });
    },
  },
  {
    code: 'REF_TARGET_EMPTY',
    name: 'una referencia a una fila vacía',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'E12',
    severity: 'error',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('E12', { f: dataRef('C', 100), v: 0 });
    },
  },
  {
    code: 'REF_TARGET_COLUMN',
    name: 'Mensual apunta a la columna de estados',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'E12',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('E12', { f: dataRef('F', DATA_ROW.loanInstallment), v: 'x' });
    },
  },
  {
    code: 'REF_ROWS_MISMATCH',
    name: 'Mensual y Estado apuntan a filas distintas',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'H12',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('H12', { f: dataRef('F', DATA_ROW.loanTerm), v: 'x' });
    },
  },
  {
    code: 'REF_UNIT_MISMATCH',
    name: 'Mensual apunta a una fila en €',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'E12',
    severity: 'error',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('E12', { f: dataRef('C', DATA_ROW.carInsurance), v: 450 });
      book.sheet(PRESUPUESTO).set('H12', { f: dataRef('F', DATA_ROW.carInsurance), v: 'x' });
    },
  },
  {
    code: 'DUPLICATE_REFERENCE',
    name: 'dos líneas de Presupuesto apuntan a la misma fila',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'E12',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(PRESUPUESTO).set('E12', { f: dataRef('C', DATA_ROW.rent), v: 800 });
      book.sheet(PRESUPUESTO).set('H12', { f: dataRef('F', DATA_ROW.rent), v: 'x' });
    },
  },
  {
    code: 'VALUE_IN_CALCULATED_COLUMN',
    name: 'el gasto irregular con el Anual escrito a mano (ya está en la fixture)',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'F10',
    severity: 'warning',
    mutate: () => undefined,
  },
  {
    code: 'EVENT_DATE_REQUIRED',
    name: 'un evento incluido sin fecha',
    stage: 'preview',
    sheet: EVENTOS,
    cell: 'E6',
    mutate: (book) => {
      book.sheet(EVENTOS).clear('E6');
    },
  },
  {
    code: 'EVENT_REF_MONTHLY',
    name: 'un evento apunta a una fila en €/mes (ya está en la fixture)',
    stage: 'preview',
    sheet: EVENTOS,
    cell: 'C9',
    severity: 'info',
    mutate: () => undefined,
  },
  {
    code: 'EVENT_ITEM_ALREADY_IN_BASE',
    name: 'un evento incluido con el importe de una línea de Presupuesto (ya está en la fixture)',
    stage: 'preview',
    sheet: EVENTOS,
    cell: 'C10',
    severity: 'warning',
    mutate: () => undefined,
  },
  {
    code: 'SCENARIO_ITEM_ALREADY_IN_BASE',
    name: 'el extra de un escenario ya está en el gasto base (ya está en la fixture)',
    stage: 'preview',
    sheet: ESCENARIOS,
    cell: 'C9',
    severity: 'warning',
    mutate: () => undefined,
  },
  {
    code: 'EMERGENCY_FUND_MONTHS_MISSING',
    name: 'meta de fondo de emergencia sin fila de meses',
    stage: 'preview',
    sheet: METAS,
    cell: 'I7',
    mutate: (book) => {
      book.sheet(DATOS).set('I18', 'Supuesto');
    },
  },
  {
    code: 'EMERGENCY_FUND_MONTHS_DUPLICATED',
    name: 'dos filas de meses de fondo de emergencia',
    stage: 'preview',
    sheet: DATOS,
    cell: 'I27',
    mutate: (book) => {
      book.sheet(DATOS).set('I27', 'Meses de fondo de emergencia');
    },
  },
  // --- nivel 4: la semántica ---
  {
    code: 'CATEGORY_UNMAPPED',
    name: 'una categoría sin correspondencia',
    stage: 'preview',
    sheet: PRESUPUESTO,
    cell: 'A6',
    severity: 'error',
    resolveCategory: (key) => (key === 'vivienda' ? undefined : resolveAll(key)),
    mutate: () => undefined,
  },
  {
    code: 'TYPE_SIGNAL_MISMATCH',
    name: 'un ingreso con la unidad € en vez de €/mes',
    stage: 'preview',
    sheet: DATOS,
    cell: 'I6',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(DATOS).set('D6', '€');
    },
  },
  {
    code: 'EXPENSE_NOT_BUDGETED',
    name: 'un gasto incluido que ninguna línea de Presupuesto referencia',
    stage: 'preview',
    sheet: DATOS,
    cell: 'C29',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(DATOS).set('F29', 'Confirmado');
    },
  },
  // --- avisos de §6.3 sin código en la revisión 3 (añadidos en la 3b.1) ---
  {
    code: 'EVENT_INCLUDED_BUT_CLOSED',
    name: 'un evento incluido en la proyección con el estado «Pagado»',
    stage: 'preview',
    sheet: EVENTOS,
    cell: 'F6',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(EVENTOS).set('D6', 'Pagado');
    },
  },
  {
    code: 'EVENT_OVERDUE',
    name: 'un evento incluido, no pagado y anterior al mes 1',
    stage: 'preview',
    sheet: EVENTOS,
    cell: 'E6',
    severity: 'warning',
    mutate: (book) => {
      book.sheet(EVENTOS).set('E6', { date: '2026-10-01' });
    },
  },
  {
    code: 'EVENT_AFTER_HORIZON',
    name: 'un evento posterior al mes 12 (ya está en la fixture)',
    stage: 'preview',
    sheet: EVENTOS,
    cell: 'E10',
    severity: 'info',
    mutate: () => undefined,
  },
];

/** Códigos que esta fase no puede probar todavía. */
const DEFERRED: readonly IssueCode[] = ['CACHED_VALUE_DIFF'];

describe('catálogo de problemas (§11): un caso por código', () => {
  it.each(CASES)('$code: $name', (testCase) => {
    const book = buildValidWorkbook();
    const replacement = testCase.mutate(book);
    const options = {
      ...(testCase.fileName === undefined ? {} : { fileName: testCase.fileName }),
      ...(testCase.resolveCategory === undefined
        ? {}
        : { resolveCategory: testCase.resolveCategory }),
    };
    const outcome =
      replacement === undefined ? parseBook(book, options) : parseBytes(replacement, options);
    expect(outcome.stage).toBe(testCase.stage);
    expectIssue(outcome, testCase.code, {
      ...(testCase.sheet === undefined ? {} : { sheet: testCase.sheet }),
      ...(testCase.cell === undefined ? {} : { cell: testCase.cell }),
      severity: testCase.severity ?? ISSUE_CODES[testCase.code],
    });
  });

  it('el catálogo del código coincide con el de plantilla-excel.md §11 (severidad por defecto)', () => {
    const expected: Record<string, string> = {
      FILE_TOO_LARGE: 'error',
      FILE_NOT_OOXML: 'error',
      FILE_ZIP_LIMITS: 'error',
      FILE_HAS_MACROS: 'error',
      FILE_EXTERNAL_LINKS: 'error',
      SHEET_MISSING: 'error',
      SHEET_UNEXPECTED: 'warning',
      HEADER_MISMATCH: 'error',
      TEMPLATE_VERSION_UNSUPPORTED: 'error',
      SUMMARY_NOT_FOUND: 'error',
      SUMMARY_UNEXPECTED: 'warning',
      ROW_AFTER_GAP: 'warning',
      CELL_REQUIRED: 'error',
      CELL_TYPE: 'error',
      VALUE_NOT_IN_LIST: 'error',
      AMOUNT_PRECISION: 'error',
      AMOUNT_NEGATIVE: 'error',
      FORMULA_NOT_ALLOWED: 'error',
      FORMULA_REQUIRED: 'error',
      REF_UNSUPPORTED: 'error',
      REF_TARGET_EMPTY: 'error',
      REF_TARGET_COLUMN: 'error',
      REF_ROWS_MISMATCH: 'error',
      REF_UNIT_MISMATCH: 'error',
      DUPLICATE_REFERENCE: 'warning',
      VALUE_IN_CALCULATED_COLUMN: 'warning',
      EVENT_DATE_REQUIRED: 'error',
      EVENT_REF_MONTHLY: 'info',
      EVENT_ITEM_ALREADY_IN_BASE: 'warning',
      SCENARIO_ITEM_ALREADY_IN_BASE: 'warning',
      EMERGENCY_FUND_MONTHS_MISSING: 'error',
      EMERGENCY_FUND_MONTHS_DUPLICATED: 'error',
      CATEGORY_UNMAPPED: 'error',
      TYPE_SIGNAL_MISMATCH: 'warning',
      EXPENSE_NOT_BUDGETED: 'warning',
      CACHED_VALUE_DIFF: 'info',
      EVENT_INCLUDED_BUT_CLOSED: 'warning',
      EVENT_OVERDUE: 'warning',
      EVENT_AFTER_HORIZON: 'info',
    };
    expect({ ...ISSUE_CODES }).toEqual(expected);
  });

  it('no queda ningún código del catálogo sin su caso (salvo los de la fase 3b.2)', () => {
    const covered = new Set(CASES.map((testCase) => testCase.code));
    const missing = (Object.keys(ISSUE_CODES) as IssueCode[]).filter(
      (code) => !covered.has(code) && !DEFERRED.includes(code),
    );
    expect(missing).toEqual([]);
    expect(covered.size).toBe(CASES.length); // un único caso por código
  });
});
