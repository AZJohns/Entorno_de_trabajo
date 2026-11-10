/**
 * Normalización de textos de la plantilla (docs/plantilla-excel.md §3).
 */

/**
 * Clave de comparación para nombres de hoja, cabeceras, etiquetas de resumen, listas cerradas y la
 * categoría de Presupuesto: sin espacios en los extremos, con los espacios repetidos reducidos a uno,
 * en minúsculas y sin diacríticos («Sí» → «si», «Histórico» → «historico»).
 */
export function normalizeKey(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Texto libre: sin espacios en los extremos y en Unicode NFC. Se guarda tal cual, sin más cambios. */
export function normalizeText(text: string): string {
  return text.trim().normalize('NFC');
}
