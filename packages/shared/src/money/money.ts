/**
 * Utilidades de importes en euros.
 *
 * Regla del proyecto: un importe es siempre un número **entero de céntimos** (nunca un `float`).
 * Los números de coma flotante no representan exactamente 0,10 ni 0,20 (0.1 + 0.2 !== 0.3), y los
 * errores se acumulan en sumas y saldos. Con enteros, la suma es exacta.
 *
 * Este módulo es el único sitio que convierte texto ↔ céntimos. Nunca uses `parseFloat` ni
 * `Number(texto)` con importes fuera de aquí.
 */

/** Importe en céntimos de euro. Siempre un entero seguro (`Number.isSafeInteger`). */
export type Cents = number;

/**
 * Indica si un valor es un importe válido en céntimos.
 *
 * El límite es `Number.MAX_SAFE_INTEGER` (≈ 90 billones de euros): por encima, un `number` de
 * JavaScript deja de representar exactamente cada entero.
 */
export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Comprueba que un número es un importe en céntimos válido y lo devuelve.
 *
 * @throws {RangeError} si no es un entero seguro (p. ej., 12.5, NaN o un valor fuera de rango).
 */
export function assertCents(value: number): Cents {
  if (!isCents(value)) {
    throw new RangeError(`Importe en céntimos no válido: ${String(value)}`);
  }
  return value;
}

/** Motivo por el que un texto no se pudo convertir en importe. */
export type ParseAmountFailure =
  | 'empty'
  | 'invalid_format'
  | 'too_many_decimals'
  | 'ambiguous_separator'
  | 'negative_not_allowed'
  | 'out_of_range'
  | 'too_long';

/** Resultado de {@link parseEuroAmount}: nunca lanza excepciones con entradas del usuario. */
export type ParseAmountResult =
  | { readonly ok: true; readonly cents: Cents }
  | { readonly ok: false; readonly reason: ParseAmountFailure };

/** Opciones de {@link parseEuroAmount}. */
export interface ParseAmountOptions {
  /** Permite un signo `-` inicial (p. ej., saldo inicial en descubierto). Por defecto, `false`. */
  readonly allowNegative?: boolean;
  /**
   * Rechaza (`ambiguous_separator`) una coma seguida de exactamente 3 cifras y sin más separadores
   * (`12,345`), que por defecto se lee como miles (12.345 €). Para formularios, donde esa entrada
   * suele ser un decimal mal escrito; el atajo del iPhone mantiene el comportamiento por defecto.
   * No afecta a `1.234` (el punto como miles es lo habitual en español) ni a `1,234,567`.
   */
  readonly rejectAmbiguousComma?: boolean;
}

/**
 * Longitud máxima del texto de entrada, comprobada ANTES de cualquier otra operación.
 *
 * El importe válido más largo es el máximo entero seguro con separadores, signo y moneda
 * («-90.071.992.547.409,91 EUR», 26 caracteres). 64 deja margen para espacios alrededor y sigue
 * acotando el trabajo: el texto puede venir de la red (atajo de iPhone) o de un archivo (Excel), y
 * sin límite un atacante podría enviar megabytes para consumir CPU.
 */
export const MAX_AMOUNT_INPUT_LENGTH = 64;

/**
 * Quita un `€` o `EUR` (sin distinguir mayúsculas) al principio y al final, con los espacios que los
 * separan del número.
 *
 * Se hace con operaciones lineales (`trim`, `slice`, comparaciones de prefijo y sufijo) en lugar de
 * una expresión regular: la versión anterior, `/^(?:€|eur)\s*|\s*(?:€|eur)$/giu`, tenía una
 * alternativa sin anclar al inicio con `\s*`, y con muchos espacios su coste era cuadrático
 * (ReDoS; alerta de CodeQL js/polynomial-redos).
 */
function stripCurrencyAffix(input: string): string {
  let text = input.trim();
  if (text.startsWith('€')) {
    text = text.slice(1).trimStart();
  } else if (text.slice(0, 3).toLowerCase() === 'eur') {
    text = text.slice(3).trimStart();
  }
  if (text.endsWith('€')) {
    text = text.slice(0, -1).trimEnd();
  } else if (text.slice(-3).toLowerCase() === 'eur') {
    text = text.slice(0, -3).trimEnd();
  }
  return text;
}

const AMOUNT_BODY = /^\d[\d.,]*$/u;
const THOUSANDS_GROUPS = /^\d{1,3}(?:\d{3})*$/u;

/**
 * Convierte un texto con un importe en euros a céntimos, sin usar coma flotante.
 *
 * Formatos aceptados (con o sin `€`/`EUR` delante o detrás):
 * - `12`, `12,5`, `12,50`, `12.50` → 1250 céntimos.
 * - `1.234,56` y `1,234.56` → 123456 (si aparecen los dos separadores, el **último** es el decimal).
 * - `1.234` y `1,234` → 123400: un único separador seguido de **exactamente 3 cifras** se interpreta
 *   como separador de miles; seguido de 1 o 2 cifras, como decimal.
 * - `1.234.567` → 123456700 (separador de miles repetido).
 *
 * Casos límite:
 * - Más de 2 decimales (`12,345` con el otro separador presente, `0,001`) → `too_many_decimals`.
 * - Grupos de miles mal formados (`1.23.456`) o espacios interiores → `invalid_format`.
 * - Negativos solo con `allowNegative`; nunca `+`.
 * - Más de {@link MAX_AMOUNT_INPUT_LENGTH} caracteres → `too_long`, sin procesar el texto.
 *
 * @param input Texto introducido por el usuario o recibido de un cliente.
 * @returns `{ ok: true, cents }` o `{ ok: false, reason }`.
 */
