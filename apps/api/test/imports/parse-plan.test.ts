/**
 * Importador de punta a punta sobre libros FICTICIOS: la fixture válida (lo extraído y los problemas
 * esperados, ver `test/fixtures/plan-ficticio-v2.expected.md`), la tolerancia de §3 y los casos de §2.1, §4,
 * §5 y §6 que no son un código del catálogo por sí solos.
 */
import { describe, expect, it } from 'vitest';
import type { ExtractedPlan } from '@backoffice/shared';
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
import { buildZip } from '../fixtures/xlsx-builder.ts';
import {
  categoryId,
  codesOf,
  expectIssue,
  issuesWith,
  parseBook,
  parseBytes,
  previewOf,
  resolveAll,
} from './helpers.ts';

function extractedOf(book: WorkbookBuilder = buildValidWorkbook()): ExtractedPlan {
  return previewOf(parseBook(book)).extracted;
}

describe('la fixture válida', () => {
  it('llega a la vista previa sin errores y con los avisos esperados', () => {
    const outcome = previewOf(parseBook(buildValidWorkbook()));
    expect(outcome.templateVersion).toBe(2);
    expect(codesOf(outcome)).toEqual([
      'VALUE_IN_CALCULATED_COLUMN@Presupuesto!F10',
      'EVENT_REF_MONTHLY@Eventos y compromisos!C9',
      'EVENT_AFTER_HORIZON@Eventos y compromisos!E10',
      'EVENT_ITEM_ALREADY_IN_BASE@Eventos y compromisos!C10',
      'SCENARIO_ITEM_ALREADY_IN_BASE@Escenarios!C9',
    ]);
    expect(outcome.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('extrae las filas de Datos con importes en céntimos y los meses en centésimas', () => {
    const { items } = extractedOf();
    expect(items).toHaveLength(24);
    expect(items[0]).toMatchObject({
      sourceRow: 6,
      recordType: 'income',
      groupLabel: 'Ingresos',
      concept: 'Salario neto',
      unit: 'eur_per_month',
      amountCents: 250_000,
      quantityHundredths: null,
      nature: 'recurring',
      status: 'confirmed',
    });
    expect(items.find((item) => item.sourceRow === DATA_ROW.emergencyMonths)).toMatchObject({
      unit: 'months',
      amountCents: null,
      quantityHundredths: 600,
    });
    // La fecha de «Fuente/fecha» se guarda en ISO.
    expect(items[1]?.sourceNote).toBe('2026-10-15');
    expect(items[1]?.note).toBe('Fuente anotada como fecha');
  });

  it('los importes y meses coinciden con la tabla de plan-ficticio-v2.expected.md', () => {
    const byRow = new Map(extractedOf().items.map((item) => [item.sourceRow, item]));
    const cents: [number, number][] = [
      [6, 250_000],
      [7, 30_000],
      [8, 80_000],
      [9, 6_000],
      [10, 35_000],
      [11, 4_000],
      [12, 2_500],
      [13, 3_000],
      [16, 500_000],
      [17, 150_000],
      [26, 12_000],
    ];
    for (const [row, expected] of cents)
      expect(byRow.get(row)?.amountCents, `fila ${String(row)}`).toBe(expected);
    expect(byRow.get(18)?.quantityHundredths).toBe(600);
    expect(byRow.get(27)?.quantityHundredths).toBe(1800);
  });

  it('cubre los 9 tipos de registro, los 10 estados y las 11 naturalezas', () => {
    const { items } = extractedOf();
    expect(new Set(items.map((item) => item.recordType)).size).toBe(9);
    expect(new Set(items.map((item) => item.status)).size).toBe(10);
    expect(new Set(items.map((item) => item.nature)).size).toBe(11);
    expect(items.filter((item) => item.recordType === 'savings_balance')).toHaveLength(2);
  });

  it('relaciona Presupuesto con Datos por la referencia de la fórmula (compartidas expandidas)', () => {
    const { budgetLines } = extractedOf();
    expect(budgetLines).toHaveLength(7);
    // Las seis primeras líneas son fórmulas COMPARTIDAS que apuntan a las filas 8 a 13.
    expect(budgetLines.slice(0, 6).map((line) => [line.itemRow, line.statusItemRow])).toEqual([
      [8, 8],
      [9, 9],
      [10, 10],
      [11, 11],
      [12, 12],
      [13, 13],
    ]);
    expect(budgetLines[6]).toMatchObject({
      itemRow: 26,
      statusItemRow: 26,
      costType: 'fixed',
      essential: true,
    });
    expect(budgetLines[0]).toMatchObject({
      sourceRow: 6,
      categoryLabel: 'Vivienda',
      categoryKey: 'vivienda',
      categoryId: categoryId(0),
      costType: 'fixed',
      essential: true,
    });
    expect(budgetLines[4]).toMatchObject({ costType: 'irregular', essential: false });
  });

  it('extrae las cuatro formas de importe de los eventos, dos de ellas sobre la misma fila', () => {
    const { events } = extractedOf();
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({
      amountCents: 9000,
      amountItemRow: null,
      expectedDate: '2026-11-15',
      includeInProjection: true,
    });
    expect(events[1]).toMatchObject({
      amountCents: null,
      amountItemRow: 25,
      multiplierItemRow: null,
    });
    expect(events[2]).toMatchObject({ amountItemRow: 25, expectedDate: '2027-08-10' });
    expect(events[3]).toMatchObject({
      amountItemRow: 26,
      includeInProjection: false,
      expectedDate: null,
    });
    // Cuota × plazo: la cuota en €/mes y el plazo en meses; la app calcula el producto.
    expect(events[4]).toMatchObject({
      amountItemRow: 26,
      multiplierItemRow: 27,
      status: 'active',
      expectedDate: '2028-05-01',
    });
  });

  it('extrae las metas (REF, literal, fondo de emergencia sin objetivo) y los escenarios (listas de filas)', () => {
    const { goals, scenarios } = extractedOf();
    expect(goals).toHaveLength(4);
    expect(goals[0]).toMatchObject({
      goalKind: 'fixed_amount',
      target: { kind: 'item', row: 19 },
      current: { kind: 'literal', cents: 100_000 },
      contribution: { kind: 'item', row: 20 },
    });
    expect(goals[1]).toMatchObject({
      goalKind: 'emergency_fund',
      target: null, // lo calcula la app
      current: { kind: 'item', row: 16 },
      contribution: { kind: 'item', row: 21 },
    });
    expect(goals[2]).toMatchObject({ contribution: { kind: 'literal', cents: 0 } });
    expect(scenarios.map((scenario) => [scenario.extraMonthlyRows, scenario.oneOffRows])).toEqual([
      [[], []],
      [[22], []],
      [[22, 23], [24]],
      [[9], []],
    ]);
  });

  it('no extrae nada de lo que la plantilla calcula (solo entradas)', () => {
    const serialized = JSON.stringify(extractedOf());
    // Las celdas calculadas llevan valores en caché (p. ej. 9600, 7260, 1425): no deben aparecer.
    for (const derived of ['9600', '7260', '1425', 'Completada', 'En curso']) {
      expect(serialized).not.toContain(derived);
    }
  });

  it('el comentario de celda y los metadatos se ignoran', () => {
    const book = buildValidWorkbook();
    expect(book.extraFiles.some((file) => file.name === 'xl/comments1.xml')).toBe(true);
    expect(JSON.stringify(extractedOf(book))).not.toContain('Comentario ficticio');
  });
});

describe('fin de la tabla (§2.1)', () => {
  it('la fixture reproduce la disposición real sin falsos ROW_AFTER_GAP', () => {
    const outcome = previewOf(parseBook(buildValidWorkbook()));
    expect(issuesWith(outcome, 'ROW_AFTER_GAP')).toEqual([]);
  });

  it('Presupuesto: una línea nueva en la fila vacía anterior al resumen se importa', () => {
    const book = buildValidWorkbook();
    // Se mueve el resumen una fila abajo y se escribe una línea en la 13.
    const sheet = book.sheet(PRESUPUESTO);
    for (let row = 19; row >= 14; row -= 1) {
      for (const col of ['A', 'E']) {
        const value = sheet.cells.get(`${col}${String(row)}`);
        if (value !== undefined) sheet.set(`${col}${String(row + 1)}`, value);
      }
    }
    sheet.clear('E14').clear('A14');
    sheet.row(13, ['Ocio', 'Otra línea', 'Variable', 'No']);
    sheet.set('E13', { f: dataRef('C', DATA_ROW.potentialExpense), v: 100 });
    sheet.set('H13', { f: dataRef('F', DATA_ROW.potentialExpense), v: 'Potencial' });
    const outcome = previewOf(parseBook(book));
    expect(outcome.extracted.budgetLines).toHaveLength(8);
    expect(issuesWith(outcome, 'ROW_AFTER_GAP')).toEqual([]);
  });

  it('Presupuesto: una fila con datos tras una fila vacía dentro de la zona avisa y no se importa', () => {
    const book = buildValidWorkbook();
    const sheet = book.sheet(PRESUPUESTO);
    sheet.clearRow(9); // hueco en la línea 9; las 10, 11 y 12 quedan «tras el hueco»
    const outcome = previewOf(parseBook(book));
    expect(outcome.extracted.budgetLines.map((line) => line.sourceRow)).toEqual([6, 7, 8]);
    expect(issuesWith(outcome, 'ROW_AFTER_GAP').map((issue) => issue.cell)).toEqual([
      'A10',
      'A11',
      'A12',
    ]);
  });

  it('Metas: dos filas vacías antes del resumen no generan avisos; datos tras un hueco sí', () => {
    const clean = previewOf(parseBook(buildValidWorkbook()));
    expect(issuesWith(clean, 'ROW_AFTER_GAP')).toEqual([]);
    const book = buildValidWorkbook();
    book.sheet(METAS).clearRow(7);
    const outcome = previewOf(parseBook(book));
    expect(outcome.extracted.goals.map((goal) => goal.sourceRow)).toEqual([6]);
    expect(issuesWith(outcome, 'ROW_AFTER_GAP').map((issue) => issue.cell)).toEqual(['A8', 'A9']);
  });

  it('Escenarios: una nota con contenido solo en A se ignora; con contenido en C o D, avisa', () => {
    const book = buildValidWorkbook();
    expect(issuesWith(previewOf(parseBook(book)), 'ROW_AFTER_GAP')).toEqual([]);
    book.sheet(ESCENARIOS).set('C13', { f: '0', v: 0 });
    const outcome = previewOf(parseBook(book));
    expect(issuesWith(outcome, 'ROW_AFTER_GAP').map((issue) => issue.cell)).toEqual(['C13']);
    expect(outcome.extracted.scenarios).toHaveLength(4);
  });

  it('Eventos: no hay notas al pie, así que cualquier contenido tras un hueco avisa', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('A12', 'Una nota al pie');
    const outcome = previewOf(parseBook(book));
    expect(issuesWith(outcome, 'ROW_AFTER_GAP').map((issue) => issue.cell)).toEqual(['A12']);
    expect(outcome.extracted.events).toHaveLength(5);
  });
});

describe('normalización (§3) y tipos de celda (§4)', () => {
  it('tolera mayúsculas, acentos y espacios en hojas, cabeceras y listas; «Si» vale como «Sí»', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).set('D8', '  €/MES ').set('F8', 'confirmado').set('I8', 'GASTO');
    book.sheet(DATOS).set('A5', 'grupo').set('B5', '  Concepto   ');
    book.sheet(PRESUPUESTO).set('D6', 'Si').set('A5', 'categoria');
    const outcome = previewOf(parseBook(book));
    expect(outcome.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(outcome.extracted.items[2]).toMatchObject({
      unit: 'eur_per_month',
      status: 'confirmed',
      recordType: 'expense',
    });
    expect(outcome.extracted.budgetLines[0]?.essential).toBe(true);
  });

  it('la hoja se encuentra aunque su nombre cambie de mayúsculas o acentos', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).name = 'DATOS Y SUPUESTOS';
    // La fórmula del archivo menciona la hoja con su nombre real: se compara sin distinguir mayúsculas.
    expect(previewOf(parseBook(book)).extracted.budgetLines[0]?.itemRow).toBe(8);
    const sinAcento = buildValidWorkbook();
    sinAcento.sheet('Proyección 12M').name = 'Proyeccion 12M';
    expect(parseBook(sinAcento).stage).toBe('preview');
  });

  it('los importes se convierten a céntimos con redondeo seguro: 0,1 + 0,2 en céntimos exactos', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).set('C8', 0.1).set('C9', 0.29).set('C10', 1234.56);
    const { items } = previewOf(parseBook(book)).extracted;
    expect(items.slice(2, 5).map((item) => item.amountCents)).toEqual([10, 29, 123_456]);
  });

  it('los meses admiten 2 decimales (centésimas) y rechazan 3 o negativos', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).set('C18', 6.25);
    expect(previewOf(parseBook(book)).extracted.items[12]?.quantityHundredths).toBe(625);
    book.sheet(DATOS).set('C18', 6.255);
    expectIssue(parseBook(book), 'AMOUNT_PRECISION', { sheet: DATOS, cell: 'C18' });
    book.sheet(DATOS).set('C18', -1);
    expectIssue(parseBook(book), 'AMOUNT_NEGATIVE', { sheet: DATOS, cell: 'C18' });
  });

  it('un texto con forma de fecha es CELL_TYPE; un número sin formato de fecha, también', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('E6', '2026-11-15');
    expectIssue(parseBook(book), 'CELL_TYPE', { sheet: EVENTOS, cell: 'E6' });
    book.sheet(EVENTOS).set('E6', 46_000);
    expectIssue(parseBook(book), 'CELL_TYPE', { sheet: EVENTOS, cell: 'E6' });
  });

  it('una fecha con formato personalizado y el sistema 1904 se leen bien', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('E6', { date: '2026-12-01', customFormat: true });
    expect(previewOf(parseBook(book)).extracted.events[0]?.expectedDate).toBe('2026-12-01');
    const book1904 = buildValidWorkbook();
    book1904.date1904 = true;
    // Todas las fechas se reescriben con el sistema 1904 al construir el XML.
    expect(previewOf(parseBook(book1904)).extracted.events[0]?.expectedDate).toBe('2026-11-15');
    expect(previewOf(parseBook(book1904)).extracted.items[1]?.sourceNote).toBe('2026-10-15');
  });

  it('un importe numérico con formato de fecha no es un importe', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).set('C8', { date: '2026-01-01' });
    expectIssue(parseBook(book), 'CELL_TYPE', { sheet: DATOS, cell: 'C8' });
  });

  it('un valor de error de Excel (#REF!) en una celda de entrada es CELL_TYPE', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).set('C8', { err: '#REF!' });
    expectIssue(parseBook(book), 'CELL_TYPE', { sheet: DATOS, cell: 'C8' });
  });
});

