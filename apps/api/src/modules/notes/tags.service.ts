/**
 * Reglas de negocio de las etiquetas (docs/plan.md §2.8, fase 5a): listarlas y renombrarlas. Se crean al
 * poner una etiqueta a una nota (`NotesService`); borrarlas no está en este PR.
 *
 * Códigos de error:
 * - 404: la etiqueta de la URL no existe.
 * - 409 (`CONFLICT`): el nombre nuevo ya es de OTRA etiqueta (sin distinguir mayúsculas). Es un conflicto
 *   con el estado actual, no un cuerpo incoherente: dos etiquetas no se pueden fundir renombrando.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { AppError } from '../../http/errors.ts';
import { TAG_NAME_UNIQUE, TagRepository, type TagWithCount } from './tags.repository.ts';

export interface TagsServiceDeps {
  readonly db: Kysely<Database>;
}

function tagNotFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'La etiqueta no existe');
}

export class TagsService {
  readonly #db: Kysely<Database>;

  constructor(deps: TagsServiceDeps) {
    this.#db = deps.db;
  }

  list(): Promise<TagWithCount[]> {
    return new TagRepository(this.#db).list();
  }

  /** Cambiar solo las mayúsculas de la propia etiqueta («python» → «Python») es válido. */
  async rename(id: string, name: string): Promise<TagWithCount> {
    const tags = new TagRepository(this.#db);
    try {
      if (!(await tags.rename(id, name))) throw tagNotFound();
    } catch (error) {
      if (isUniqueViolation(error, TAG_NAME_UNIQUE)) {
        throw new AppError('CONFLICT', 409, 'Ya existe otra etiqueta con ese nombre', [
          { path: 'name', message: 'Ya existe otra etiqueta con ese nombre' },
        ]);
      }
      throw error;
    }
    const tag = await tags.find(id);
    if (tag === undefined) throw tagNotFound();
    return tag;
  }
}
