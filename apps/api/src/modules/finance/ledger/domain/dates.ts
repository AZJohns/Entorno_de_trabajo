/**
 * Fechas contables del libro: un día del calendario sin hora ni zona (`YYYY-MM-DD`, como el `date` de
 * PostgreSQL). Funciones puras sobre texto: no usan `Date`, para que el resultado no dependa de la zona
 * horaria del servidor. Con este formato, comparar cadenas equivale a comparar fechas.
 */

/** Día del calendario en formato `YYYY-MM-DD`. */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Días de cada mes en un año no bisiesto. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Indica si el texto es una fecha real del calendario (rechaza `2026-02-30` y `2026-13-01`).
 * Los años van de 0001 a 9999.
 */
export function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = (DAYS_IN_MONTH[month - 1] ?? 0) + (month === 2 && isLeapYear(year) ? 1 : 0);
  return day <= days;
}

/** Indica si `date` pertenece al mes que empieza en `month` (un `YYYY-MM-01`). */
export function isInMonth(date: LocalDate, month: LocalDate): boolean {
  return date.slice(0, 7) === month.slice(0, 7);
}

/** @throws {RangeError} si el texto no es una fecha válida. */
export function assertLocalDate(value: string): void {
  if (!isLocalDate(value)) throw new RangeError(`Fecha no válida: ${value}`);
}

/** Mes natural como `YYYY-MM`. */
export type YearMonth = string;

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/u;

/** @throws {RangeError} si el texto no es un mes `YYYY-MM` válido (año 0001-9999). */
export function assertYearMonth(value: string): void {
  const match = YEAR_MONTH.exec(value);
  if (match === null || Number(match[1]) < 1) throw new RangeError(`Mes no válido: ${value}`);
}

/** Último día del mes (`2028-02` → `2028-02-29`). Sin `Date`: no depende de la zona horaria. */
export function lastDayOfMonth(month: YearMonth): LocalDate {
  assertYearMonth(month);
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const days = (DAYS_IN_MONTH[index] ?? 0) + (index === 1 && isLeapYear(year) ? 1 : 0);
  return `${month}-${String(days).padStart(2, '0')}`;
}

/**
 * Todos los meses de `from` a `to`, ambos incluidos y en orden. Si `from` es posterior a `to`, la lista
 * va vacía: decidir si eso es un error es cosa de quien llama.
 */
export function monthsBetween(from: YearMonth, to: YearMonth): YearMonth[] {
  assertYearMonth(from);
  assertYearMonth(to);
  const months: YearMonth[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Mes natural anterior (`2026-01` → `2025-12`), o `null` para `0001-01`: antes no hay año válido.
 *
 * @throws {RangeError} si el texto no es un mes válido.
 */
export function previousMonth(month: YearMonth): YearMonth | null {
  assertYearMonth(month);
  const year = Number(month.slice(0, 4));
  const value = Number(month.slice(5, 7));
  if (value > 1) return `${month.slice(0, 5)}${String(value - 1).padStart(2, '0')}`;
  return year > 1 ? `${String(year - 1).padStart(4, '0')}-12` : null;
}
