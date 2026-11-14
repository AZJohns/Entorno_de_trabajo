/**
 * Aritmética entera del plan (docs/plantilla-excel.md §9): división con redondeo y fracciones exactas.
 *
 * Nada de coma flotante: ni `Math.round`, ni `Math.ceil`, ni `/` sobre importes. Los productos intermedios
 * (céntimos × centésimas de mes) pueden superar `Number.MAX_SAFE_INTEGER` aunque el resultado no, así que se
 * calculan con `BigInt` y solo el resultado vuelve a `number`, comprobado con `assertCents`.
 */
import { assertCents, type Cents } from '@backoffice/shared';

function assertNonNegativeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} debe ser un entero seguro no negativo: ${String(value)}`);
  }
}

function assertPositiveInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${what} debe ser un entero seguro positivo: ${String(value)}`);
  }
}

/** `n / d` redondeado half-up, con `n ≥ 0` y `d > 0`: `floor(n/d + 1/2)` = `(2n + d) / 2d` en división entera. */
function halfUpBig(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/**
 * División entera con redondeo *half-up*: `numerador / denominador` redondeado al entero más cercano, y los
 * empates (resto exactamente la mitad del divisor) hacia arriba. Es el único redondeo del plan y solo se usa
 * en los productos con meses (§9.4 y §6.3).
 *
 * @param numerator Entero seguro ≥ 0 (los importes del plan son positivos).
 * @param denominator Entero seguro > 0.
 * @throws {RangeError} si algún argumento no es un entero seguro en su rango, o si el resultado no es un importe válido.
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  assertNonNegativeInteger(numerator, 'El numerador');
  assertPositiveInteger(denominator, 'El denominador');
  return assertCents(Number(halfUpBig(BigInt(numerator), BigInt(denominator))));
}

/**
 * Producto `céntimos × centésimas / 100` con redondeo *half-up* al céntimo: el importe de un evento
 * cuota × plazo (§6.3) y el objetivo del fondo de emergencia (§9.4).
 *
 * El producto se calcula en `BigInt` antes de dividir, para no perder exactitud con importes grandes.
 *
 * @param cents Importe en céntimos (≥ 0).
 * @param hundredths Meses en centésimas (6,5 meses = 650), entero ≥ 0.
 * @returns céntimos, redondeados half-up (`x,5` céntimos sube al siguiente).
 * @throws {RangeError} si algún argumento no es entero seguro ≥ 0 o el resultado no cabe en un importe.
 */
export function centsTimesMonths(cents: Cents, hundredths: number): Cents {
  assertNonNegativeInteger(cents, 'El importe');
  assertNonNegativeInteger(hundredths, 'Los meses en centésimas');
  return assertCents(Number(halfUpBig(BigInt(cents) * BigInt(hundredths), 100n)));
}

/**
 * División entera por exceso (`ceil(n / d)`) sin pasar por coma flotante: los meses que hacen falta para
 * reunir un pendiente (§9.4).
 *
 * @param numerator Entero seguro ≥ 0.
 * @param denominator Entero seguro > 0.
 * @throws {RangeError} si algún argumento no es un entero seguro en su rango.
 */
export function ceilDiv(numerator: number, denominator: number): number {
  assertNonNegativeInteger(numerator, 'El numerador');
  assertPositiveInteger(denominator, 'El denominador');
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  return Number((n + d - 1n) / d);
}

/**
 * Suma de importes con comprobación de desbordamiento: cada suma parcial tiene que seguir siendo un entero
 * seguro (`assertCents`), así que no hay pérdida silenciosa de precisión.
 *
 * @throws {RangeError} si algún término o una suma parcial no es un importe válido.
 */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) total = assertCents(total + assertCents(value));
  return total;
}