describe('fórmulas (§5): se leen como texto y nunca se ejecutan', () => {
  it('una fórmula con función peligrosa en Excel es solo REF_UNSUPPORTED', () => {
    const book = buildValidWorkbook();
    book.sheet(PRESUPUESTO).set('E12', { f: `HYPERLINK("http://ejemplo.invalid/x","y")`, v: 'y' });
    book.sheet(EVENTOS).set('C6', { f: `cmd|' /C calc'!A0`, v: 0 });
    const outcome = previewOf(parseBook(book));
    expectIssue(outcome, 'REF_UNSUPPORTED', { sheet: PRESUPUESTO, cell: 'E12' });
    expectIssue(outcome, 'REF_UNSUPPORTED', { sheet: EVENTOS, cell: 'C6' });
  });

  it('el valor en caché no se usa: una referencia correcta con caché absurda se extrae igual', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('C7', { f: dataRef('C', DATA_ROW.carInsurance), v: 999_999 });
    const { events } = previewOf(parseBook(book)).extracted;
    expect(events[1]).toMatchObject({ amountItemRow: 25, amountCents: null });
  });

  it('PRODUCT2 en cualquier orden; con dos filas en €/mes es REF_UNIT_MISMATCH', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('C10', { f: `'${DATOS}'!$C$27*'${DATOS}'!$C$26`, v: 0 });
    expect(previewOf(parseBook(book)).extracted.events[4]).toMatchObject({
      amountItemRow: 26,
      multiplierItemRow: 27,
    });
    book.sheet(EVENTOS).set('C10', { f: `'${DATOS}'!$C$26*'${DATOS}'!$C$8`, v: 0 });
    expectIssue(parseBook(book), 'REF_UNIT_MISMATCH', {
      sheet: EVENTOS,
      cell: 'C10',
      severity: 'error',
    });
  });

  it('Eventos: SUM, =0 y un literal 0 (este sí vale como importe) se tratan según §5', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('C6', { f: '0', v: 0 });
    expectIssue(parseBook(book), 'REF_UNSUPPORTED', { sheet: EVENTOS, cell: 'C6' });
    book.sheet(EVENTOS).set('C6', 0);
    expect(previewOf(parseBook(book)).extracted.events[0]?.amountCents).toBe(0);
  });

  it('Eventos: una REF a una fila en meses es REF_UNIT_MISMATCH', () => {
    const book = buildValidWorkbook();
    book.sheet(EVENTOS).set('C7', { f: dataRef('C', DATA_ROW.loanTerm), v: 18 });
    expectIssue(parseBook(book), 'REF_UNIT_MISMATCH', {
      sheet: EVENTOS,
      cell: 'C7',
      severity: 'error',
    });
  });

  it('SUMRANGE: las filas vacías del rango se omiten con un aviso; un rango de otra columna o de varias, no', () => {
    const book = buildValidWorkbook();
    book.sheet(ESCENARIOS).set('C7', { f: `SUM('${DATOS}'!C22:C31)`, v: 0 });
    const outcome = previewOf(parseBook(book));
    expect(outcome.extracted.scenarios[1]?.extraMonthlyRows).toEqual([
      22, 23, 24, 25, 26, 27, 28, 29,
    ]);
    const empties = issuesWith(outcome, 'REF_TARGET_EMPTY');
    expect(empties.map((issue) => issue.cell)).toEqual(['C7', 'C7']);
    expect(empties.every((issue) => issue.severity === 'warning')).toBe(true);

    book.sheet(ESCENARIOS).set('C7', { f: `SUM('${DATOS}'!F22:F23)`, v: 0 });
    expectIssue(parseBook(book), 'REF_TARGET_COLUMN', { sheet: ESCENARIOS, cell: 'C7' });
    book.sheet(ESCENARIOS).set('C7', { f: `SUM('${DATOS}'!C22:D23)`, v: 0 });
    expectIssue(parseBook(book), 'REF_UNSUPPORTED', { sheet: ESCENARIOS, cell: 'C7' });
    // Un rango absurdo no enumera un millón de filas.
    book.sheet(ESCENARIOS).set('C7', { f: `SUM('${DATOS}'!C1:C1000000)`, v: 0 });
    expectIssue(parseBook(book), 'REF_UNSUPPORTED', { sheet: ESCENARIOS, cell: 'C7' });
  });

  it('Escenarios: un literal 0 vale como =0; otro literal exige fórmula; una unidad distinta solo avisa', () => {
    const book = buildValidWorkbook();
    book.sheet(ESCENARIOS).set('C6', 0);
    expect(previewOf(parseBook(book)).extracted.scenarios[0]?.extraMonthlyRows).toEqual([]);
    book.sheet(ESCENARIOS).set('C6', 5);
    expectIssue(parseBook(book), 'FORMULA_REQUIRED', { sheet: ESCENARIOS, cell: 'C6' });
    // Pago puntual (€) apuntando a una fila en €/mes: aviso, no error (los escenarios simulan).
    const unit = buildValidWorkbook();
    unit.sheet(ESCENARIOS).set('D7', { f: dataRef('C', DATA_ROW.potentialExpense), v: 100 });
    const outcome = previewOf(parseBook(unit));
    expectIssue(outcome, 'REF_UNIT_MISMATCH', {
      sheet: ESCENARIOS,
      cell: 'D7',
      severity: 'warning',
    });
  });

  it('§7: Escenarios · Pago puntual (D) admite one_off_payment; el Extra mensual (C) y otros tipos, no', () => {
    const book = buildValidWorkbook();
    // Fila 25: «Seguro del coche (pago único)», 450 €, tipo `one_off_payment`.
    book.sheet(ESCENARIOS).set('D7', { f: dataRef('C', DATA_ROW.carInsurance), v: 450 });
    const accepted = previewOf(parseBook(book));
    expect(issuesWith(accepted, 'TYPE_SIGNAL_MISMATCH')).toEqual([]);
    expect(issuesWith(accepted, 'REF_UNIT_MISMATCH')).toEqual([]);
    expect(accepted.extracted.scenarios[1]?.oneOffRows).toEqual([DATA_ROW.carInsurance]);

    // Dentro de un SUM también (misma lista de tipos admitidos).
    book.sheet(ESCENARIOS).set('D7', { f: `SUM('${DATOS}'!C24:C25)`, v: 1050 });
    expect(issuesWith(previewOf(parseBook(book)), 'TYPE_SIGNAL_MISMATCH')).toEqual([]);

    // Una meta (`goal`, fila 19, en €) en Pago puntual sigue avisando.
    book.sheet(ESCENARIOS).set('D7', { f: dataRef('C', DATA_ROW.goalTarget), v: 3000 });
    expectIssue(parseBook(book), 'TYPE_SIGNAL_MISMATCH', {
      sheet: ESCENARIOS,
      cell: 'D7',
      severity: 'warning',
    });
    // `one_off_payment` no se admite en Extra mensual (C): ahí se espera scenario, expense o income.
    const extra = buildValidWorkbook();
    extra.sheet(ESCENARIOS).set('C7', { f: dataRef('C', DATA_ROW.carInsurance), v: 450 });
    expectIssue(parseBook(extra), 'TYPE_SIGNAL_MISMATCH', { sheet: ESCENARIOS, cell: 'C7' });
  });

  it('§7: el multiplicador en meses de un PRODUCT2 de Eventos admite assumption; otro tipo avisa', () => {
    const book = buildValidWorkbook();
    // Fila 27: «Plazo del préstamo», en meses, tipo `assumption`.
    const accepted = previewOf(parseBook(book));
    expect(accepted.extracted.items.find((item) => item.sourceRow === 27)).toMatchObject({
      unit: 'months',
      recordType: 'assumption',
    });
    expect(accepted.extracted.events[4]).toMatchObject({
      amountItemRow: 26,
      multiplierItemRow: 27,
    });
    expect(
      issuesWith(accepted, 'TYPE_SIGNAL_MISMATCH').filter((issue) => issue.cell === 'C10'),
    ).toEqual([]);

    // El mismo plazo marcado como «Histórico»: aviso (no reclasifica ni bloquea).
    book.sheet(DATOS).set('I27', 'Histórico');
    const warned = previewOf(parseBook(book));
    expectIssue(warned, 'TYPE_SIGNAL_MISMATCH', {
      sheet: EVENTOS,
      cell: 'C10',
      severity: 'warning',
    });
    expect(warned.extracted.events[4]?.multiplierItemRow).toBe(27);
  });

  it('los escenarios no filtran por estado: incluyen filas Potencial (lo que hoy no está en la base)', () => {
    const { scenarios } = extractedOf();
    expect(scenarios[1]?.extraMonthlyRows).toEqual([22]);
    expect(extractedOf().items.find((item) => item.sourceRow === 22)?.status).toBe('potential');
  });

  it('Metas: el objetivo del fondo de emergencia que menciona otra fila de Datos avisa', () => {
    const book = buildValidWorkbook();
    book.sheet(METAS).set('B7', { f: `SUM(Presupuesto!E6:E8)*'${DATOS}'!$C$19`, v: 1 });
    expectIssue(parseBook(book), 'TYPE_SIGNAL_MISMATCH', {
      sheet: METAS,
      cell: 'B7',
      severity: 'warning',
    });
  });

  it('Metas: una referencia a una fila con otra unidad es error; un literal negativo, AMOUNT_NEGATIVE', () => {
    const book = buildValidWorkbook();
    book.sheet(METAS).set('E6', { f: dataRef('C', DATA_ROW.goalTarget), v: 3000 });
    expectIssue(parseBook(book), 'REF_UNIT_MISMATCH', {
      sheet: METAS,
      cell: 'E6',
      severity: 'error',
    });
    const negative = buildValidWorkbook();
    negative.sheet(METAS).set('C6', -1);
    expectIssue(parseBook(negative), 'AMOUNT_NEGATIVE', { sheet: METAS, cell: 'C6' });
  });

  it('Metas: dos metas de fondo de emergencia no son admisibles', () => {
    const book = buildValidWorkbook();
    book.sheet(METAS).set('I8', 'Fondo de emergencia');
    expectIssue(parseBook(book), 'VALUE_NOT_IN_LIST', { sheet: METAS, cell: 'I8' });
  });

  it('los literales distintos de 0 en una columna calculada avisan; las fórmulas y los 0 no', () => {
    const book = buildValidWorkbook();
    book.sheet(PRESUPUESTO).set('G6', 0.5).set('F7', 0);
    book.sheet(METAS).set('D6', 100);
    book.sheet(ESCENARIOS).set('H6', 'Texto escrito a mano');
    const outcome = previewOf(parseBook(book));
    expect(
      issuesWith(outcome, 'VALUE_IN_CALCULATED_COLUMN').map(
        (issue) => `${issue.sheet ?? ''}!${issue.cell ?? ''}`,
      ),
    ).toEqual(['Presupuesto!G6', 'Presupuesto!F10', 'Metas!D6', 'Escenarios!H6']);
  });

  it('Presupuesto: Mensual con una fórmula a otra hoja es REF_UNSUPPORTED', () => {
    const book = buildValidWorkbook();
    book.sheet(PRESUPUESTO).set('E12', { f: 'Metas!B6', v: 1 });
    expectIssue(parseBook(book), 'REF_UNSUPPORTED', { sheet: PRESUPUESTO, cell: 'E12' });
  });

  it('el importe y el estado de una línea se leen de Datos, no se copian: el valor en caché de Presupuesto no cuenta', () => {
    const book = buildValidWorkbook();
    book.sheet(PRESUPUESTO).set('E12', { f: dataRef('C', DATA_ROW.loanInstallment), v: 99_999 });
    const json = JSON.stringify(previewOf(parseBook(book)).extracted.budgetLines);
    expect(json).not.toContain('99999');
  });
});

