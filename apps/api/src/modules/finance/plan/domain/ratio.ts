/**
 * Porcentajes sin coma flotante (docs/plantilla-excel.md §9: «los porcentajes se comparan con aritmética
 * entera y solo se redondean al mostrarlos»).
 *
 * Forma elegida: una **fracción entera sin reducir** `{ numerator, denominator }`. Es exacta, no depende de
 * cuántos decimales se quieran mostrar, se compara con otra cantidad sin dividir (ver
 * {@link comparePercent}) y la capa de presentación puede formatearla después con el redondeo que prefiera.
 * Un `float` guardado (0,4911…) perdería esa exactitud y haría que `20 %` exacto dependiera del error de
 * redondeo.
 */

/** Fracción entera `numerator / denominator` con `denominator > 0`. El numerador puede ser negativo. */
export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
}

/**
 * Construye la fracción `numerator / denominator`, o `null` si el denominador es 0 (por ejemplo, ingresos
 * 0: la tasa de ahorro es «sin ingresos», no un número).
 *
 * @throws {RangeError} si algún argumento no es un entero seguro o el denominador es negativo.
 */
export function ratio(numerator: number, denominator: number): Ratio | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator < 0) {
    throw new RangeError(
      `Fracción no válida: ${String(numerator)}/${String(denominator)} (enteros seguros y denominador ≥ 0)`,
    );
  }
  return denominator === 0 ? null : { numerator, denominator };
}

/**
 * Compara `numerator / denominator` con un porcentaje entero sin dividir: devuelve el signo (−1, 0, 1) de
 * `numerator × 100 − percent × denominator`. Con `BigInt`, así que no hay desbordamiento.
 *
 * Ejemplo: `comparePercent(20, 100, 20)` es 0 (un 20 % exacto), no «un poco menos» por culpa de un redondeo.
 *
 * @param percent Umbral en porcentaje, entero (p. ej., 20 o 40).
 * @param denominator Entero seguro > 0.
 * @throws {RangeError} si algún argumento no es un entero seguro o el denominador no es positivo.
 */
export function comparePercent(
  numerator: number,
  denominator: number,
  percent: number,
): -1 | 0 | 1 {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    !Number.isSafeInteger(percent) ||
    denominator <= 0
  ) {
    throw new RangeError(
      `Comparación no válida: ${String(numerator)}/${String(denominator)} con ${String(percent)} %`,
    );
  }
  const left = BigInt(numerator) * 100n;
  const right = BigInt(percent) * BigInt(denominator);
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
