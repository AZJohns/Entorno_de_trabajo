/**
 * Lógica pura de la importación del Excel: comprobación previa del archivo, mensajes de cada error de la
 * API y agrupación de la vista previa. Todo con datos inventados.
 */
import type { ErrorCode, ExtractedPlan, ImportIssue } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import {
  MAX_UPLOAD_BYTES,
  checkFile,
  contentTypeFor,
  spreadsheetExtension,
} from '../src/imports/fileCheck.ts';
import { closedNotice, conflictReason, importNotice } from '../src/imports/messages.ts';
import {
  categoryRows,
  confirmOutcome,
  groupIssues,
  lineAmountCents,
} from '../src/imports/previewLogic.ts';

function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  errors?: { path: string; message: string }[],
): ApiError {
  return new ApiError(status, code, {
    type: 'about:blank',
    title: message,
    status,
    detail: message,
    code,
    ...(errors === undefined ? {} : { errors }),
  });
}

const conflict = (reason: string, message = 'texto de la API') =>
  apiError(409, 'CONFLICT', message, [{ path: reason, message }]);

describe('checkFile (antes de subir)', () => {
  it('un .xlsx pequeño pasa sin avisos', () => {
    expect(checkFile({ name: 'plan.xlsx', size: 1_000 })).toEqual({ blocking: [], warnings: [] });
  });

  it('más de 5 MB se avisa y bloquea; justo 5 MB pasa', () => {
    const big = checkFile({ name: 'plan.xlsx', size: MAX_UPLOAD_BYTES + 1 });
    expect(big.blocking).toHaveLength(1);
    expect(big.blocking[0]).toContain('máximo es 5 MB');
    expect(checkFile({ name: 'plan.xlsx', size: MAX_UPLOAD_BYTES }).blocking).toEqual([]);
  });

  it('otra extensión se avisa y recomienda .xlsx', () => {
    for (const name of ['plan.xls', 'plan.csv', 'plan.pdf', 'plan', 'plan.xlsx.exe']) {
      const result = checkFile({ name, size: 100 });
      expect(result.blocking.join(' ')).toContain('.xlsx');
    }
  });

  it('la extensión no distingue mayúsculas y un .xlsm avisa sin bloquear', () => {
    expect(checkFile({ name: 'PLAN.XLSX', size: 100 }).blocking).toEqual([]);
    const macro = checkFile({ name: 'plan.xlsm', size: 100 });
    expect(macro.blocking).toEqual([]);
    expect(macro.warnings.join(' ')).toContain('Se recomienda .xlsx');
  });

  it('un archivo vacío no se envía', () => {
    expect(checkFile({ name: 'plan.xlsx', size: 0 }).blocking).toEqual(['El archivo está vacío.']);
  });

  it('el tipo de contenido lo fija la extensión', () => {
    expect(spreadsheetExtension('a.XLSM')).toBe('xlsm');
    expect(spreadsheetExtension('a.txt')).toBeNull();
    expect(contentTypeFor('xlsx')).toContain('spreadsheetml.sheet');
    expect(contentTypeFor('xlsm')).toContain('macroenabled');
  });
});

