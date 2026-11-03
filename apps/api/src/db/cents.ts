import { assertCents, type Cents } from '@backoffice/shared';

/**
 * Convierte un `bigint` de PostgreSQL (que `pg` entrega como cadena, y `SUM()` también) en céntimos.
 *
 * Es el único sitio donde se hace esta conversión (plan §2.1): no se usa `Number(texto)` con importes
 * porque no comprobaría que el valor sea un entero seguro.
 *
 * @throws {RangeError} si no es un entero decimal o queda fuera del rango seguro de JavaScript
 *   (± 9.007.199.254.740.991 céntimos).
 */
export function centsFromDb(value: string | number | bigint): Cents {
  if (typeof value === 'string' && !/^-?\d+$/u.test(value)) {
    throw new RangeError('Importe de la base de datos no válido');
  }
  const big = BigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Importe de la base de datos fuera del rango seguro');
  }
  return assertCents(Number(big));
}
