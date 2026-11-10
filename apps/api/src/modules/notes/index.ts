/**
 * API pública del módulo de notas. Los demás módulos y la aplicación solo importan de aquí.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { Clock } from '../../lib/clock.ts';
import { createNotesController, createTagsController } from './notes.controller.ts';
import { createNotesRouter } from './notes.routes.ts';
import { NotesService } from './notes.service.ts';
import { TagsService } from './tags.service.ts';

export type { NotesService } from './notes.service.ts';
export type { TagsService } from './tags.service.ts';

/** Dependencias del módulo. */
export interface NotesModuleDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Crea el módulo: los servicios de notas y etiquetas, y su router. */
export function createNotesModule(deps: NotesModuleDeps) {
  const notes = new NotesService(deps);
  const tags = new TagsService({ db: deps.db });
  const router = createNotesRouter(createNotesController(notes), createTagsController(tags));
  return { notes, tags, router };
}