describe('estructura del libro (nivel 2)', () => {
  it('una plantilla v1 (sin las tres cabeceras nuevas) indica qué paso de §14 falta', () => {
    const book = buildValidWorkbook();
    book.sheet(DATOS).clear('I5');
    book.sheet(EVENTOS).set('G5', 'Impacto base');
    book.sheet(METAS).clear('I5');
    const outcome = parseBook(book);
    expect(outcome.stage).toBe('failed');
    const versions = issuesWith(outcome, 'TEMPLATE_VERSION_UNSUPPORTED');
    expect(versions.map((issue) => issue.cell)).toEqual(['I5', 'G5', 'I5']);
    expect(versions[0]?.message).toContain('§14 paso 1');
    expect(versions[1]?.message).toContain('§14 paso 3');
    expect(versions[2]?.message).toContain('§14 paso 5');
    if (outcome.stage === 'failed') expect(outcome.templateVersion).toBeNull();
    // Las cabeceras de la versión no se repiten como HEADER_MISMATCH.
    expect(issuesWith(outcome, 'HEADER_MISMATCH')).toEqual([]);
  });

  it('se recogen todos los problemas de estructura, no solo el primero', () => {
    const book = buildValidWorkbook();
    book.removeSheet(CHECKS);
    book.sheet(DATOS).set('B5', 'Otra');
    book.sheet(EVENTOS).set('A5', 'Otra');
    const outcome = parseBook(book);
    expect(outcome.stage).toBe('failed');
    expect(outcome.issues.map((issue) => issue.code).sort()).toEqual([
      'HEADER_MISMATCH',
      'HEADER_MISMATCH',
      'SHEET_MISSING',
    ]);
  });

  it('un lote fallido no extrae nada y no calcula hash de contenido', () => {
    const book = buildValidWorkbook();
    book.removeSheet(DATOS);
    const outcome = parseBook(book);
    expect(outcome.stage).toBe('failed');
    expect('extracted' in outcome).toBe(false);
  });
});

