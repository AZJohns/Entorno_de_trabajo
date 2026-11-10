/**
 * Esquemas de las notas y de sus etiquetas, compartidos por la web y la API (docs/plan.md §2.8 y §2.10).
 * Mismas convenciones que el resto: peticiones estrictas (un campo desconocido es un error) e instantes en
 * ISO 8601. Los topes son los de los CHECK de la migración 0008.
 */
import { z } from 'zod';
import { pageSchema } from '../finance/schemas.ts';

/** Máximo de caracteres del título (CHECK `notes_title_length`). */
export const MAX_NOTE_TITLE = 200;
/**
 * Máximo de caracteres del cuerpo (CHECK `notes_body_length`). Queda por debajo de los 100 kB que admite la
 * API en un cuerpo JSON para texto en castellano; un cuerpo con muchos caracteres no ASCII puede toparse
 * antes con ese límite de tamaño (413).
 */
export const MAX_NOTE_BODY = 100_000;
/** Máximo de caracteres de una etiqueta (CHECK `tags_name_length`). */
export const MAX_TAG_NAME = 40;
/** Máximo de etiquetas por nota: acota el trabajo de una sola petición. */
export const MAX_TAGS_PER_NOTE = 20;
/** Caracteres de la vista previa del cuerpo en las listas. */
export const NOTE_PREVIEW_LENGTH = 200;

const timestamp = z.iso.datetime();

/** Nombre de etiqueta: sin espacios en los extremos ni caracteres de control (saltos de línea, tabuladores…). */
export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TAG_NAME)
  .refine((value) => !/\p{Cc}/u.test(value), {
    message: 'No puede contener caracteres de control',
  });

const title = z.string().trim().min(1).max(MAX_NOTE_TITLE);
const bodyMd = z.string().max(MAX_NOTE_BODY);
const tags = z.array(tagNameSchema).max(MAX_TAGS_PER_NOTE);

// --- notas ---------------------------------------------------------------------------------------

/**
 * Alta. Las etiquetas se crean si no existen; se comparan sin distinguir mayúsculas, así que
 * `['Cuentas', 'cuentas']` es una sola etiqueta (se queda con la primera grafía).
 */
export const createNoteRequestSchema = z.strictObject({
  title,
  bodyMd: bodyMd.default(''),
  tags: tags.default([]),
});

/**
 * Edición parcial. `tags`, si se indica, SUSTITUYE el conjunto completo (`[]` quita todas); si se omite, no
 * se tocan.
 */
export const updateNoteRequestSchema = z
  .strictObject({ title: title.optional(), bodyMd: bodyMd.optional(), tags: tags.optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Indica al menos un campo',
  });

/** Un término de búsqueda debe llevar al menos una letra o cifra: «???» no busca nada. */
const searchText = z
  .string()
  .trim()
  .max(200)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), {
    message: 'La búsqueda debe contener alguna letra o cifra',
  });

/**
 * `GET /notes`: `q` busca en título y cuerpo (palabras a medias incluidas) y ordena por relevancia; sin `q`
 * se ordena por última edición. `tag` filtra por el nombre de una etiqueta, sin distinguir mayúsculas.
 */
export const listNotesQuerySchema = z.strictObject({
  q: searchText.optional(),
  tag: tagNameSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(300).optional(),
});

export const noteTagSchema = z.object({ id: z.uuid(), name: z.string() });

/**
 * Un tramo de texto del fragmento de una búsqueda. `match` indica que es una coincidencia. Es TEXTO: la web
 * lo pinta como nodo de texto (en un `<mark>` si `match`) y nunca lo inserta como HTML. Así un `<script>`
 * escrito en una nota se ve como tal y no se ejecuta.
 */
export const snippetFragmentSchema = z.object({ text: z.string(), match: z.boolean() });

export const noteResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  bodyMd: z.string(),
  /** Ordenadas por nombre sin distinguir mayúsculas. */
  tags: z.array(noteTagSchema),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Un elemento de la lista: sin el cuerpo completo, que puede ser muy largo. */
export const noteListItemSchema = noteResponseSchema.omit({ bodyMd: true }).extend({
  /** Primeros caracteres del cuerpo, en Markdown sin renderizar (se muestra como texto). */
  preview: z.string(),
  /** Solo con `q`: fragmentos del cuerpo con las coincidencias marcadas. `null` sin búsqueda. */
  snippet: z.array(snippetFragmentSchema).nullable(),
});

export const noteListResponseSchema = pageSchema(noteListItemSchema);

// --- etiquetas -----------------------------------------------------------------------------------

export const renameTagRequestSchema = z.strictObject({ name: tagNameSchema });

export const tagResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Número de notas con la etiqueta, calculado al leer. */
  noteCount: z.int().min(0),
});

export const tagListResponseSchema = z.object({ items: z.array(tagResponseSchema) });

export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
export type NoteTagResponse = z.infer<typeof noteTagSchema>;
export type SnippetFragment = z.infer<typeof snippetFragmentSchema>;
export type NoteResponse = z.infer<typeof noteResponseSchema>;
export type NoteListItemResponse = z.infer<typeof noteListItemSchema>;
export type NoteListResponse = z.infer<typeof noteListResponseSchema>;
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>;
export type TagResponse = z.infer<typeof tagResponseSchema>;
export type TagListResponse = z.infer<typeof tagListResponseSchema>;
