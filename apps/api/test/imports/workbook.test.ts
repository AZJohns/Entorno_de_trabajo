/**
 * Lector de libros: tipos de celda, fechas (formatos y sistema 1904), cadenas compartidas, texto en línea,
 * fórmulas como texto y expansión de fórmulas compartidas. Nunca se evalúa una fórmula.
 */
import { describe, expect, it } from 'vitest';
import { openZip } from '../../src/modules/imports/domain/zip.ts';
import {
  isDateFormatCode,
  openWorkbook,
  serialToIsoDate,
} from '../../src/modules/imports/domain/workbook.ts';
import { WorkbookBuilder, isoToSerial } from '../fixtures/xlsx-builder.ts';

function read(book: WorkbookBuilder, sheet = 'Hoja') {
  const archive = openZip(book.toBuffer(), { maxEntries: 200, maxUncompressedBytes: 10_000_000 });
  const workbook = openWorkbook(archive);
  return { workbook, sheet: workbook.sheet(sheet) };
}

function newBook(): { book: WorkbookBuilder; sheet: ReturnType<WorkbookBuilder['addSheet']> } {
  const book = new WorkbookBuilder();
  return { book, sheet: book.addSheet('Hoja') };
}

describe('openWorkbook', () => {
  it('lee textos, números, booleanos y errores', () => {
    const { book, sheet } = newBook();
    sheet
      .set('A1', 'texto')
      .set('A2', 12.5)
      .set('A3', true)
      .set('A4', { err: '#REF!' })
      .set('A5', { inline: 'en línea & <b>' })
      .set('A6', 'con _x000D_ escape');
    const out = read(book).sheet;
    expect(out.cell(1, 1)?.value).toEqual({ kind: 'text', value: 'texto' });
    expect(out.cell(2, 1)?.value).toEqual({ kind: 'number', value: 12.5, isDate: false });
    expect(out.cell(3, 1)?.value).toEqual({ kind: 'boolean', value: true });
    expect(out.cell(4, 1)?.value).toEqual({ kind: 'error', value: '#REF!' });
    expect(out.cell(5, 1)?.value).toEqual({ kind: 'text', value: 'en línea & <b>' });
    expect(out.cell(6, 1)?.value).toEqual({ kind: 'text', value: 'con \r escape' });
  });

  it('lee el TEXTO de la fórmula y su valor en caché, sin evaluar nada', () => {
    const { book, sheet } = newBook();
    // El valor en caché (3) NO coincide con lo que daría la fórmula (1+1): se lee tal cual.
    sheet.set('A1', { f: '1+1', v: 3 }).set('A2', { f: 'IF(A1>2,"si","no")', v: 'sí' });
    const out = read(book).sheet;
    expect(out.cell(1, 1)).toMatchObject({ formula: '1+1', value: { kind: 'number', value: 3 } });
    expect(out.cell(2, 1)).toMatchObject({
      formula: 'IF(A1>2,"si","no")',
      value: { kind: 'text', value: 'sí' },
    });
  });

  it('expande las fórmulas compartidas en cada celda dependiente', () => {
    const { book, sheet } = newBook();
    sheet
      .set('B6', { f: `'Datos'!$C8`, v: 1, shared: { si: 0, ref: 'B6:B9' } })
      .set('B7', { sharedSi: 0, v: 2 })
      .set('B8', { sharedSi: 0, v: 3 })
      .set('C6', { f: 'B6*12', v: 12, shared: { si: 1, ref: 'C6:C7' } })
      .set('C7', { sharedSi: 1, v: 24 });
    const out = read(book).sheet;
    expect(out.cell(6, 2)?.formula).toBe(`'Datos'!$C8`);
    expect(out.cell(7, 2)?.formula).toBe(`'Datos'!$C9`);
    expect(out.cell(8, 2)?.formula).toBe(`'Datos'!$C10`);
    expect(out.cell(7, 3)?.formula).toBe('B7*12');
    expect(out.cell(7, 2)?.value).toEqual({ kind: 'number', value: 2, isDate: false });
  });

  it('una dependiente sin maestra queda con #REF! (no coincide con ninguna forma admitida)', () => {
    const { book, sheet } = newBook();
    sheet.set('B7', { sharedSi: 5, v: 2 });
    expect(read(book).sheet.cell(7, 2)?.formula).toBe('#REF!');
  });

  it('detecta las fechas por su formato (integrado o personalizado) y respeta date1904', () => {
    const { book, sheet } = newBook();
    sheet
      .set('A1', { date: '2026-11-15' })
      .set('A2', { date: '2026-11-15', customFormat: true })
      .set('A3', { number: 46_000 })
      .set('A4', 46_000);
    const out = read(book).sheet;
    expect(out.cell(1, 1)?.value).toMatchObject({ isDate: true });
    expect(out.cell(2, 1)?.value).toMatchObject({ isDate: true });
    expect(out.cell(3, 1)?.value).toMatchObject({ isDate: false });
    expect(out.cell(4, 1)?.value).toMatchObject({ isDate: false });

    const book1904 = new WorkbookBuilder();
    book1904.date1904 = true;
    book1904.addSheet('Hoja').set('A1', { date: '2026-11-15' });
    const { workbook, sheet: sheet1904 } = read(book1904);
    expect(workbook.date1904).toBe(true);
    const cell = sheet1904.cell(1, 1);
    expect(cell?.value?.kind === 'number' && serialToIsoDate(cell.value.value, true)).toBe(
      '2026-11-15',
    );
  });

  it('ignora lo que no es una celda con contenido y no descomprime comentarios ni metadatos', () => {
    const { book, sheet } = newBook();
    sheet.set('A1', 'x');
    book.extraFiles.push({ name: 'xl/comments1.xml', data: Buffer.from('<esto no es xml válido') });
    const archive = openZip(book.toBuffer(), { maxEntries: 200, maxUncompressedBytes: 10_000_000 });
    const workbook = openWorkbook(archive);
    workbook.sheet('Hoja');
    // Si se hubiera intentado leer el comentario, XML inválido habría fallado: no se descomprime.
    expect(archive.names()).toContain('xl/comments1.xml');
  });

  it('una celda en blanco con solo espacios cuenta como vacía; una con fórmula, no', () => {
    const { book, sheet } = newBook();
    sheet.set('A1', '   ').set('A2', { f: 'A1', v: '' });
    const out = read(book).sheet;
    expect(out.isBlank(1, 1)).toBe(true);
    expect(out.isBlank(2, 1)).toBe(false);
    expect(out.isBlank(3, 1)).toBe(true);
  });
});

