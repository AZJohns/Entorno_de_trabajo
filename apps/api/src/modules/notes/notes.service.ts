/**
 * Reglas de negocio de las notas (docs/plan.md §2.8, fase 5a). No conoce `req` ni `res`.
 *
 * Códigos de error (la base de datos impone además las restricciones de la migración 0008):
 * - 404: la nota de la URL no existe.
 * - 400: cursor no válido, o un cursor de otro orden (de la lista sin búsqueda en una búsqueda y al revés).
 * - 422 (`UNPROCESSABLE`): no se produce hoy. Una nota no referencia filas de otras tablas (las etiquetas
 *   se crean si no existen), así que su cuerpo no puede ser «válido pero incoherente con los datos».
 * - 409 (`CONFLICT`): no se produce en las notas; el único conflicto del módulo es renombrar una etiqueta
 *   a un nombre ya usado (`TagsService`).
 *
 * Crear o editar una nota y su conjunto de etiquetas es una sola transacción: o queda todo o no cambia nada.
 */
import type { Kysely } from 'kysely';
import type {
  CreateNoteRequest,
  ListNotesQuery,
  SnippetFragment,
  UpdateNoteRequest,
} from '@backoffice/shared';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { decodeCursor, encodeCursor, type NoteCursor } from './domain/cursor.ts';
import { buildPrefixQuery, splitHeadline } from './domain/search.ts';
import { uniqueTagNames } from './domain/tags.ts';
import { NoteRepository, type NoteListRow, type NoteRecord } from './notes.repository.ts';
import { TagRepository, type TagRecord } from './tags.repository.ts';

export interface NotesServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Una nota con sus etiquetas. */
export interface NoteView extends NoteRecord {
  readonly tags: readonly TagRecord[];
}

/** Un elemento de la lista, sin el cuerpo completo. */
export interface NoteListItem {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly tags: readonly TagRecord[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Solo en las búsquedas: tramos de TEXTO con las coincidencias marcadas. */
  readonly snippet: readonly SnippetFragment[] | null;
}

export interface NotePage {
  readonly items: readonly NoteListItem[];
  readonly nextCursor: string | null;
}

export function noteNotFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'La nota no existe');
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_ERROR', 400, 'Cursor no válido', [
    { path: 'cursor', message: 'Cursor no válido' },
  ]);
}

export class NotesService {
  readonly #deps: NotesServiceDeps;

  constructor(deps: NotesServiceDeps) {
    this.#deps = deps;
  }

  async create(input: CreateNoteRequest): Promise<NoteView> {
    const now = this.#deps.clock.now();
    return this.#deps.db.transaction().execute(async (trx) => {
      const note = await new NoteRepository(trx).insert(
        { title: input.title, bodyMd: input.bodyMd },
        now,
      );
      await new TagRepository(trx).replaceForNote(note.id, uniqueTagNames(input.tags), now);
      return this.#view(trx, note);
    });
  }

  async get(id: string): Promise<NoteView> {
    const note = await new NoteRepository(this.#deps.db).find(id);
    if (note === undefined) throw noteNotFound();
    return this.#view(this.#deps.db, note);
  }

  /**
   * Edita título y cuerpo y, si se indica `tags`, sustituye el conjunto completo de etiquetas. Todo en una
   * transacción con la nota bloqueada: dos ediciones simultáneas se ejecutan una tras otra, y si algo
   * falla (p. ej. una etiqueta que la base de datos rechaza) tampoco cambia el título ni el cuerpo.
   */
  async update(id: string, input: UpdateNoteRequest): Promise<NoteView> {
    const now = this.#deps.clock.now();
    return this.#deps.db.transaction().execute(async (trx) => {
      const notes = new NoteRepository(trx);
      if (!(await notes.lock(id))) throw noteNotFound();
      const changes = {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.bodyMd === undefined ? {} : { bodyMd: input.bodyMd }),
      };
      // Cambiar solo las etiquetas también es editar la nota: actualiza `updated_at`.
      const note = await notes.update(id, changes, now);
      if (note === undefined) throw noteNotFound();
      if (input.tags !== undefined) {
        await new TagRepository(trx).replaceForNote(id, uniqueTagNames(input.tags), now);
      }
      return this.#view(trx, note);
    });
  }

  async delete(id: string): Promise<void> {
    if (!(await new NoteRepository(this.#deps.db).delete(id))) throw noteNotFound();
  }

  /**
   * Lista paginada. Con `q`, por relevancia y con fragmentos resaltados; sin `q`, por última edición.
   * Una búsqueda sin ningún término que PostgreSQL pueda usar (solo palabras vacías como «de» o «la»)
   * no encuentra nada: es una lista vacía, no un error.
   */
  async list(query: ListNotesQuery): Promise<NotePage> {
    const { limit, cursor, q, tag } = query;
    const notes = new NoteRepository(this.#deps.db);
    const decoded = cursor === undefined ? null : decodeCursor(cursor);
    if (cursor !== undefined && decoded === null) throw invalidCursor();

    let rows: NoteListRow[];
    if (q === undefined) {
      if (decoded !== null && decoded.kind !== 'recent') throw invalidCursor();
      rows = await notes.listRecent({ tag }, limit, decoded);
    } else {
      if (decoded !== null && decoded.kind !== 'ranked') throw invalidCursor();
      const tsQuery = buildPrefixQuery(q);
      // El esquema compartido exige alguna letra o cifra, pero este servicio no depende de ello.
      rows = tsQuery === null ? [] : await notes.search(tsQuery, { tag }, limit, decoded);
    }

    const pageRows = rows.slice(0, limit);
    const tags = await new TagRepository(this.#deps.db).forNotes(pageRows.map((row) => row.id));
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => ({
        id: row.id,
        title: row.title,
        preview: row.preview,
        tags: tags.get(row.id) ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        snippet: row.headline === null ? null : splitHeadline(row.headline),
      })),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
    };
  }

  async #view(db: Kysely<Database>, note: NoteRecord): Promise<NoteView> {
    const tags = await new TagRepository(db).forNotes([note.id]);
    return { ...note, tags: tags.get(note.id) ?? [] };
  }
}

/** El cursor que apunta justo después de esta fila, en el orden con que se obtuvo. */
function cursorOf(row: NoteListRow): NoteCursor {
  return row.rank === null
    ? { kind: 'recent', updatedAt: row.updatedAt, id: row.id }
    : { kind: 'ranked', rank: row.rank, updatedAt: row.updatedAt, id: row.id };
}
