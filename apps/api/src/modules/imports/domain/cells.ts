/**
 * Lectura de celdas por tipo (docs/plantilla-excel.md §4). Cada lector devuelve el valor ya convertido o
 * registra el problema correspondiente; nunca lanza por un dato del archivo.
 */
import { YES_NO, type CatalogEntry } from '@backoffice/shared';
import type { IssueCollector } from './issues.ts';
import { normalizeKey, normalizeText } from './normalize.ts';
import { serialToIsoDate, type Cell, type CellValue, type Sheet } from './workbook.ts';

/** Resultado de leer una celda: valor, vacía (no obligatoria) o inválida (el problema ya está registrado). */
export type Read<T> =
  | { readonly state: 'ok'; readonly value: T }
  | { readonly state: 'empty' }
  | { readonly state: 'invalid' };

const EMPTY = { state: 'empty' } as const;
const INVALID = { state: 'invalid' } as const;
const ok = <T>(value: T): Read<T> => ({ state: 'ok', value });

/** Máximo de centésimas de mes (columna `integer` de PostgreSQL). */
const MAX_HUNDREDTHS = 2_147_483_647;
/** Máximo de un importe en céntimos: muy por debajo de `Number.MAX_SAFE_INTEGER`. */
const MAX_CENTS = 1_000_000_000_000_000;
/** Tolerancia de §4 para decidir si un importe tiene más de 2 decimales. */
const PRECISION_EPSILON = 1e-6;

