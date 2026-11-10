/**
 * Lógica pura de las etiquetas (sin E/S).
 */

/**
 * Quita los nombres repetidos sin distinguir mayúsculas, conservando el orden y la grafía de la primera
 * aparición: `['Cuentas', 'cuentas', 'Casa']` → `['Cuentas', 'Casa']`.
 *
 * La base de datos también lo impone (índice único sobre `lower(name)`); aquí se hace para que el
 * conjunto resultante sea determinista (la primera grafía gana). Se compara con `toLowerCase()`, que
 * pliega igual que `lower()` de PostgreSQL con una configuración regional UTF-8; si en un caso raro
 * difirieran, la base de datos tiene la última palabra: no habría duplicados, solo una etiqueta
 * reutilizada.
 */
export function uniqueTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