describe('seguridad del archivo', () => {
  it('un XML con DTD y entidades (XXE, billion laughs) en una hoja se rechaza sin expandir nada', () => {
    const book = buildValidWorkbook();
    const files = book.files().map((file) =>
      file.name === 'xl/sharedStrings.xml'
        ? {
            ...file,
            data: Buffer.from(
              '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><sst><si><t>&b;</t></si></sst>',
            ),
          }
        : file,
    );
    const outcome = parseBytes(buildZip(files));
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_NOT_OOXML');
  });

  it('una hoja con un XML mal formado se rechaza como archivo no válido', () => {
    const book = buildValidWorkbook();
    const files = book
      .files()
      .map((file) =>
        file.name === 'xl/worksheets/sheet1.xml'
          ? { ...file, data: Buffer.from('<worksheet><sheetData>') }
          : file,
      );
    const outcome = parseBytes(buildZip(files));
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_NOT_OOXML');
  });

  it('una hoja que descomprime más de lo permitido se corta con FILE_ZIP_LIMITS (zip bomb sintético)', () => {
    const book = buildValidWorkbook();
    // 60 MB de espacios dentro de la hoja: pocos KB comprimidos, declarados con honestidad.
    const files = book
      .files()
      .map((file) =>
        file.name === 'xl/worksheets/sheet1.xml'
          ? { ...file, data: Buffer.concat([file.data, Buffer.alloc(60 * 1024 * 1024, 0x20)]) }
          : file,
      );
    const zip = buildZip(files);
    expect(zip.length).toBeLessThan(5 * 1024 * 1024);
    const outcome = parseBytes(zip);
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_ZIP_LIMITS');
  });

  it('una hoja con demasiadas celdas se rechaza con FILE_ZIP_LIMITS', () => {
    const book = buildValidWorkbook();
    const sheet = book.sheet(DATOS);
    for (let row = 1000; row < 1000 + 1001; row += 1) {
      for (let col = 0; col < 100; col += 1)
        sheet.set(
          `${String.fromCharCode(65 + (col % 26))}${String(col < 26 ? row : row + 2000 * Math.floor(col / 26))}`,
          'x',
        );
    }
    expect(sheet.cells.size).toBeGreaterThan(100_000);
    const outcome = parseBook(book);
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_ZIP_LIMITS');
  });

  it('un archivo con la extensión .xlsm y sin macros se acepta', () => {
    expect(parseBook(buildValidWorkbook(), { fileName: 'plan.XLSM' }).stage).toBe('preview');
  });

  it('el archivo cuyo tipo real no es OOXML se rechaza aunque se llame .xlsx (se decide por el contenido)', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(100),
    ]);
    const outcome = parseBytes(png, { fileName: 'plan.xlsx' });
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_NOT_OOXML');
    // Un ZIP cualquiera (sin workbook.xml) tampoco es un libro.
    const zip = buildZip([{ name: 'leeme.txt', data: Buffer.from('hola') }]);
    expectIssue(parseBytes(zip), 'FILE_NOT_OOXML');
  });

  it('la extensión incorrecta se rechaza aunque el contenido sea un libro válido', () => {
    const outcome = parseBook(buildValidWorkbook(), { fileName: 'plan.csv' });
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_NOT_OOXML');
  });

  it('se recogen todos los problemas del archivo cuando son independientes (macros y vínculos)', () => {
    const book = buildValidWorkbook();
    book.extraFiles.push(
      { name: 'xl/vbaProject.bin', data: Buffer.from('m') },
      { name: 'xl/externalLinks/externalLink1.xml', data: Buffer.from('<a/>') },
    );
    const outcome = parseBook(book);
    expect(outcome.issues.map((issue) => issue.code).sort()).toEqual([
      'FILE_EXTERNAL_LINKS',
      'FILE_HAS_MACROS',
    ]);
  });
});

