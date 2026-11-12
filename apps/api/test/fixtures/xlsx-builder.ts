/**
 * Constructor de archivos `.xlsx` FICTICIOS para los tests (docs/plantilla-excel.md §12).
 *
 * Escribe OOXML a mano (ZIP + XML) con lo mínimo que lee el importador: cadenas compartidas, fórmulas con su
 * valor en caché, fórmulas compartidas, fechas con formato de fecha, el sistema 1904 y un comentario de
 * celda. NUNCA se parte de un archivo real. No lo escribe Excel: la fixture guardada por Excel (pendiente,
 * ver docs/guia-fixture-excel.md) tiene que pasar además la comprobación de fórmulas compartidas reales.
 */
import { crc32, deflateRawSync } from 'node:zlib';
import { columnNumber } from '../../src/modules/imports/domain/formula.ts';

// --- ZIP -------------------------------------------------------------------------------------------

export interface ZipFileSpec {
  readonly name: string;
  readonly data: Buffer;
  /** `store` (sin comprimir) o `deflate`. Por defecto, `deflate`. */
  readonly method?: 'store' | 'deflate';
  /** Para fabricar un ZIP que miente sobre su tamaño descomprimido. */
  readonly declaredUncompressedSize?: number;
  /** Para fabricar un ZIP con el CRC-32 incorrecto. */
  readonly crc?: number;
}

/** Marca de tiempo MS-DOS fija (1980-01-01 00:00): el archivo no depende de la hora de generación. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** Crea un ZIP en memoria. */
export function buildZip(files: readonly ZipFileSpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const method = file.method === 'store' ? 0 : 8;
    const body = method === 0 ? file.data : deflateRawSync(file.data);
    const crc = file.crc ?? crc32(file.data);
    const uncompressed = file.declaredUncompressedSize ?? file.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// --- libro -----------------------------------------------------------------------------------------

/** Valor de una celda. */
type Scalar = string | number | boolean;

export type CellSpec =
  | Scalar
  /** Fecha como texto ISO: se guarda como número de serie con formato de fecha. */
  | { readonly date: string; readonly customFormat?: boolean }
  /** Fórmula con su valor en caché; si es la maestra de una fórmula compartida, `shared` la identifica. */
  | {
      readonly f: string;
      readonly v?: Scalar;
      readonly shared?: { readonly si: number; readonly ref: string };
    }
  /** Celda dependiente de una fórmula compartida (`<f t="shared" si="n"/>`). */
  | { readonly sharedSi: number; readonly v?: Scalar }
  /** Texto en línea (`inlineStr`) en vez de cadena compartida. */
  | { readonly inline: string }
  /** Valor de error (`#REF!`). */
  | { readonly err: string }
  /** Número sin formato de fecha pero con un estilo cualquiera (para comprobar que no cuenta como fecha). */
  | { readonly number: number };

/** Hoja en construcción: las celdas por referencia A1. */
export class SheetBuilder {
  readonly cells = new Map<string, CellSpec>();
  /** Mutable: los tests renombran hojas (mayúsculas, acentos). */
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  set(ref: string, value: CellSpec): this {
    this.cells.set(ref, value);
    return this;
  }

  /** Escribe una fila de valores desde la columna A. */
  row(row: number, values: readonly (CellSpec | undefined)[]): this {
    values.forEach((value, index) => {
      if (value !== undefined)
        this.cells.set(`${String.fromCharCode(65 + index)}${String(row)}`, value);
    });
    return this;
  }

  clear(ref: string): this {
    this.cells.delete(ref);
    return this;
  }

  /** Vacía una fila entera. */
  clearRow(row: number): this {
    for (const ref of [...this.cells.keys()]) {
      if (Number(/\d+$/u.exec(ref)?.[0]) === row) this.cells.delete(ref);
    }
    return this;
  }
}

export class WorkbookBuilder {
  date1904 = false;
  readonly sheets: SheetBuilder[] = [];
  /** Partes extra del ZIP (macros, vínculos, comentarios…). */
  readonly extraFiles: ZipFileSpec[] = [];
  /** Entradas que se quitan del ZIP generado (por nombre). */
  readonly omit = new Set<string>();

  sheet(name: string): SheetBuilder {
    const found = this.sheets.find((sheet) => sheet.name === name);
    if (found === undefined) throw new Error(`No existe la hoja ${name}`);
    return found;
  }

  addSheet(name: string): SheetBuilder {
    const sheet = new SheetBuilder(name);
    this.sheets.push(sheet);
    return sheet;
  }

  removeSheet(name: string): this {
    const index = this.sheets.findIndex((sheet) => sheet.name === name);
    if (index !== -1) this.sheets.splice(index, 1);
    return this;
  }

  /** Copia profunda: las variantes con errores se hacen a partir de una copia del libro válido. */
  clone(): WorkbookBuilder {
    const copy = new WorkbookBuilder();
    copy.date1904 = this.date1904;
    for (const sheet of this.sheets) {
      const next = copy.addSheet(sheet.name);
      for (const [ref, cell] of sheet.cells) next.cells.set(ref, structuredClone(cell));
    }
    copy.extraFiles.push(...this.extraFiles);
    return copy;
  }

  /** Los archivos del ZIP, sin empaquetar (para los tests que fabrican ZIP hostiles). */
  files(): ZipFileSpec[] {
    return buildFiles(this).filter((file) => !this.omit.has(file.name));
  }

  toBuffer(): Buffer {
    return buildZip(this.files());
  }
}

// --- XML ---------------------------------------------------------------------------------------------

const escapeXml = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

/** Número de serie de Excel de una fecha ISO. */
export function isoToSerial(iso: string, date1904: boolean): number {
  const ms = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return Math.round((ms - epoch) / 86_400_000);
}

/** Estilos: 0 normal, 1 fecha integrada (14), 2 fecha personalizada (aaaa-mm-dd), 3 número con formato `0.00`. */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

interface Built {
  readonly xml: string;
}

function cellXml(
  ref: string,
  spec: CellSpec,
  strings: { index(text: string): number },
  date1904: boolean,
): string {
  const open = (extra = ''): string => `<c r="${ref}"${extra}`;
  const valueOf = (v: Scalar | undefined): { type: string; inner: string } | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === 'number') return { type: '', inner: `<v>${String(v)}</v>` };
    if (typeof v === 'boolean') return { type: ' t="b"', inner: `<v>${v ? '1' : '0'}</v>` };
    return { type: ' t="str"', inner: `<v>${escapeXml(v)}</v>` };
  };
  if (typeof spec === 'string')
    return `${open(' t="s"')}><v>${String(strings.index(spec))}</v></c>`;
  if (typeof spec === 'number') return `${open()}><v>${String(spec)}</v></c>`;
  if (typeof spec === 'boolean') return `${open(' t="b"')}><v>${spec ? '1' : '0'}</v></c>`;
  if ('date' in spec) {
    const style = spec.customFormat === true ? 2 : 1;
    return `${open(` s="${String(style)}"`)}><v>${String(isoToSerial(spec.date, date1904))}</v></c>`;
  }
  if ('number' in spec) return `${open(' s="3"')}><v>${String(spec.number)}</v></c>`;
  if ('inline' in spec)
    return `${open(' t="inlineStr"')}><is><t xml:space="preserve">${escapeXml(spec.inline)}</t></is></c>`;
  if ('err' in spec) return `${open(' t="e"')}><v>${escapeXml(spec.err)}</v></c>`;
  if ('sharedSi' in spec) {
    const cached = valueOf(spec.v);
    return `${open(cached?.type ?? '')}><f t="shared" si="${String(spec.sharedSi)}"/>${cached?.inner ?? ''}</c>`;
  }
  const cached = valueOf(spec.v);
  const shared =
    spec.shared === undefined
      ? ''
      : ` t="shared" ref="${spec.shared.ref}" si="${String(spec.shared.si)}"`;
  return `${open(cached?.type ?? '')}><f${shared}>${escapeXml(spec.f)}</f>${cached?.inner ?? ''}</c>`;
}

