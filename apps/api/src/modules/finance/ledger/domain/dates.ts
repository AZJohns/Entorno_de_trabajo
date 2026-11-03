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
