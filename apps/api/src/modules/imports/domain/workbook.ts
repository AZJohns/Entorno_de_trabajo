/**
 * Lector de libros `.xlsx` (OOXML) sobre el ZIP y el XML estrictos de este módulo.
 *
 * Lee de cada celda su valor (o el valor en caché de una fórmula) y el TEXTO de la fórmula; no evalúa
 * nada. Entiende cadenas compartidas, texto en línea, booleanos, errores, el sistema de fechas 1904, los
 * formatos de fecha (por `numFmt`) y las fórmulas compartidas (las expande en cada celda). Ignora los
 * comentarios, los metadatos (`docProps/`) y todo lo que no sea el contenido de las hojas.
 */
import { columnNumber, translateFormula } from './formula.ts';
import { parseXml, decodeOoxmlEscapes, XmlError, type XmlHandler } from './xml.ts';
import { ZipFormatError, ZipLimitError, type ZipArchive } from './zip.ts';

export type CellValue =
  | { readonly kind: 'number'; readonly value: number; readonly isDate: boolean }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'error'; readonly value: string };

/** Una celda con contenido. `value` es `null` si solo tiene fórmula sin valor en caché. */
export interface Cell {
  readonly row: number;
  readonly col: number;
  readonly value: CellValue | null;
  /** Texto de la fórmula (con las compartidas ya expandidas), sin evaluar. */
  readonly formula: string | null;
}

/** Hoja: solo las celdas que tienen valor o fórmula. */
export class Sheet {
  readonly name: string;
  readonly #rows = new Map<number, Map<number, Cell>>();
  #cells = 0;

  constructor(name: string) {
    this.name = name;
  }

  /** @internal */
  set(cell: Cell): void {
    let row = this.#rows.get(cell.row);
    if (row === undefined) {
      row = new Map();
      this.#rows.set(cell.row, row);
    }
    if (!row.has(cell.col)) this.#cells += 1;
    row.set(cell.col, cell);
  }

  get cellCount(): number {
    return this.#cells;
  }

  cell(row: number, col: number): Cell | undefined {
    return this.#rows.get(row)?.get(col);
  }

  /** ¿La celda tiene algo (valor no vacío o fórmula)? Un texto en blanco cuenta como vacío (§4). */
  isBlank(row: number, col: number): boolean {
    const cell = this.cell(row, col);
    if (cell === undefined) return true;
    if (cell.formula !== null) return false;
    if (cell.value === null) return true;
    return cell.value.kind === 'text' && cell.value.value.trim() === '';
  }