function sheetXml(
  sheet: SheetBuilder,
  strings: { index(text: string): number },
  date1904: boolean,
): Built {
  const rows = new Map<number, { col: number; ref: string; spec: CellSpec }[]>();
  for (const [ref, spec] of sheet.cells) {
    const match = /^([A-Z]+)([0-9]+)$/u.exec(ref);
    if (match === null) throw new Error(`Referencia no válida: ${ref}`);
    const row = Number(match[2]);
    const list = rows.get(row) ?? [];
    list.push({ col: columnNumber(match[1] ?? ''), ref, spec });
    rows.set(row, list);
  }
  const body = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, cells]) => {
      const inner = cells
        .sort((a, b) => a.col - b.col)
        .map((cell) => cellXml(cell.ref, cell.spec, strings, date1904))
        .join('');
      return `<row r="${String(row)}">${inner}</row>`;
    })
    .join('');
  return {
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
  };
}

function buildFiles(book: WorkbookBuilder): ZipFileSpec[] {
  const table: string[] = [];
  const lookup = new Map<string, number>();
  const strings = {
    index(text: string): number {
      let at = lookup.get(text);
      if (at === undefined) {
        at = table.length;
        table.push(text);
        lookup.set(text, at);
      }
      return at;
    },
  };
  const sheetFiles = book.sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${String(index + 1)}.xml`,
    data: Buffer.from(sheetXml(sheet, strings, book.date1904).xml, 'utf8'),
  }));
  const text = (value: string): Buffer => Buffer.from(value, 'utf8');
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${String(table.length)}" uniqueCount="${String(table.length)}">${table.map((entry) => `<si><t xml:space="preserve">${escapeXml(entry)}</t></si>`).join('')}</sst>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${book.date1904 ? ' date1904="1"' : ''}/><sheets>${book.sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`).join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${book.sheets.map((_sheet, index) => `<Relationship Id="rId${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`).join('')}</Relationships>`;
  // Un paquete OOXML válido declara el tipo de CADA parte (ECMA-376 Parte 2, §10.1.2.2): sin ello,
  // openpyxl no lo abre y LibreOffice lo abre sin textos. Los tipos de las partes extra de los tests
  // hostiles (macros, vínculos, relleno) no se declaran a propósito: no son partes de un libro válido.
  const overrides = [
    [
      '/xl/workbook.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    ],
    ...book.sheets.map((_sheet, index): [string, string] => [
      `/xl/worksheets/sheet${String(index + 1)}.xml`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    ]),
    [
      '/xl/sharedStrings.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
    ],
    ['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ...book.extraFiles
      .filter((file) => /^xl\/comments\d+\.xml$/u.test(file.name))
      .map((file): [string, string] => [
        `/${file.name}`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml',
      ]),
  ];
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`;
  return [
    { name: '[Content_Types].xml', data: text(contentTypes) },
    {
      name: '_rels/.rels',
      data: text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      ),
    },
    { name: 'xl/workbook.xml', data: text(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: text(rels) },
    { name: 'xl/styles.xml', data: text(STYLES_XML) },
    { name: 'xl/sharedStrings.xml', data: text(sharedStrings) },
    ...sheetFiles,
    // Metadatos vacíos (§12: el autor y la empresa se vacían antes de hacer commit).
    {
      name: 'docProps/core.xml',
      data: text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator></dc:creator></cp:coreProperties>',
      ),
    },
    ...book.extraFiles,
  ];
}
