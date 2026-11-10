/**
 * Acceso a las tablas `tags` y `note_tags`. Solo consultas.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';

export interface TagRecord {
  readonly id: string;
  readonly name: string;
}

export interface TagWithCount extends TagRecord {
  readonly noteCount: number;
}

/** Nombre del índice único sin distinguir mayúsculas (migración 0008): el servicio lo traduce a 409. */
export const TAG_NAME_UNIQUE = 'tags_name_lower_key';

export class TagRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /** Todas las etiquetas con su número de notas (las que ya no usa ninguna, con 0), por nombre. */
  async list(): Promise<TagWithCount[]> {
    const rows = await this.#db
      .selectFrom('tags as t')
      .leftJoin('note_tags as nt', 'nt.tag_id', 't.id')
      .select(['t.id', 't.name', (eb) => eb.fn.count<string>('nt.note_id').as('note_count')])
      .groupBy(['t.id', 't.name'])
      .orderBy(sql`lower(t.name)`)
      .orderBy('t.name')
      .execute();
    return rows.map((row) => ({ id: row.id, name: row.name, noteCount: Number(row.note_count) }));
  }

  async find(id: string): Promise<TagWithCount | undefined> {
    const row = await this.#db
      .selectFrom('tags as t')
      .leftJoin('note_tags as nt', 'nt.tag_id', 't.id')
      .select(['t.id', 't.name', (eb) => eb.fn.count<string>('nt.note_id').as('note_count')])
      .where('t.id', '=', id)
      .groupBy(['t.id', 't.name'])
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : { id: row.id, name: row.name, noteCount: Number(row.note_count) };
  }

  /**
   * Renombra la etiqueta. Cambiar solo las mayúsculas («python» → «Python») no choca con el índice único:
   * la fila es la misma.
   *
   * @returns `false` si no existe. Si el nombre ya es de OTRA etiqueta, lanza el error de unicidad de
   *   PostgreSQL (`TAG_NAME_UNIQUE`).
   */
  async rename(id: string, name: string): Promise<boolean> {
    const result = await this.#db
      .updateTable('tags')
      .set({ name })
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Las etiquetas de varias notas, ordenadas por nombre sin distinguir mayúsculas. */
  async forNotes(noteIds: readonly string[]): Promise<Map<string, TagRecord[]>> {
    const result = new Map<string, TagRecord[]>();
    if (noteIds.length === 0) return result;
    const rows = await this.#db
      .selectFrom('note_tags as nt')
      .innerJoin('tags as t', 't.id', 'nt.tag_id')
      .select(['nt.note_id', 't.id', 't.name'])
      .where('nt.note_id', 'in', noteIds)
      .orderBy(sql`lower(t.name)`)
      .orderBy('t.name')
      .execute();
    for (const row of rows) {
      const tags = result.get(row.note_id) ?? [];
      tags.push({ id: row.id, name: row.name });
      result.set(row.note_id, tags);
    }
    return result;
  }

  /**
   * Deja a la nota exactamente las etiquetas indicadas. Debe ejecutarse dentro de una transacción con la
   * nota bloqueada (`NoteRepository.lock`): son varias sentencias que solo juntas son una sustitución.
   *
   * 1. Crea las que no existen. `ON CONFLICT (lower(name)) DO NOTHING` es seguro con peticiones
   *    simultáneas: si otra transacción está creando la misma etiqueta, espera a su resultado y no
   *    duplica ni falla. Una etiqueta existente conserva su grafía.
   * 2. Lee los identificadores de TODAS las indicadas (las nuevas y las que ya estaban) por `lower(name)`.
   * 3. Borra los enlaces que ya no están en el conjunto y añade los que faltan.
   *
   * Los nombres ya llegan sin repetidos (`uniqueTagNames`).
   */
  async replaceForNote(noteId: string, names: readonly string[], now: Date): Promise<void> {
    let tagIds: string[] = [];
    if (names.length > 0) {
      await sql`
        INSERT INTO tags (name, created_at)
        SELECT u.tag_name, ${now}::timestamptz FROM unnest(${names}::text[]) AS u (tag_name)
        ON CONFLICT (lower(name)) DO NOTHING
      `.execute(this.#db);
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM tags
        WHERE lower(name) IN (SELECT lower(u.tag_name) FROM unnest(${names}::text[]) AS u (tag_name))
      `.execute(this.#db);
      tagIds = rows.map((row) => row.id);
    }
    await sql`
      DELETE FROM note_tags WHERE note_id = ${noteId}::uuid AND tag_id <> ALL(${tagIds}::uuid[])
    `.execute(this.#db);
    if (tagIds.length > 0) {
      await sql`
        INSERT INTO note_tags (note_id, tag_id)
        SELECT ${noteId}::uuid, u.tag_id FROM unnest(${tagIds}::uuid[]) AS u (tag_id)
        ON CONFLICT DO NOTHING
      `.execute(this.#db);
    }
  }
}
