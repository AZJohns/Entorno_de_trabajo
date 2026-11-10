/**
 * Fórmulas: nunca se evalúan; solo se expanden las compartidas (texto) y se reconocen las formas cerradas
 * de plantilla-excel.md §5.
 */
import { describe, expect, it } from 'vitest';
import {
  a1,
  columnLetters,
  columnNumber,
  extractDataReferences,
  parseFormula,
  translateFormula,
} from '../../src/modules/imports/domain/formula.ts';

const S = 'Datos y supuestos';

describe('columnas', () => {
  it('convierte letras y números en los dos sentidos', () => {
    expect(columnNumber('A')).toBe(1);
    expect(columnNumber('Z')).toBe(26);
    expect(columnNumber('AA')).toBe(27);
    expect(columnLetters(27)).toBe('AA');
    expect(columnLetters(16384)).toBe('XFD');
    expect(a1(6, 9)).toBe('I6');
  });
});

describe('translateFormula (fórmulas compartidas)', () => {
  it('desplaza las referencias relativas y respeta los `$`', () => {
    expect(translateFormula(`'${S}'!$C8`, 3, 0)).toBe(`'${S}'!$C11`);
    expect(translateFormula(`'${S}'!C$8`, 3, 1)).toBe(`'${S}'!D$8`);
    expect(translateFormula(`'${S}'!$C$8`, 3, 3)).toBe(`'${S}'!$C$8`);
    expect(translateFormula('E6*12', 2, 0)).toBe('E8*12');
    expect(translateFormula(`SUM('${S}'!C20:C23)`, 1, 0)).toBe(`SUM('${S}'!C21:C24)`);
  });

  it('no toca el nombre de la hoja entre comillas, los literales de texto ni los nombres de función', () => {
    expect(translateFormula(`'A1 B2'!C3`, 1, 1)).toBe(`'A1 B2'!D4`);
    expect(translateFormula('"A1"&B2', 1, 0)).toBe('"A1"&B3');
    expect(translateFormula('LOG10(B2)', 1, 0)).toBe('LOG10(B3)');
    expect(translateFormula('Hoja1!A1', 1, 0)).toBe('Hoja1!A2');
  });

  it('una referencia que sale de la hoja pasa a #REF!', () => {
    expect(translateFormula('A1', -1, 0)).toBe('#REF!');
  });
});

describe('parseFormula (formas cerradas)', () => {
  it('REF: referencia directa, con o sin `=` y con o sin `$`', () => {
    expect(parseFormula(`'${S}'!$C$8`, S)).toEqual({ form: 'ref', col: 3, row: 8 });
    expect(parseFormula(`='${S}'!C8`, S)).toEqual({ form: 'ref', col: 3, row: 8 });
    expect(parseFormula(`'datos Y supuestos'!F9`, S)).toEqual({ form: 'ref', col: 6, row: 9 });
  });

  it('SUMRANGE: un solo rango contiguo de una columna', () => {
    expect(parseFormula(`SUM('${S}'!C20:C23)`, S)).toEqual({
      form: 'sum',
      col: 3,
      fromRow: 20,
      toRow: 23,
    });
    expect(parseFormula(`SUM('${S}'!$C$23:$C$20)`, S)).toEqual({
      form: 'sum',
      col: 3,
      fromRow: 20,
      toRow: 23,
    });
    expect(parseFormula(`SUM('${S}'!C20:'${S}'!C23)`, S)).toEqual({
      form: 'sum',
      col: 3,
      fromRow: 20,
      toRow: 23,
    });
  });

  it('PRODUCT2: producto de dos referencias directas', () => {
    expect(parseFormula(`'${S}'!C10*'${S}'!C11`, S)).toEqual({
      form: 'product',
      a: { col: 3, row: 10 },
      b: { col: 3, row: 11 },
    });
  });

  it('ZERO: =0', () => {
    expect(parseFormula('=0', S)).toEqual({ form: 'zero' });
    expect(parseFormula('0', S)).toEqual({ form: 'zero' });
  });

  it.each([
    ['otra función', `AVERAGE('${S}'!C20:C23)`],
    ['suma con una constante', `'${S}'!C8+1`],
    ['producto con una constante', `'${S}'!C8*12`],
    ['producto de tres', `'${S}'!C8*'${S}'!C9*'${S}'!C10`],
    ['rango de varias columnas', `SUM('${S}'!C20:D23)`],
    ['rangos no contiguos', `SUM('${S}'!C20:C21,'${S}'!C23)`],
    ['otra hoja', `Presupuesto!C8`],
    ['otro libro', `[1]Hoja!C8`],
    ['un nombre definido', 'IngresosNetos'],
    ['INDIRECT', `INDIRECT("'${S}'!C8")`],
    ['una referencia sin hoja', 'C8'],
    ['una función con efectos conocidos en Excel', `HYPERLINK("http://ejemplo.invalid","x")`],
    ['un literal distinto de 0', '5'],
    ['resta', `'${S}'!C8-'${S}'!C9`],
    ['una referencia a #REF!', '#REF!'],
  ])('rechaza (unsupported): %s', (_name, formula) => {
    expect(parseFormula(formula, S)).toEqual({ form: 'unsupported' });
  });

  it('usa el nombre real de la hoja de Datos del archivo, escapando las comillas', () => {
    expect(parseFormula(`'Datos y supuestos'!C8`, 'Datos y supuestos').form).toBe('ref');
    expect(parseFormula(`'Mi hoja''s'!C8`, `Mi hoja's`)).toEqual({ form: 'ref', col: 3, row: 8 });
  });
});

describe('extractDataReferences', () => {
  it('saca las filas de Datos que menciona un texto, sin evaluarlo', () => {
    expect(extractDataReferences(`SUM(Presupuesto!E6:E8)*'${S}'!$C$18+'${S}'!C20`, S)).toEqual([
      18, 20,
    ]);
    expect(extractDataReferences('1+1', S)).toEqual([]);
  });
});
