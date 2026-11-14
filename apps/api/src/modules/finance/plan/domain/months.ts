/**
 * Aritmética de meses naturales (`YYYY-MM`) para la proyección. Sobre texto, sin `Date`, para que el
 * resultado no dependa de la zona horaria del servidor (el mes en curso se decide fuera, en Europe/Madrid).
 */
import {
  assertLocalDate,
  assertYearMonth,
  type LocalDate,
  type YearMonth,
} from '../../ledger/domain/dates.ts';

/** Número de meses de la proyección (§9.3). */
export const HORIZON_MONTHS = 12;

function parts(month: YearMonth): { year: number; month: number } {
  assertYearMonth(month);
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

/** `month` desplazado `offset` meses (`2026-11` + 3 = `2027-02`). @throws {RangeError} si sale de 0001-9999. */
export function addMonths(month: YearMonth, offset: number): YearMonth {
  const { year, month: value } = parts(month);
  const total = year * 12 + (value - 1) + offset;
  const newYear = Math.floor(total / 12);
  if (newYear < 1 || newYear > 9999)
    throw new RangeError(`Mes fuera de rango: ${month} + ${String(offset)}`);
  return `${String(newYear).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Posición de la fecha dentro de la proyección que empieza en `firstMonth`: 1 para el propio mes, 12 para
 * el undécimo mes después. `null` si cae antes del mes 1 o después del mes 12.
 *
 * @throws {RangeError} si la fecha o el mes no son válidos.
 */
export function projectionMonthOf(firstMonth: YearMonth, date: LocalDate): number | null {
  assertLocalDate(date);
  const first = parts(firstMonth);
  const target = parts(date.slice(0, 7));
  const index = (target.year - first.year) * 12 + (target.month - first.month) + 1;
  return index >= 1 && index <= HORIZON_MONTHS ? index : null;
}
