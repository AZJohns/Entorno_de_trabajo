/**
 * Importes en los formularios: del texto que escribe la persona a céntimos, y de céntimos a texto.
 *
 * Toda la conversión pasa por `parseEuroAmount` y `formatCents` de `@backoffice/shared`: aquí no hay
 * `parseFloat` ni `Number(texto)` con importes.
 */
import {
  formatCents,
  parseEuroAmount,
  type Cents,
  type ParseAmountFailure,
} from '@backoffice/shared';

export interface AmountRules {
  /** Admite un `-` inicial (saldos). Por defecto, no. */
  readonly allowNegative?: boolean;
  /** Admite el 0. Por defecto, no: un movimiento confirmado y una transferencia son siempre > 0. */
  readonly allowZero?: boolean;
}

export type AmountInputResult =
  { readonly ok: true; readonly cents: Cents } | { readonly ok: false; readonly message: string };

const MESSAGES: Record<ParseAmountFailure, string> = {
  empty: 'Escribe un importe',
  invalid_format: 'Importe no válido. Ejemplos: 12,50 · 1.234,56',
  too_many_decimals: 'El importe admite como máximo dos decimales',
  ambiguous_separator: 'Usa la coma para los céntimos (12,34) o escribe el número sin separadores',
  negative_not_allowed: 'El importe no puede ser negativo',
  out_of_range: 'El importe es demasiado grande',
  too_long: 'El importe es demasiado largo',
};

/** Convierte el texto de un campo de importe en céntimos, o en un mensaje de error en español. */
export function readAmount(text: string, rules: AmountRules = {}): AmountInputResult {
  // `rejectAmbiguousComma`: «12,345» podría ser un decimal mal escrito; se pide aclararlo.
  const parsed = parseEuroAmount(text, {
    allowNegative: rules.allowNegative === true,
    rejectAmbiguousComma: true,
  });
  if (!parsed.ok) return { ok: false, message: MESSAGES[parsed.reason] };
  if (parsed.cents === 0 && rules.allowZero !== true) {
    return { ok: false, message: 'El importe debe ser mayor que 0' };
  }
  return { ok: true, cents: parsed.cents };
}

/**
 * Texto con el que se rellena un campo de importe al editar: sin símbolo ni separador de miles, para
 * que lo vuelva a leer `parseEuroAmount` (p. ej. `-1234,50`).
 */
export function amountToInput(cents: Cents): string {
  // BigInt: dividir un entero grande entre 100 en coma flotante puede redondear mal.
  const absolute = BigInt(Math.abs(cents));
  const sign = cents < 0 ? '-' : '';
  return `${sign}${String(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`;
}

/** Importe con formato de moneda: `1234,50 €`. */
export function money(cents: Cents): string {
  return formatCents(cents);
}
