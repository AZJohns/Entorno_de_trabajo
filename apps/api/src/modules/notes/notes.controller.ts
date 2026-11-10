/**
 * Controladores HTTP de las notas y las etiquetas: validan la entrada con los esquemas compartidos, llaman
 * al servicio y dan forma a la respuesta. Sin lógica de negocio ni SQL.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  createNoteRequestSchema,
  listNotesQuerySchema,
  renameTagRequestSchema,
  updateNoteRequestSchema,
  type NoteListItemResponse,
  type NoteListResponse,
  type NoteResponse,
  type TagResponse,
} from '@backoffice/shared';
import type { NoteListItem, NotePage, NotesService, NoteView } from './notes.service.ts';
import type { TagsService } from './tags.service.ts';
import type { TagWithCount } from './tags.repository.ts';

const idSchema = z.uuid();

/** Un identificador que no es un UUID da 400 (lo convierte el gestor central de errores). */
const idParam = (value: unknown): string => idSchema.parse(value);

export function noteDto(note: NoteView): NoteResponse {
  return {
    id: note.id,
    title: note.title,
    bodyMd: note.bodyMd,
    tags: note.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function noteListItemDto(note: NoteListItem): NoteListItemResponse {
  return {
    id: note.id,
    title: note.title,
    preview: note.preview,
    tags: note.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    snippet:
      note.snippet === null ? null : note.snippet.map(({ text, match }) => ({ text, match })),
  };
}

function pageDto(page: NotePage): NoteListResponse {
  return { items: page.items.map(noteListItemDto), nextCursor: page.nextCursor };
}

export function tagDto(tag: TagWithCount): TagResponse {
  return { id: tag.id, name: tag.name, noteCount: tag.noteCount };
}

export function createNotesController(service: NotesService) {
  const list: RequestHandler = async (req, res) => {
    res.json(pageDto(await service.list(listNotesQuerySchema.parse(req.query))));
  };
  const get: RequestHandler = async (req, res) => {
    res.json(noteDto(await service.get(idParam(req.params['id']))));
  };
  const create: RequestHandler = async (req, res) => {
    res.status(201).json(noteDto(await service.create(createNoteRequestSchema.parse(req.body))));
  };
  const update: RequestHandler = async (req, res) => {
    const input = updateNoteRequestSchema.parse(req.body);
    res.json(noteDto(await service.update(idParam(req.params['id']), input)));
  };
  const remove: RequestHandler = async (req, res) => {
    await service.delete(idParam(req.params['id']));
    res.status(204).end();
  };
  return { list, get, create, update, remove };
}

export function createTagsController(service: TagsService) {
  const list: RequestHandler = async (_req, res) => {
    res.json({ items: (await service.list()).map(tagDto) });
  };
  const rename: RequestHandler = async (req, res) => {
    const { name } = renameTagRequestSchema.parse(req.body);
    res.json(tagDto(await service.rename(idParam(req.params['id']), name)));
  };
  return { list, rename };
}