describe('hash de contenido (idempotencia, §3.6)', () => {
  const hashOf = (book: WorkbookBuilder, resolver = resolveAll): string =>
    previewOf(parseBook(book, { resolveCategory: resolver })).contentHash.toString('hex');

  it('el mismo contenido da el mismo hash aunque cambien los bytes del archivo', () => {
    const a = buildValidWorkbook();
    const b = buildValidWorkbook();
    // Metadatos y comentarios distintos: bytes distintos, mismo contenido.
    b.extraFiles.push({
      name: 'docProps/app.xml',
      data: Buffer.from('<Properties>otra cosa</Properties>'),
    });
    b.sheet(PRESUPUESTO).set('A21', 'Otra nota al pie distinta');
    expect(a.toBuffer().equals(b.toBuffer())).toBe(false);
    expect(hashOf(a)).toBe(hashOf(b));
    // Y los valores en caché de las celdas calculadas tampoco cuentan.
    const c = buildValidWorkbook();
    c.sheet(PRESUPUESTO).set('F6', { f: 'E6*12', v: 1, shared: { si: 1, ref: 'F6:F11' } });
    expect(hashOf(a)).toBe(hashOf(c));
  });

  it('un cambio en cualquier entrada cambia el hash', () => {
    const base = hashOf(buildValidWorkbook());
    const variants: ((book: WorkbookBuilder) => void)[] = [
      (book) => book.sheet(DATOS).set('C8', 801),
      (book) => book.sheet(DATOS).set('B8', 'Alquiler del piso'),
      (book) => book.sheet(EVENTOS).set('F9', 'Sí'),
      (book) => book.sheet(METAS).set('H6', 'Otro criterio'),
      (book) => book.sheet(ESCENARIOS).set('C6', { f: dataRef('C', 22), v: 80 }),
    ];
    for (const mutate of variants) {
      const book = buildValidWorkbook();
      mutate(book);
      expect(hashOf(book)).not.toBe(base);
    }
  });

  it('la correspondencia de categorías es una decisión, no contenido: no cambia el hash', () => {
    expect(hashOf(buildValidWorkbook())).toBe(hashOf(buildValidWorkbook(), () => undefined));
  });

  it('los textos libres se normalizan antes de calcular el hash (espacios en los extremos)', () => {
    const a = buildValidWorkbook();
    const b = buildValidWorkbook();
    b.sheet(DATOS).set('B8', '  Alquiler  ');
    expect(hashOf(a)).toBe(hashOf(b));
  });
});