/** Describe el valor de una celda para el campo `found` de un problema (recortado). */
export function describeValue(value: CellValue | null): string {
  if (value === null) return '(sin valor)';
  const text = String(value.value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** Lector de celdas de una hoja con el recolector de problemas y el sistema de fechas del libro. */
export class CellReader {
  readonly sheet: Sheet;
  readonly issues: IssueCollector;
  readonly date1904: boolean;

  constructor(sheet: Sheet, issues: IssueCollector, date1904: boolean) {
    this.sheet = sheet;
    this.issues = issues;
    this.date1904 = date1904;
  }

  /** ¿Está vacía la celda? (sin valor, con solo espacios y sin fórmula) */
  blank(row: number, col: number): boolean {
    return this.sheet.isBlank(row, col);
  }

  /** Contenido de la celda para mostrarlo en un mensaje. */
  found(row: number, col: number): string {
    const cell = this.sheet.cell(row, col);
    if (cell === undefined) return '(vacía)';
    return cell.formula === null ? describeValue(cell.value) : `=${cell.formula}`;
  }

  #required(row: number, col: number, label: string): Read<never> {
    this.issues.add(
      'CELL_REQUIRED',
      this.sheet.name,
      row,
      col,
      `Falta un valor obligatorio: «${label}»`,
    );
    return INVALID;
  }

  /**
   * Prepara una celda que debe ser un literal. Devuelve la celda, o `EMPTY`/`INVALID` si no hay que seguir.
   * Una fórmula en una columna de entrada de literales es `FORMULA_NOT_ALLOWED` (§5).
   */
  #literal(row: number, col: number, label: string, required: boolean): Cell | Read<never> {
    if (this.blank(row, col)) return required ? this.#required(row, col, label) : EMPTY;
    const cell = this.sheet.cell(row, col) as Cell;
    if (cell.formula !== null) {
      this.issues.add(
        'FORMULA_NOT_ALLOWED',
        this.sheet.name,
        row,
        col,
        `«${label}» no admite fórmulas: escribe el valor`,
        { found: `=${cell.formula}` },
      );
      return INVALID;
    }
    return cell;
  }

  #typeError(row: number, col: number, label: string, expected: string, cell: Cell): Read<never> {
    this.issues.add('CELL_TYPE', this.sheet.name, row, col, `«${label}» debe ser ${expected}`, {
      expected,
      found: describeValue(cell.value),
    });
    return INVALID;
  }

  /** Texto libre (§4): los números se convierten a texto; una fecha, a ISO si `dateAsIso`. */
  text(
    row: number,
    col: number,
    label: string,
    options: { required: boolean; dateAsIso?: boolean },
  ): Read<string> {
    const cell = this.#literal(row, col, label, options.required);
    if ('state' in cell) return cell;
    const value = cell.value;
    if (value === null) return EMPTY;
    if (value.kind === 'error') return this.#typeError(row, col, label, 'un texto', cell);
    if (value.kind === 'number' && value.isDate && options.dateAsIso === true) {
      const iso = serialToIsoDate(value.value, this.date1904);
      return iso === undefined
        ? this.#typeError(row, col, label, 'una fecha válida', cell)
        : ok(iso);
    }
    const raw =
      typeof value.value === 'boolean' ? (value.value ? 'Sí' : 'No') : String(value.value);
    const text = normalizeText(raw);
    return text === '' ? EMPTY : ok(text);
  }

  /** Importe en euros → céntimos (§4): numérico, positivo y con 2 decimales como máximo. */
  amount(row: number, col: number, label: string, options: { required: boolean }): Read<number> {
    const cell = this.#literal(row, col, label, options.required);
    if ('state' in cell) return cell;
    return this.numberOf(cell, row, col, label, 'amount');
  }

  /** Meses (§4): numérico ≥ 0 con 2 decimales como máximo → centésimas enteras. */
  months(row: number, col: number, label: string, options: { required: boolean }): Read<number> {
    const cell = this.#literal(row, col, label, options.required);
    if ('state' in cell) return cell;
    return this.numberOf(cell, row, col, label, 'months');
  }

  /** Convierte el valor numérico de una celda ya comprobada (sin fórmula). Importes y meses. */
  numberOf(
    cell: Cell,
    row: number,
    col: number,
    label: string,
    kind: 'amount' | 'months',
  ): Read<number> {
    const expected = kind === 'amount' ? 'un importe en euros (número)' : 'un número de meses';
    const value = cell.value;
    if (value === null) return EMPTY;
    // Un texto como «12,50» o una fecha no son un importe (§4).
    if (value.kind !== 'number' || value.isDate)
      return this.#typeError(row, col, label, expected, cell);
    const scaled = value.value * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > PRECISION_EPSILON) {
      this.issues.add(
        'AMOUNT_PRECISION',
        this.sheet.name,
        row,
        col,
        `«${label}» tiene más de 2 decimales`,
        {
          found: String(value.value),
        },
      );
      return INVALID;
    }
    if (rounded < 0) {
      this.issues.add(
        'AMOUNT_NEGATIVE',
        this.sheet.name,
        row,
        col,
        `«${label}» no puede ser negativo`,
        {
          found: String(value.value),
        },
      );
      return INVALID;
    }
    if (rounded > (kind === 'amount' ? MAX_CENTS : MAX_HUNDREDTHS)) {
      return this.#typeError(row, col, label, `${expected} dentro de rango`, cell);
    }
    return ok(rounded === 0 ? 0 : rounded);
  }

  /** Fecha (§4): número de serie con formato de fecha → `YYYY-MM-DD`. Un texto, aunque parezca fecha, es `CELL_TYPE`. */
  date(row: number, col: number, label: string, options: { required: boolean }): Read<string> {
    const cell = this.#literal(row, col, label, options.required);
    if ('state' in cell) return cell;
    const value = cell.value;
    if (value === null) return EMPTY;
    if (value.kind !== 'number' || !value.isDate) {
      return this.#typeError(row, col, label, 'una fecha (con formato de fecha)', cell);
    }
    const iso = serialToIsoDate(value.value, this.date1904);
    return iso === undefined ? this.#typeError(row, col, label, 'una fecha válida', cell) : ok(iso);
  }

  /** Lista cerrada (§3, §4): compara con la normalización completa. Se acepta «Si» como «Sí». */
  list<C extends string>(
    row: number,
    col: number,
    label: string,
    catalog: readonly CatalogEntry<C>[],
    options: { required: boolean },
  ): Read<C> {
    const cell = this.#literal(row, col, label, options.required);
    if ('state' in cell) return cell;
    const value = cell.value;
    if (value === null) return EMPTY;
    const key = normalizeKey(String(value.value));
    const match = catalog.find((entry) => normalizeKey(entry.label) === key);
    if (match === undefined) {
      this.issues.add(
        'VALUE_NOT_IN_LIST',
        this.sheet.name,
        row,
        col,
        `«${label}»: valor fuera de la lista`,
        {
          expected: catalog.map((entry) => entry.label).join(', '),
          found: describeValue(value),
        },
      );
      return INVALID;
    }
    return ok(match.code);
  }

  /** Sí/No → booleano. */
  yesNo(row: number, col: number, label: string, options: { required: boolean }): Read<boolean> {
    const read = this.list(row, col, label, YES_NO, options);
    return read.state === 'ok' ? ok(read.value === 'yes') : read;
  }
}