describe('serialToIsoDate', () => {
  it('convierte números de serie de ambos sistemas', () => {
    expect(serialToIsoDate(isoToSerial('2026-11-15', false), false)).toBe('2026-11-15');
    expect(serialToIsoDate(isoToSerial('2026-11-15', true), true)).toBe('2026-11-15');
    expect(serialToIsoDate(44_927.75, false)).toBe('2023-01-01'); // la hora se descarta
    expect(serialToIsoDate(61, false)).toBe('1900-03-01');
    expect(serialToIsoDate(59, false)).toBe('1900-02-28');
  });

  it('rechaza lo que no es una fecha válida', () => {
    expect(serialToIsoDate(0, false)).toBeUndefined();
    expect(serialToIsoDate(60, false)).toBeUndefined(); // el 29-02-1900 no existió
    expect(serialToIsoDate(-3, false)).toBeUndefined();
    expect(serialToIsoDate(3_000_000, false)).toBeUndefined();
    expect(serialToIsoDate(Number.NaN, false)).toBeUndefined();
  });
});

describe('isDateFormatCode', () => {
  it('reconoce formatos de fecha y descarta los numéricos', () => {
    expect(isDateFormatCode('dd/mm/yyyy')).toBe(true);
    expect(isDateFormatCode('yyyy\\-mm\\-dd')).toBe(true);
    expect(isDateFormatCode('[$-F800]dddd, mmmm dd, yyyy')).toBe(true);
    expect(isDateFormatCode('h:mm:ss')).toBe(true);
    expect(isDateFormatCode('0.00')).toBe(false);
    expect(isDateFormatCode('#,##0.00 "€"')).toBe(false);
    expect(isDateFormatCode('0.00 "días"')).toBe(false);
    expect(isDateFormatCode('[Red]0.00')).toBe(false);
  });
});
