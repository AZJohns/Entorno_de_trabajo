/**
 * Fórmulas de las celdas: se leen como TEXTO y nunca se evalúan (docs/plantilla-excel.md §1.3 y §5).
 *
 * - `translateFormula` expande las fórmulas compartidas (`t="shared"`): desplaza las referencias relativas
 *   del texto de la celda maestra. Es manipulación de texto; no interpreta funciones.
 * - `parseFormula` reconoce solo las formas cerradas de §5 (REF, SUMRANGE, PRODUCT2 y ZERO). Cualquier otra
 *   cosa es `unsupported`.
 * - `extractDataReferences` saca las filas de Datos que menciona un texto cualquiera (solo para el aviso
 *   `TYPE_SIGNAL_MISMATCH` de la meta del fondo de emergencia).
 */

/** Referencia a una celda: fila (1-based) y columna (A = 1). */
export interface CellRef {
  readonly row: number;
  readonly col: number;
}

export type ParsedFormula =
  | { readonly form: 'zero' }
  | ({ readonly form: 'ref' } & CellRef)
  | { readonly form: 'sum'; readonly col: number; readonly fromRow: number; readonly toRow: number }
  | { readonly form: 'product'; readonly a: CellRef; readonly b: CellRef }
  | { readonly form: 'unsupported' };

/** Columna en letras → número (A = 1). */
export function columnNumber(letters: string): number {
  let value = 0;
  for (const char of letters.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

/** Número de columna → letras (1 = A). */
export function columnLetters(col: number): string {
  let rest = col;
  let letters = '';
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** Celda en notación A1. */
export function a1(row: number, col: number): string {
  return `${columnLetters(col)}${String(row)}`;
}

/** Última columna y fila de Excel. */
const MAX_COL = 16_384;
const MAX_ROW = 1_048_576;

const REF_PATTERN = /(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]{0,6})/gy;

function isNameChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_.]/u.test(char);
}

/**
 * Desplaza las referencias relativas de un texto de fórmula (`$` fija la fila o la columna). Se saltan los
 * nombres de hoja entre comillas simples y los literales de texto. Si el desplazamiento sale de la hoja,
 * deja `#REF!` (que luego no coincide con ninguna forma admitida).
 */
export function translateFormula(formula: string, deltaRow: number, deltaCol: number): string {
  let out = '';
  let index = 0;
  while (index < formula.length) {
    const char = formula[index] ?? '';
    if (char === "'" || char === '"') {
      // Salta el literal entero; una comilla doblada dentro es un escape.
      let end = index + 1;
      while (end < formula.length) {
        if (formula[end] === char) {
          if (formula[end + 1] === char) {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      out += formula.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    REF_PATTERN.lastIndex = index;
    const match = REF_PATTERN.exec(formula);
    const before = index > 0 ? formula[index - 1] : undefined;
    const after = match === null ? undefined : formula[index + match[0].length];
    if (
      match !== null &&
      !isNameChar(before) &&
      !isNameChar(after) &&
      after !== '(' &&
      after !== '!'
    ) {
      const [whole, colAbs, letters, rowAbs, digits] = match as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];
      const col = colAbs === '$' ? columnNumber(letters) : columnNumber(letters) + deltaCol;
      const row = rowAbs === '$' ? Number(digits) : Number(digits) + deltaRow;
      if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) {
        out += '#REF!';
      } else {
        out += `${colAbs}${columnLetters(col)}${rowAbs}${String(row)}`;
      }
      index += whole.length;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Texto de una hoja para usarlo dentro de una expresión regular. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Prefijo de hoja aceptado: el nombre real de «Datos y supuestos», entre comillas simples. */
function sheetPrefix(dataSheetName: string): string {
  return `'${escapeRegExp(dataSheetName.replaceAll("'", "''"))}'!`;
}

/**
 * Reconoce las formas cerradas de §5. El `=` inicial y los `$` son opcionales. La comparación del nombre
 * de la hoja de Datos ignora mayúsculas.
 *
 * @param dataSheetName Nombre real de la hoja «Datos y supuestos» en el archivo.
 */
export function parseFormula(text: string, dataSheetName: string): ParsedFormula {
  const formula = text.trim().replace(/^=/u, '').trim();
  if (formula === '0') return { form: 'zero' };
  const prefix = sheetPrefix(dataSheetName);
  const cell = `${prefix}\\$?([A-Z]{1,3})\\$?([1-9][0-9]{0,6})`;

  const ref = new RegExp(`^${cell}$`, 'iu').exec(formula);
  if (ref !== null) {
    return { form: 'ref', col: columnNumber(ref[1] ?? ''), row: Number(ref[2]) };
  }

  const sum = new RegExp(
    `^SUM\\(${prefix}\\$?([A-Z]{1,3})\\$?([1-9][0-9]{0,6}):(?:${prefix})?\\$?([A-Z]{1,3})\\$?([1-9][0-9]{0,6})\\)$`,
    'iu',
  ).exec(formula);
  if (sum !== null) {
    const firstCol = columnNumber(sum[1] ?? '');
    // Un rango de varias columnas no es una forma admitida.
    if (firstCol !== columnNumber(sum[3] ?? '')) return { form: 'unsupported' };
    const a = Number(sum[2]);
    const b = Number(sum[4]);
    return { form: 'sum', col: firstCol, fromRow: Math.min(a, b), toRow: Math.max(a, b) };
  }

  const product = new RegExp(`^${cell}\\*${cell}$`, 'iu').exec(formula);
  if (product !== null) {
    return {
      form: 'product',
      a: { col: columnNumber(product[1] ?? ''), row: Number(product[2]) },
      b: { col: columnNumber(product[3] ?? ''), row: Number(product[4]) },
    };
  }
  return { form: 'unsupported' };
}

/**
 * Filas de «Datos y supuestos» que menciona un texto de fórmula, sin evaluarla. Una referencia a la
 * hoja de Datos con un rango cuenta cada extremo.
 */
export function extractDataReferences(text: string, dataSheetName: string): number[] {
  const pattern = new RegExp(
    `${sheetPrefix(dataSheetName)}\\$?[A-Z]{1,3}\\$?([1-9][0-9]{0,6})`,
    'giu',
  );
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}
