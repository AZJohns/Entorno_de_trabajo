/**
 * Acceso a las tablas `notes` y `note_tags`. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción, como el resto de repositorios.
 */
import { sql, type Kysely, type RawBuilder, type Selectable } from 'kysely';
import { NOTE_PREVIEW_LENGTH } from '@backoffice/shared';
import type { Database, NotesTable } from '../../db/schema.ts';
import type { NoteCursor } from './domain/cursor.ts';
import { MATCH_END, MATCH_START } from './domain/search.ts';

export interface NoteRecord {
  readonly id: string;
  readonly title: string;
  readonly bodyMd: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Una fila de la lista: sin el cuerpo completo. */
export interface NoteListRow {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Fragmento de `ts_headline` con las marcas `MATCH_START`/`MATCH_END`; solo en las búsquedas. */
  readonly headline: string | null;
  /** Relevancia; solo en las búsquedas. */
  readonly rank: number | null;
}

/** Valores de una nota nueva. */
export interface NewNote {
  readonly title: string;
  readonly bodyMd: string;
}

/** Campos editables de una nota (los que no se indican no cambian). */
export interface NoteChanges {
  readonly title?: string;
  readonly bodyMd?: string;
}

export interface NoteFilter {
  /** Nombre de la etiqueta (sin distinguir mayúsculas). */
  readonly tag?: string | undefined;
}

type NoteRow = Pick<
  Selectable<NotesTable>,
  'id' | 'title' | 'body_md' | 'created_at' | 'updated_at'
>;

function toNote(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.body_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Condición «la nota tiene la etiqueta»: la comparación no distingue mayúsculas (como el índice único). */
function hasTag(tag: string): RawBuilder<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
    WHERE nt.note_id = n.id AND lower(t.name) = lower(${tag})
  )`;
}

/**
 * Opciones de `ts_headline`: marcas privadas en lugar de `<b>`, y hasta dos fragmentos cortos alrededor de
 * las coincidencias. Los valores van entre comillas para que el analizador de opciones no los recorte.
 */
const HEADLINE_OPTIONS =
  `StartSel="${MATCH_START}", StopSel="${MATCH_END}", ` +
  'MaxFragments=2, MinWords=12, MaxWords=30, ShortWord=2, FragmentDelimiter=" … "';

const MARKS = `${MATCH_START}${MATCH_END}`;

export class NoteRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async find(id: string): Promise<NoteRecord | undefined> {
    const row = await this.#db
      .selectFrom('notes')
      .select(['id', 'title', 'body_md', 'created_at', 'updated_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toNote(row);
  }

  /**
   * Bloquea la fila de la nota hasta el final de la transacción: dos ediciones a la vez de la misma nota
   * (en especial de sus etiquetas) se ejecutan una tras otra y la segunda ve lo que dejó la primera.
   *
   * @returns `false` si la nota no existe.
   */
  async lock(id: string): Promise<boolean> {
    const row = await this.#db
      .selectFrom('notes')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row !== undefined;
  }

  async insert(values: NewNote, now: Date): Promise<NoteRecord> {
    const row = await this.#db
      .insertInto('notes')
      .values({ title: values.title, body_md: values.bodyMd, created_at: now, updated_at: now })
      .returning(['id', 'title', 'body_md', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();
    return toNote(row);
  }

  /** Cualquier edición (también solo de etiquetas, con `changes` vacío) actualiza `updated_at`. */
  async update(id: string, changes: NoteChanges, now: Date): Promise<NoteRecord | undefined> {
    const row = await this.#db
      .updateTable('notes')
      .set({
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.bodyMd === undefined ? {} : { body_md: changes.bodyMd }),
        updated_at: now,
      })
      .where('id', '=', id)
      .returning(['id', 'title', 'body_md', 'created_at', 'updated_at'])
      .executeTakeFirst();
    return row === undefined ? undefined : toNote(row);
  }

  /** @returns `false` si no existía. Sus enlaces con etiquetas caen en cascada. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db.deleteFrom('notes').where('id', '=', id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /**
   * Lista sin búsqueda: última edición primero. Pide una fila de más (`limit + 1`) para saber si hay otra
   * página.
   */
  async listRecent(
    filter: NoteFilter,
    limit: number,
    after: Extract<NoteCursor, { kind: 'recent' }> | null,
  ): Promise<NoteListRow[]> {
    let query = this.#db
      .selectFrom('notes as n')
      .select([
        'n.id',
        'n.title',
        'n.created_at',
        'n.updated_at',
        sql<string>`left(n.body_md, ${NOTE_PREVIEW_LENGTH})`.as('preview'),
      ]);
    if (filter.tag !== undefined) query = query.where(hasTag(filter.tag));
    if (after !== null) {
      query = query.where(
        sql<boolean>`(n.updated_at, n.id) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`,
      );
    }
    const rows = await query
      .orderBy('n.updated_at', 'desc')
      .orderBy('n.id', 'desc')
      .limit(limit + 1)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      headline: null,
      rank: null,
    }));
  }

  /**
   * Búsqueda de texto completo: relevancia (`ts_rank_cd`, normalizada por la longitud del documento para
   * que una nota larga no gane solo por tener más texto), luego última edición y `id`.
   *
   * `ts_headline` es lo más caro de la consulta, así que solo se calcula para las filas de la página
   * (`page`), no para todas las coincidencias. Recibe el cuerpo SIN las marcas privadas (`translate`).
   *
   * @param tsQuery Entrada de `to_tsquery` ya construida por `buildPrefixQuery` (solo letras y cifras).
   */
  async search(
    tsQuery: string,
    filter: NoteFilter,
    limit: number,
    after: Extract<NoteCursor, { kind: 'ranked' }> | null,
  ): Promise<NoteListRow[]> {
    const tagCondition = filter.tag === undefined ? sql`` : sql`AND ${hasTag(filter.tag)}`;
    const keyset =
      after === null
        ? sql``
        : sql`WHERE ranked.rank < ${after.rank}::float8
            OR (ranked.rank = ${after.rank}::float8
                AND (ranked.updated_at, ranked.id) < (${after.updatedAt}::timestamptz, ${after.id}::uuid))`;
    const { rows } = await sql<{
      id: string;
      title: string;
      preview: string;
      created_at: Date;
      updated_at: Date;
      rank: number;
      headline: string;
    }>`
      WITH q AS (SELECT to_tsquery('es_unaccent', ${tsQuery}) AS query),
      ranked AS (
        SELECT n.id, n.title, n.body_md, n.created_at, n.updated_at,
               ts_rank_cd(n.search_vector, q.query, 1)::float8 AS rank
        FROM notes n CROSS JOIN q
        WHERE n.search_vector @@ q.query ${tagCondition}
      ),
      page AS (
        SELECT * FROM ranked ${keyset}
        ORDER BY ranked.rank DESC, ranked.updated_at DESC, ranked.id DESC
        LIMIT ${limit + 1}
      )
      SELECT page.id, page.title, left(page.body_md, ${NOTE_PREVIEW_LENGTH}) AS preview,
             page.created_at, page.updated_at, page.rank,
             ts_headline('es_unaccent', translate(page.body_md, ${MARKS}::text, ''), q.query,
                         ${HEADLINE_OPTIONS}) AS headline
      FROM page CROSS JOIN q
      ORDER BY page.rank DESC, page.updated_at DESC, page.id DESC
    `.execute(this.#db);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      preview: row.preview,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      headline: row.headline,
      rank: row.rank,
    }));
  }
}
