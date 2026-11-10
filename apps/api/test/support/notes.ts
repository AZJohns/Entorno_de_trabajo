/**
 * Utilidades de los tests de notas: limpieza, altas y lectura por la API. Textos inventados.
 */
import { expect } from 'vitest';
import type { Kysely } from 'kysely';
import {
  noteListResponseSchema,
  noteResponseSchema,
  type NoteListResponse,
  type NoteResponse,
} from '@backoffice/shared';
import type { Database } from '../../src/db/schema.ts';
import type { TestClient } from './client.ts';

export const NOTES = '/api/v1/notes';
export const TAGS = '/api/v1/tags';

/** Borra notas y etiquetas (los enlaces caen en cascada). La autenticación la limpia `useAuthTestContext`. */
export async function resetNotes(db: Kysely<Database>): Promise<void> {
  await db.deleteFrom('notes').execute();
  await db.deleteFrom('tags').execute();
}

export async function addNote(
  client: TestClient,
  title: string,
  bodyMd = '',
  tags: readonly string[] = [],
): Promise<NoteResponse> {
  const res = await client.post(NOTES, { title, bodyMd, tags });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return noteResponseSchema.parse(res.body);
}

/** Lista con los parámetros dados; comprueba que la respuesta cumple el esquema compartido. */
export async function listNotes(
  client: TestClient,
  params: Record<string, string | number> = {},
): Promise<NoteListResponse> {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
  );
  const res = await client.get(`${NOTES}?${query.toString()}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return noteListResponseSchema.parse(res.body);
}

/** Títulos de una búsqueda, en el orden devuelto. */
export async function searchTitles(client: TestClient, q: string): Promise<string[]> {
  return (await listNotes(client, { q })).items.map((item) => item.title);
}
