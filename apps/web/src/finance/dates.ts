/**
 * Fechas contables `YYYY-MM-DD` y meses `YYYY-MM` como texto. No se usa `Date` para formatear ni para
 * comparar: `toISOString` convertiría a UTC y, cerca de medianoche, daría el día anterior o posterior.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Hoy en la zona horaria del navegador, como `YYYY-MM-DD`. */
export function todayLocal(now: Date = new Date()): string {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Mes de una fecha: `2026-10-15` → `2026-10`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** `2026-10-05` → `05/10/2026`. */
export function formatDate(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}/${month}/${year}`;
}

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** `2026-10` → `octubre de 2026`. */
export function formatMonth(month: string): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  return `${name} de ${month.slice(0, 4)}`;
}