export function parseEuroAmount(
  input: string,
  options: ParseAmountOptions = {},
): ParseAmountResult {
  // Primero se acota el trabajo: ninguna operación posterior recorre más de este número de caracteres.
  if (input.length > MAX_AMOUNT_INPUT_LENGTH) return fail('too_long');

  let text = stripCurrencyAffix(input);
  if (text === '') return fail('empty');

  let negative = false;
  if (text.startsWith('-')) {
    if (options.allowNegative !== true) return fail('negative_not_allowed');
    negative = true;
    text = text.slice(1);
  }
  if (!AMOUNT_BODY.test(text) || /[.,]$/u.test(text)) return fail('invalid_format');

  const split = splitIntegerAndDecimals(text, options.rejectAmbiguousComma === true);
  if (!split.ok) return split;
  const { integerDigits, decimalDigits } = split;

  // Se opera con BigInt sobre cadenas de dígitos: la conversión es exacta por construcción.
  const cents = BigInt(integerDigits) * 100n + BigInt(decimalDigits.padEnd(2, '0') || '0');
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return fail('out_of_range');

  const value = Number(cents);
  // `-0` no es un importe útil y complica las comparaciones: se normaliza a 0.
  return { ok: true, cents: negative && value !== 0 ? -value : value };
}

type SplitResult =
  | { readonly ok: true; readonly integerDigits: string; readonly decimalDigits: string }
  | { readonly ok: false; readonly reason: ParseAmountFailure };

function splitIntegerAndDecimals(text: string, rejectAmbiguousComma: boolean): SplitResult {
  const hasDot = text.includes('.');
  const hasComma = text.includes(',');

  if (!hasDot && !hasComma) return { ok: true, integerDigits: text, decimalDigits: '' };

  if (hasDot && hasComma) {
    const decimalSep = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const [integerPart = '', decimalPart = '', ...extra] = text.split(decimalSep);
    if (extra.length > 0) return fail('invalid_format');
    if (decimalPart.length > 2) return fail('too_many_decimals');
    const integerDigits = joinThousands(integerPart, thousandsSep);
    if (integerDigits === null) return fail('invalid_format');
    return { ok: true, integerDigits, decimalDigits: decimalPart };
  }

  const sep = hasDot ? '.' : ',';
  const parts = text.split(sep);
  if (parts.length > 2) {
    const integerDigits = joinThousands(text, sep);
    return integerDigits === null
      ? fail('invalid_format')
      : { ok: true, integerDigits, decimalDigits: '' };
  }
  const [integerPart = '', afterSep = ''] = parts;
  if (afterSep.length === 3) {
    // «0,001» no es un separador de miles (un grupo de miles nunca empieza por 0): son 3 decimales.
    if (integerPart.startsWith('0')) return fail('too_many_decimals');
    if (rejectAmbiguousComma && sep === ',') return fail('ambiguous_separator');
    return { ok: true, integerDigits: integerPart + afterSep, decimalDigits: '' };
  }
  if (afterSep.length <= 2)
    return { ok: true, integerDigits: integerPart, decimalDigits: afterSep };
  return fail('too_many_decimals');
}

/** Quita el separador de miles comprobando que los grupos son de 3 cifras. */
function joinThousands(integerPart: string, sep: string): string | null {
  const digits = integerPart.split(sep).join('');
  const groups = integerPart.split(sep);
  if (groups.length > 1) {
    const [first = '', ...rest] = groups;
    if (first.length < 1 || first.length > 3 || first.startsWith('0')) return null;
    if (rest.some((g) => g.length !== 3)) return null;
  }
  return THOUSANDS_GROUPS.test(digits) ? digits : null;
}

function fail(reason: ParseAmountFailure): { ok: false; reason: ParseAmountFailure } {
  return { ok: false, reason };
}

const EUR_FORMAT = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

/**
 * Formatea céntimos como texto en euros con la convención de España (`1234,56 €`, `12.345,67 €`).
 *
 * No divide entre 100 con coma flotante: construye la cadena decimal exacta y se la pasa a
 * `Intl.NumberFormat`, que acepta números en forma de cadena sin perder precisión.
 *
 * Nota: en `es-ES`, Intl no agrupa los miles en números de 4 cifras (`1234,56 €`); es la norma
 * CLDR para el español, no un error.
 *
 * @throws {RangeError} si `cents` no es un entero seguro.
 */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  // BigInt también aquí: dividir un entero grande entre 100 en coma flotante puede redondear mal.
  const absolute = BigInt(Math.abs(cents));
  const sign = cents < 0 ? '-' : '';
  const decimal = `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  // La firma de tipos de format() solo admite number | bigint, pero el estándar (Intl.NumberFormat
  // v3) acepta cadenas decimales exactas. Se convierte el tipo, no el valor.
  return EUR_FORMAT.format(decimal as unknown as number);
}
