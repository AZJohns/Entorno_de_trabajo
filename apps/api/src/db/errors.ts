/**
 * Clasificación de errores de PostgreSQL que la aplicación traduce a respuestas de la API.
 */

/**
 * Códigos SQLSTATE con los que PostgreSQL rechaza borrar (o cambiar la clave de) una fila a la que
 * todavía apunta otra, con `ON DELETE RESTRICT`.
 *
 * - `23503` (`foreign_key_violation`): PostgreSQL hasta la 17, y siempre con `NO ACTION`.
 * - `23001` (`restrict_violation`): PostgreSQL 18 con `ON DELETE RESTRICT`. No aparece en las notas de la
 *   versión; se observó en la CI (PostgreSQL 18 devolvía 23001 donde la 17 y la 16 devolvían 23503).
 *
 * Es el único sitio donde se listan: nadie debe comparar el código a mano.
 */
export const REFERENCED_ROW_ERROR_CODES: readonly string[] = ['23001', '23503'];

/**
 * Indica si el error es PostgreSQL rechazando borrar una fila que otras filas todavía referencian.
 *
 * Úsese solo en las rutas de borrado y archivado: `23503` también es el código de un `INSERT` que apunta
 * a una fila inexistente, y esta función no distingue los dos casos.
 *
 * @param constraint Si se indica, además exige que la restricción violada sea esa (p. ej.
 *   `movements_account_id_fkey`), para no confundir una FK con otra.
 */
export function isReferencedRowError(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  if (typeof code !== 'string' || !REFERENCED_ROW_ERROR_CODES.includes(code)) return false;
  return constraint === undefined || violated === constraint;
}

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Indica si el error es PostgreSQL rechazando una fila duplicada.
 *
 * @param constraint Si se indica, exige además que la restricción violada sea esa (el nombre del índice
 *   o de la restricción única), para no confundir un duplicado con otro.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && (constraint === undefined || violated === constraint);
}