describe('categorías (§8)', () => {
  it('cada línea sin correspondencia es un error que bloquea la confirmación, con su celda', () => {
    const outcome = previewOf(
      parseBook(buildValidWorkbook(), { resolveCategory: () => undefined }),
    );
    expect(issuesWith(outcome, 'CATEGORY_UNMAPPED').map((issue) => issue.cell)).toEqual([
      'A6',
      'A7',
      'A8',
      'A9',
      'A10',
      'A11',
      'A12',
    ]);
    expect(outcome.extracted.budgetLines.every((line) => line.categoryId === null)).toBe(true);
  });

  it('la comparación usa el nombre normalizado (mayúsculas y acentos)', () => {
    const book = buildValidWorkbook();
    book.sheet(PRESUPUESTO).set('A8', '  ALIMENTACION ');
    const outcome = previewOf(parseBook(book));
    expect(issuesWith(outcome, 'CATEGORY_UNMAPPED')).toEqual([]);
    expect(outcome.extracted.budgetLines[2]?.categoryKey).toBe('alimentacion');
  });
});

describe('límites defensivos', () => {
  it('un archivo con miles de problemas no llena la base de datos: se corta con FILE_ZIP_LIMITS', () => {
    const book = buildValidWorkbook();
    for (let row = 6; row < 6 + 2500; row += 1) {
      book
        .sheet(DATOS)
        .row(row, [
          'g',
          'c',
          'texto',
          'EUR',
          'Recurrente',
          'Confirmado',
          undefined,
          undefined,
          'Gasto',
        ]);
    }
    const outcome = parseBook(book);
    expect(outcome.stage).toBe('rejected');
    expectIssue(outcome, 'FILE_ZIP_LIMITS');
  });
});