  /** Mayor número de fila con alguna celda. */
  get maxRow(): number {
    let max = 0;
    for (const row of this.#rows.keys()) if (row > max) max = row;
    return max;
  }

  /** Columnas con contenido en una fila, ordenadas. */
  columnsOf(row: number): number[] {
    return [...(this.#rows.get(row)?.keys() ?? [])].sort((x, y) => x - y);
  }
}

export interface Workbook {
  readonly date1904: boolean;
  /** Hojas en el orden del libro, con su nombre tal cual. */
  readonly sheetNames: readonly string[];
  /** Lee una hoja por su nombre exacto (la descomprime en ese momento). */
  sheet(name: string): Sheet;
}

/** Límite de celdas con contenido por hoja: defensa contra hojas gigantes (memoria). */
export const MAX_CELLS_PER_SHEET = 100_000;

const BUILTIN_DATE_FORMATS: ReadonlySet<number> = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** ¿Un código de formato personalizado representa una fecha u hora? */
export function isDateFormatCode(code: string): boolean {
  // Se quitan los textos entrecomillados, los escapes y las secciones entre corchetes (colores, locales).
  const stripped = code
    .replace(/"[^"]*"/gu, '')
    .replace(/\\./gu, '')
    .replace(/\[[^\]]*\]/gu, '');
  return /[ymdhs]/iu.test(stripped);
}

function readText(archive: ZipArchive, name: string): string {
  const data = archive.read(name);
  if (data === undefined) throw new ZipFormatError(`Falta ${name}`);
  return data.toString('utf8');
}

function runXml(xml: string, handler: XmlHandler, part: string): void {
  try {
    parseXml(xml, handler);
  } catch (error) {
    if (error instanceof XmlError) throw new ZipFormatError(`${part}: ${error.message}`);
    throw error;
  }
}

/** Ruta de un destino de relaciones (relativo a `xl/`, o absoluto con `/`). */
function resolveTarget(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function parseWorkbookPart(xml: string): {
  date1904: boolean;
  sheets: { name: string; rid: string }[];
} {
  let date1904 = false;
  const sheets: { name: string; rid: string }[] = [];
  runXml(
    xml,
    {
      open(name, attributes) {
        if (name === 'workbookPr') {
          const flag = attributes['date1904'];
          date1904 = flag === '1' || flag === 'true';
        } else if (name === 'sheet') {
          const rid = Object.entries(attributes).find(
            ([key]) => key === 'id' || key.endsWith(':id'),
          );
          const sheetName = attributes['name'];
          if (sheetName !== undefined && rid !== undefined)
            sheets.push({ name: sheetName, rid: rid[1] });
        }
      },
      text() {},
      close() {},
    },
    'workbook.xml',
  );
  return { date1904, sheets };
}

function parseRelationships(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  runXml(
    xml,
    {
      open(name, attributes) {
        const id = attributes['Id'];
        const target = attributes['Target'];
        if (name === 'Relationship' && id !== undefined && target !== undefined) {
          targets.set(id, resolveTarget(target));
        }
      },
      text() {},
      close() {},
    },
    'workbook.xml.rels',
  );
  return targets;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let phoneticDepth = 0;
  runXml(
    xml,
    {
      open(name) {
        if (name === 'si') current = '';
        else if (name === 'rPh') phoneticDepth += 1;
        else if (name === 't' && current !== null && phoneticDepth === 0) inText = true;
      },
      text(text) {
        if (inText && current !== null) current += text;
      },
      close(name) {
        if (name === 't') inText = false;
        else if (name === 'rPh') phoneticDepth -= 1;
        else if (name === 'si' && current !== null) {
          strings.push(decodeOoxmlEscapes(current));
          current = null;
        }
      },
    },
    'sharedStrings.xml',
  );
  return strings;
}

/** Para cada estilo de celda (`cellXfs`), ¿su formato numérico es de fecha? */
function parseDateStyles(xml: string): boolean[] {
  const customFormats = new Map<number, string>();
  const styles: boolean[] = [];
  let inCellXfs = false;
  runXml(
    xml,
    {
      open(name, attributes) {
        if (name === 'numFmt') {
          const id = Number(attributes['numFmtId']);
          const code = attributes['formatCode'];
          if (Number.isInteger(id) && code !== undefined) customFormats.set(id, code);
        } else if (name === 'cellXfs') {
          inCellXfs = true;
        } else if (name === 'xf' && inCellXfs) {
          const id = Number(attributes['numFmtId'] ?? '0');
          const custom = customFormats.get(id);
          styles.push(
            custom === undefined ? BUILTIN_DATE_FORMATS.has(id) : isDateFormatCode(custom),
          );
        }
      },
      text() {},
      close(name) {
        if (name === 'cellXfs') inCellXfs = false;
      },
    },
    'styles.xml',
  );
  return styles;
}

function parseCellRef(ref: string): { row: number; col: number } | undefined {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(ref);
  if (match === null) return undefined;
  return { col: columnNumber(match[1] ?? ''), row: Number(match[2]) };
}

interface SheetContext {
  readonly sharedStrings: readonly string[];
  readonly dateStyles: readonly boolean[];
}

function parseSheetPart(xml: string, name: string, context: SheetContext): Sheet {
  const sheet = new Sheet(name);
  const shared = new Map<string, { text: string; row: number; col: number }>();

  let attrs: Readonly<Record<string, string>> | null = null;
  let formula: { text: string; shared: string | undefined; empty: boolean } | null = null;
  let valueText: string | null = null;
  let inlineText: string | null = null;
  let capture: 'f' | 'v' | 't' | null = null;
  let phoneticDepth = 0;

  const finishCell = (): void => {
    if (attrs === null) return;
    const position = parseCellRef(attrs['r'] ?? '');
    if (position !== undefined) {
      let formulaText: string | null = null;
      if (formula !== null) {
        if (formula.shared !== undefined) {
          if (!formula.empty) {
            shared.set(formula.shared, { text: formula.text, ...position });
            formulaText = formula.text;
          } else {
            const master = shared.get(formula.shared);
            formulaText =
              master === undefined
                ? '#REF!'
                : translateFormula(
                    master.text,
                    position.row - master.row,
                    position.col - master.col,
                  );
          }
        } else if (!formula.empty || formula.text !== '') {
          formulaText = formula.text;
        }
      }
      const value = readValue(attrs, valueText, inlineText, context);
      if (value !== null || formulaText !== null) {
        if (sheet.cellCount >= MAX_CELLS_PER_SHEET) {
          throw new ZipLimitError(`La hoja «${name}» tiene demasiadas celdas`);
        }
        sheet.set({ ...position, value, formula: formulaText });
      }
    }
    attrs = null;
    formula = null;
    valueText = null;
    inlineText = null;
  };

  runXml(
    xml,
    {
      open(element, attributes) {
        if (element === 'c') {
          attrs = attributes;
        } else if (attrs !== null && element === 'f') {
          formula = {
            text: '',
            shared: attributes['t'] === 'shared' ? (attributes['si'] ?? '') : undefined,
            empty: true,
          };
          capture = 'f';
        } else if (attrs !== null && element === 'v') {
          valueText = '';
          capture = 'v';
        } else if (attrs !== null && element === 'is') {
          inlineText = '';
        } else if (element === 'rPh') {
          phoneticDepth += 1;
        } else if (
          attrs !== null &&
          element === 't' &&
          inlineText !== null &&
          phoneticDepth === 0
        ) {
          capture = 't';
        }
      },
      text(text) {
        if (capture === 'f' && formula !== null) {
          formula.text += text;
          formula.empty = formula.text === '';
        } else if (capture === 'v') {
          valueText = (valueText ?? '') + text;
        } else if (capture === 't') {
          inlineText = (inlineText ?? '') + text;
        }
      },
      close(element) {
        if (element === 'f' || element === 'v' || element === 't') capture = null;
        else if (element === 'rPh') phoneticDepth -= 1;
        else if (element === 'c') finishCell();
      },
    },
    name,
  );
  return sheet;
}

/** Valor de una celda según su tipo `t` (`s` cadena compartida, `str` texto, `b`, `e`, `d`, o número). */
function readValue(
  attributes: Readonly<Record<string, string>>,
  valueText: string | null,
  inlineText: string | null,
  context: SheetContext,
): CellValue | null {
  const type = attributes['t'] ?? 'n';
  if (type === 'inlineStr') {
    return inlineText === null ? null : { kind: 'text', value: decodeOoxmlEscapes(inlineText) };
  }
  if (valueText === null) return null;
  switch (type) {
    case 's': {
      const text = context.sharedStrings[Number(valueText)];
      return text === undefined ? null : { kind: 'text', value: text };
    }
    case 'str':
      return { kind: 'text', value: decodeOoxmlEscapes(valueText) };
    case 'b':
      return { kind: 'boolean', value: valueText.trim() === '1' };
    case 'e':
      return { kind: 'error', value: valueText };
    case 'd': {
      // Fecha ISO 8601 guardada como texto con `t="d"`: se trata como texto (el lector de celdas no
      // admite texto como fecha, §4). Excel no la genera.
      return { kind: 'text', value: valueText };
    }
    default: {
      if (valueText.trim() === '') return null;
      const value = Number(valueText);
      if (!Number.isFinite(value)) return { kind: 'error', value: '#NUM!' };
      const style = Number(attributes['s'] ?? '0');
      return { kind: 'number', value, isDate: context.dateStyles[style] === true };
    }
  }
}

/**
 * Abre el libro: lee `workbook.xml`, las relaciones, las cadenas compartidas y los estilos. Las hojas se
 * descomprimen al pedirlas.
 *
 * @throws {ZipFormatError} si falta una parte obligatoria o el XML no es válido.
 */
export function openWorkbook(archive: ZipArchive): Workbook {
  const { date1904, sheets } = parseWorkbookPart(readText(archive, 'xl/workbook.xml'));
  const relationships = archive.has('xl/_rels/workbook.xml.rels')
    ? parseRelationships(readText(archive, 'xl/_rels/workbook.xml.rels'))
    : new Map<string, string>();
  const sharedStrings = archive.has('xl/sharedStrings.xml')
    ? parseSharedStrings(readText(archive, 'xl/sharedStrings.xml'))
    : [];
  const dateStyles = archive.has('xl/styles.xml')
    ? parseDateStyles(readText(archive, 'xl/styles.xml'))
    : [];
  const parts = new Map<string, string>();
  for (const { name, rid } of sheets) {
    const part = relationships.get(rid);
    if (part !== undefined) parts.set(name, part);
  }
  return {
    date1904,
    sheetNames: sheets.map((sheet) => sheet.name),
    sheet(name) {
      const part = parts.get(name);
      if (part === undefined) throw new ZipFormatError(`La hoja «${name}» no tiene contenido`);
      return parseSheetPart(readText(archive, part), name, { sharedStrings, dateStyles });
    },
  };
}

/** Número de serie de Excel → fecha `YYYY-MM-DD` (sin hora), o `undefined` si no es una fecha válida. */
export function serialToIsoDate(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return undefined;
  const days = Math.floor(serial);
  let epochMs: number;
  if (date1904) {
    epochMs = Date.UTC(1904, 0, 1) + days * 86_400_000;
  } else if (days >= 61) {
    epochMs = Date.UTC(1899, 11, 30) + days * 86_400_000;
  } else if (days >= 1 && days <= 59) {
    // Antes del «29 de febrero de 1900» que Excel inventó: el día 1 es el 1900-01-01.
    epochMs = Date.UTC(1899, 11, 31) + days * 86_400_000;
  } else {
    return undefined; // 0 (sin fecha) y 60 (el 29-02-1900 inexistente)
  }
  return new Date(epochMs).toISOString().slice(0, 10);
}
