/**
 * Cursor opaco de la lista de notas. Dos formas, según el orden de la lista:
 * - `recent`: sin búsqueda, por última edición (más reciente primero) y `id`.
 * - `ranked`: con búsqueda, por relevancia, última edición y `id`.
 *
 * Es paginación por clave (la siguiente página son las filas posteriores a la última vista), no por
 * desplazamiento: añadir o borrar notas mientras se pagina no repite ni se salta filas ya vistas. Va en
 * base64url solo para que el cliente no lo construya; no es un secreto.
 *
 * `updatedAt` viaja con precisión de milisegundos: es la de `Date`, con la que el servicio escribe siempre
 * `updated_at` (nunca el `now()` de PostgreSQL, que llega a microsegundos y no cabría en el cursor).
 */
export type NoteCursor =
  | { readonly kind: 'recent'; readonly updatedAt: Date; readonly id: string }
  | {
      readonly kind: 'ranked';
      readonly rank: number;
      readonly updatedAt: Date;
      readonly id: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function encodeCursor(cursor: NoteCursor): string {
  const parts =
    cursor.kind === 'recent'
      ? ['recent', cursor.updatedAt.toISOString(), cursor.id]
      : ['ranked', String(cursor.rank), cursor.updatedAt.toISOString(), cursor.id];
  return Buffer.from(parts.join('|'), 'utf8').toString('base64url');
}

/** @returns el cursor, o `null` si el texto no es un cursor válido. */
export function decodeCursor(text: string): NoteCursor | null {
  const parts = Buffer.from(text, 'base64url').toString('utf8').split('|');
  if (parts[0] === 'recent' && parts.length === 3) {
    const [, updated = '', id = ''] = parts;
    const updatedAt = parseInstant(updated);
    return updatedAt !== null && UUID.test(id) ? { kind: 'recent', updatedAt, id } : null;
  }
  if (parts[0] === 'ranked' && parts.length === 4) {
    const [, rankText = '', updated = '', id = ''] = parts;
    const rank = Number(rankText);
    const updatedAt = parseInstant(updated);
    const valid = rankText !== '' && Number.isFinite(rank) && rank >= 0;
    return valid && updatedAt !== null && UUID.test(id)
      ? { kind: 'ranked', rank, updatedAt, id }
      : null;
  }
  return null;
}

function parseInstant(text: string): Date | null {
  if (!ISO.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