describe('importNotice: un mensaje por cada razón de 409', () => {
  it('IMPORT_NOT_PREVIEW', () => {
    const notice = importNotice(conflict('IMPORT_NOT_PREVIEW'), 'confirm');
    expect(notice.title).toBe('Esta importación ya no está en vista previa');
    expect(notice.offerReupload).toBe(true);
  });

  it('IMPORT_EXPIRED ofrece volver a subir', () => {
    const notice = importNotice(conflict('IMPORT_EXPIRED'), 'confirm');
    expect(notice.title).toBe('La vista previa caducó');
    expect(notice.message).toContain('24 horas');
    expect(notice.offerReupload).toBe(true);
  });

  it('IMPORT_HAS_ERRORS lista los errores que envía la API y no ofrece volver a subir', () => {
    const error = apiError(409, 'CONFLICT', 'La importación tiene errores', [
      { path: 'IMPORT_HAS_ERRORS', message: 'CATEGORY_UNMAPPED (Presupuesto!B8): sin categoría' },
      { path: 'IMPORT_HAS_ERRORS', message: 'CELL_TYPE (Datos!C7): no es un importe' },
    ]);
    const notice = importNotice(error, 'confirm');
    expect(notice.title).toBe('Quedan errores sin resolver');
    expect(notice.details).toEqual([
      'CATEGORY_UNMAPPED (Presupuesto!B8): sin categoría',
      'CELL_TYPE (Datos!C7): no es un importe',
    ]);
    expect(notice.offerReupload).toBe(false);
  });

  it('CONTENT_ALREADY_IMPORTED explica que para revertir hay que subir con algún cambio', () => {
    const notice = importNotice(conflict('CONTENT_ALREADY_IMPORTED'), 'confirm');
    expect(notice.title).toBe('Este contenido ya se importó antes');
    expect(notice.message).toContain('con algún cambio');
    expect(notice.offerReupload).toBe(true);
  });

  it('BUDGET_MANUAL_EXISTS dice qué categorías chocan y que los manuales no se tocan', () => {
    const error = apiError(409, 'CONFLICT', 'Hay categorías con un presupuesto creado a mano', [
      {
        path: 'BUDGET_MANUAL_EXISTS',
        message: 'Ya hay un presupuesto creado a mano de «Comida» en 2026-10',
      },
      {
        path: 'BUDGET_MANUAL_EXISTS',
        message: 'Ya hay un presupuesto creado a mano de «Ocio» en 2026-10',
      },
    ]);
    const notice = importNotice(error, 'confirm');
    expect(notice.title).toBe('Hay presupuestos creados a mano que chocan');
    expect(notice.message).toContain('Los presupuestos manuales no se tocan');
    expect(notice.details).toHaveLength(2);
    expect(notice.details[0]).toContain('«Comida»');
  });

  it('un 409 sin razón conocida (categoría archivada) usa el texto de la API', () => {
    const error = apiError(409, 'CONFLICT', 'La categoría «Viajes» está archivada');
    const notice = importNotice(error, 'confirm');
    expect(notice.title).toBe('No se puede hacer ahora');
    expect(notice.message).toBe('La categoría «Viajes» está archivada');
  });

  it('la razón se lee de errors[].path y se ignoran las desconocidas', () => {
    expect(conflictReason(conflict('IMPORT_EXPIRED'))).toBe('IMPORT_EXPIRED');
    expect(conflictReason(conflict('OTRA_COSA'))).toBeNull();
    expect(conflictReason(apiError(409, 'CONFLICT', 'x'))).toBeNull();
  });
});

describe('importNotice: 400, 404, 413, 415, 422 y red', () => {
  it('400: petición no válida, con el detalle de campo', () => {
    const notice = importNotice(
      apiError(400, 'VALIDATION_ERROR', 'Datos no válidos', [
        { path: 'month', message: 'Formato YYYY-MM' },
      ]),
      'upload',
    );
    expect(notice.title).toBe('La petición no es válida');
    expect(notice.details).toEqual(['Formato YYYY-MM']);
  });

  it('404: la importación no existe y ofrece volver a subir', () => {
    const notice = importNotice(apiError(404, 'NOT_FOUND', 'La importación no existe'), 'read');
    expect(notice.title).toBe('La importación no existe');
    expect(notice.offerReupload).toBe(true);
  });

  it('413 y 415 de la subida', () => {
    expect(importNotice(apiError(413, 'PAYLOAD_TOO_LARGE', 'grande'), 'upload').title).toBe(
      'El archivo es demasiado grande',
    );
    const notMs = importNotice(apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'no es'), 'upload');
    expect(notMs.title).toBe('No es un libro de Excel');
    expect(notMs.message).toContain('guárdalo como .xlsx');
  });

  it('422 de la subida: macros, vínculos externos y límites tienen su texto', () => {
    const unprocessable = (path: string) =>
      importNotice(apiError(422, 'UNPROCESSABLE', 'x', [{ path, message: 'x' }]), 'upload');
    expect(unprocessable('FILE_HAS_MACROS').title).toBe('El archivo contiene macros');
    expect(unprocessable('FILE_EXTERNAL_LINKS').title).toBe(
      'El archivo tiene vínculos a otros libros',
    );
    expect(unprocessable('FILE_ZIP_LIMITS').title).toBe(
      'El archivo supera los límites de seguridad',
    );
  });

  it('422 de una decisión: incoherente, con el texto de la API', () => {
    const notice = importNotice(
      apiError(422, 'UNPROCESSABLE', 'La categoría «Viajes» está archivada', [
        { path: 'categoryMappings.0.categoryId', message: 'La categoría «Viajes» está archivada' },
      ]),
      'decisions',
    );
    expect(notice.title).toBe('Esa decisión no es coherente');
    expect(notice.message).toContain('«Viajes»');
  });

  it('403 de reautenticación y fallo de red', () => {
    expect(importNotice(apiError(403, 'REAUTH_REQUIRED', 'x'), 'upload').title).toBe(
      'Hace falta confirmar tu identidad',
    );
    expect(importNotice(new ApiError(0, 'NETWORK_ERROR', null), 'upload').title).toBe(
      'Sin conexión',
    );
    expect(importNotice(new Error('boom'), 'upload').message).toBe(
      'Ha ocurrido un error inesperado',
    );
  });

  it('lotes caducados y descartados', () => {
    expect(closedNotice('expired').offerReupload).toBe(true);
    expect(closedNotice('discarded').title).toBe('Esta importación se descartó');
  });
});

