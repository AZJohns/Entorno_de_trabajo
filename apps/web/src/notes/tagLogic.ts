/**
 * Lógica pura de las etiquetas del editor. La API las deduplica sin distinguir mayúsculas; aquí se hace
 * lo mismo antes de enviar para que lo que se ve en pantalla sea lo que se guarda.
 */
import { MAX_TAG_NAME, MAX_TAGS_PER_NOTE } from '@backoffice/shared';

/** Clave de comparación: sin distinguir mayúsculas (igual que el índice `lower(name)` de la base). */
const key = (name: string): string => name.toLowerCase();

/** Quita espacios en los extremos y sobrantes en medio. */
export function cleanTagName(raw: string): string {
  return raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Añade una etiqueta a la lista. Si ya hay otra que solo difiere en mayúsculas no se duplica; si
 * coincide con una etiqueta existente, se usa la grafía de esa (la API también conserva la existente).
 * Devuelve la lista sin cambios si el nombre está vacío, es demasiado largo o se supera el máximo.
 */
export function addTag(
  current: readonly string[],
  raw: string,
  known: readonly string[],
): string[] {
  const name = cleanTagName(raw);
  if (name === '' || name.length > MAX_TAG_NAME) return [...current];
  if (current.some((tag) => key(tag) === key(name))) return [...current];
  if (current.length >= MAX_TAGS_PER_NOTE) return [...current];
  const existing = known.find((tag) => key(tag) === key(name));
  return [...current, existing ?? name];
}

/** Une listas de etiquetas sin repetir las que solo difieren en mayúsculas (gana la primera grafía). */
export function mergeTags(...lists: readonly (readonly string[])[]): string[] {
  let result: string[] = [];
  for (const list of lists) {
    for (const name of list) result = addTag(result, name, []);
  }
  return result;
}

/** Etiquetas conocidas que encajan con lo escrito y aún no están en la nota (como máximo `limit`). */
export function suggestTags(
  known: readonly string[],
  current: readonly string[],
  typed: string,
  limit = 8,
): string[] {
  const needle = key(cleanTagName(typed));
  const taken = new Set(current.map(key));
  return known
    .filter((tag) => !taken.has(key(tag)) && key(tag).includes(needle))
    .sort((a, b) => {
      // Primero las que empiezan por lo escrito; después, por orden alfabético.
      const starts = Number(!key(a).startsWith(needle)) - Number(!key(b).startsWith(needle));
      return starts !== 0 ? starts : a.localeCompare(b, 'es');
    })
    .slice(0, limit);
}

/** ¿Son iguales los dos conjuntos de etiquetas (sin distinguir mayúsculas ni orden)? */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a.map(key));
  return b.every((tag) => left.has(key(tag)));
}
