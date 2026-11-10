/**
 * Lógica pura de la búsqueda de notas (sin E/S): construir la consulta de texto completo a partir de lo
 * que escribe el usuario y convertir el fragmento resaltado de PostgreSQL en tramos de TEXTO.
 */
import type { SnippetFragment } from '@backoffice/shared';

/** Máximo de términos de una búsqueda: acota el trabajo de una sola consulta. */
export const MAX_SEARCH_TERMS = 8;
/** Largo máximo de un término: uno más largo no es una palabra, y recortarlo basta para no desbordar nada. */
const MAX_TERM_LENGTH = 50;

/**
 * Convierte el texto de búsqueda en la entrada de `to_tsquery`: cada término lleva `:*` (prefijo) y se
 * unen con `&`, así que «presup inf» encuentra las notas que tienen una palabra que empieza por «presup» y
 * otra que empieza por «inf».
 *
 * Por qué prefijo y no `pg_trgm` (decisión en docs/plan.md §2.8):
 * - Se apoya en el mismo índice GIN, la misma configuración `es_unaccent` y la misma lematización que la
 *   búsqueda normal: «presup» se reduce a la raíz y encuentra «presupuestos»; con trigramas no habría
 *   lematización y harían falta otra extensión y otros índices (grandes, sobre el cuerpo entero).
 * - El caso que importa es escribir el comienzo de una palabra. Los trigramas aportarían tolerancia a erratas
 *   y coincidencias en mitad de palabra, que no se piden y cuestan relevancia.
 *
 * Seguridad: solo se conservan letras y cifras de cada término, así que ningún operador de `tsquery`
 * (`& | ! ( ) < > : * '`) llega a la consulta, y además va como parámetro (nunca concatenada al SQL).
 *
 * Una palabra vacía de significado («de», «la») la descarta PostgreSQL al interpretar la consulta; si todo
 * son palabras así, la consulta queda vacía y no encuentra nada.
 *
 * @returns `null` si no hay ningún término (el texto no tiene letras ni cifras).
 */
export function buildPrefixQuery(text: string): string | null {
  const terms = text.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return null;
  return terms
    .slice(0, MAX_SEARCH_TERMS)
    .map((term) => `${term.slice(0, MAX_TERM_LENGTH)}:*`)
    .join(' & ');
}

/**
 * Marcas con las que se pide a `ts_headline` señalar una coincidencia: caracteres del área de uso privado
 * de Unicode, que no aparecen en texto real. Se usan en lugar de `<b>…</b>` para que NUNCA haya que
 * insertar HTML: el texto original de la nota (que puede contener `<script>`) sale tal cual y las marcas
 * solo sirven para partirlo en tramos. El SQL las quita del texto de entrada antes de llamar a `ts_headline`
 * (`translate`): si una nota las contuviera, se confundirían con las de PostgreSQL y pintarían de más
 * (nunca HTML, pero sí un resaltado falso).
 */
export const MATCH_START = '';
export const MATCH_END = '';

/**
 * Parte el fragmento de `ts_headline` en tramos de texto. Las marcas desaparecen: solo queda `match`.
 * Una marca de cierre sin apertura o una apertura sin cierre no rompen nada (el resto se toma como
 * coincidencia o como texto normal, según el caso).
 */
export function splitHeadline(headline: string): SnippetFragment[] {
  const fragments: SnippetFragment[] = [];
  let match = false;
  let current = '';
  const flush = (): void => {
    if (current !== '') fragments.push({ text: current, match });
    current = '';
  };
  for (const char of headline) {
    if (char === MATCH_START) {
      flush();
      match = true;
    } else if (char === MATCH_END) {
      flush();
      match = false;
    } else {
      current += char;
    }
  }
  flush();
  return fragments;
}