const issue = (over: Partial<ImportIssue>): ImportIssue => ({
  code: 'CELL_TYPE',
  severity: 'error',
  sheet: 'Datos',
  cell: 'C7',
  message: 'm',
  ...over,
});

describe('vista previa: agrupación', () => {
  it('agrupa por severidad (errores, avisos, información) y, dentro, por hoja', () => {
    const groups = groupIssues([
      issue({ severity: 'info', code: 'EVENT_AFTER_HORIZON' }),
      issue({ severity: 'warning', sheet: 'Presupuesto', code: 'EXPENSE_NOT_BUDGETED' }),
      issue({ severity: 'error', sheet: 'Datos' }),
      issue({ severity: 'error', sheet: null, code: 'SHEET_MISSING' }),
      issue({ severity: 'error', sheet: 'Datos', cell: 'C8' }),
    ]);
    expect(groups.map((group) => [group.severity, group.total])).toEqual([
      ['error', 3],
      ['warning', 1],
      ['info', 1],
    ]);
    expect(groups[0]?.sheets.map((entry) => [entry.sheet, entry.issues.length])).toEqual([
      ['Datos', 2],
      [null, 1],
    ]);
  });

  it('sin problemas no hay grupos', () => {
    expect(groupIssues([])).toEqual([]);
  });

  const extracted: ExtractedPlan = {
    items: [
      {
        sourceRow: 6,
        recordType: null,
        groupLabel: 'Hogar',
        concept: 'Alquiler',
        unit: null,
        amountCents: 80_000,
        quantityHundredths: null,
        nature: null,
        status: null,
        sourceNote: null,
        note: null,
      },
    ],
    budgetLines: [
      line(8, 'comida', 'Comida', null),
      line(9, 'comida', 'Comida', null),
      line(10, 'hogar', 'Hogar', '33333333-3333-4333-8333-333333333333'),
    ],
    events: [],
    goals: [],
    scenarios: [],
  };

  function line(
    sourceRow: number,
    categoryKey: string,
    categoryLabel: string,
    categoryId: string | null,
  ) {
    return {
      sourceRow,
      categoryLabel,
      categoryKey,
      categoryId,
      concept: 'c',
      costType: null,
      essential: null,
      itemRow: sourceRow === 10 ? 6 : null,
      statusItemRow: null,
    };
  }

  it('una fila por categoría distinta, con su recuento y su correspondencia', () => {
    expect(categoryRows(extracted)).toEqual([
      { key: 'comida', label: 'Comida', lines: 2, categoryId: null },
      {
        key: 'hogar',
        label: 'Hogar',
        lines: 1,
        categoryId: '33333333-3333-4333-8333-333333333333',
      },
    ]);
  });

  it('el importe de una línea sale de su fila de Datos, en céntimos', () => {
    const lines = extracted.budgetLines;
    expect(lineAmountCents(extracted, lines[2]!)).toBe(80_000);
    expect(lineAmountCents(extracted, lines[0]!)).toBeNull();
  });
});

describe('confirmOutcome: 201 frente a 200', () => {
  const budgets = { created: 1, updated: 0, deleted: 0, omitted: 0 };

  it('201 con recuentos: creado', () => {
    expect(confirmOutcome(201, budgets, 'confirmed')).toBe('created');
  });

  it('200 con el lote confirmado: ya estaba confirmado', () => {
    expect(confirmOutcome(200, null, 'confirmed')).toBe('already-confirmed');
  });

  it('200 con el lote todavía en vista previa: mismo contenido que el plan vigente, sin cambios', () => {
    expect(confirmOutcome(200, null, 'preview')).toBe('no-changes');
  });
});
