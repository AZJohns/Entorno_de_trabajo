/**
 * Utilidades de los tests de tareas: limpieza, altas, lectura del tablero y la comprobación de que las
 * posiciones son consecutivas leyendo directamente la base de datos. Títulos inventados.
 */
import { expect } from 'vitest';
import type { Kysely } from 'kysely';
import {
  TASK_STATUSES,
  moveTaskResponseSchema,
  taskBoardResponseSchema,
  taskResponseSchema,
  type TaskResponse,
  type TaskStatus,
} from '@backoffice/shared';
import type { Database } from '../../src/db/schema.ts';
import type { TestClient } from './client.ts';

export const TASKS = '/api/v1/tasks';

/** Borra tareas y tiempo (las entradas caen en cascada). La autenticación la limpia `useAuthTestContext`. */
export async function resetTasks(db: Kysely<Database>): Promise<void> {
  await db.deleteFrom('tasks').execute();
}

export async function addTask(
  client: TestClient,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<TaskResponse> {
  const res = await client.post(TASKS, { title, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return taskResponseSchema.parse(res.body);
}

/** Crea varias tareas en la misma columna, en el orden dado. */
export async function addTasks(
  client: TestClient,
  titles: readonly string[],
  status: TaskStatus = 'todo',
): Promise<TaskResponse[]> {
  const tasks: TaskResponse[] = [];
  for (const title of titles) tasks.push(await addTask(client, title, { status }));
  return tasks;
}

export async function readBoard(client: TestClient) {
  const res = await client.get(TASKS);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return taskBoardResponseSchema.parse(res.body);
}

/** Títulos de cada columna, en el orden en que los devuelve la API. */
export async function titlesByColumn(client: TestClient): Promise<Record<TaskStatus, string[]>> {
  const board = await readBoard(client);
  const result: Record<TaskStatus, string[]> = { todo: [], in_progress: [], testing: [], done: [] };
  for (const column of board.columns) result[column.status] = column.tasks.map((t) => t.title);
  return result;
}

export function moveTask(client: TestClient, id: string, body: Record<string, unknown>) {
  return client.post(`${TASKS}/${id}/move`, body);
}

export async function moveOk(client: TestClient, id: string, body: Record<string, unknown>) {
  const res = await moveTask(client, id, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return moveTaskResponseSchema.parse(res.body);
}

/**
 * Lee `tasks` directamente y comprueba el invariante del tablero: en cada columna las posiciones son
 * exactamente 0..n-1, sin huecos ni repetidos. Devuelve los identificadores de cada columna en orden.
 */
export async function expectConsecutivePositions(
  db: Kysely<Database>,
): Promise<Record<TaskStatus, string[]>> {
  const rows = await db
    .selectFrom('tasks')
    .select(['id', 'status', 'position'])
    .orderBy('status')
    .orderBy('position')
    .execute();
  const result: Record<TaskStatus, string[]> = { todo: [], in_progress: [], testing: [], done: [] };
  for (const status of TASK_STATUSES) {
    const column = rows.filter((row) => row.status === status);
    expect(
      column.map((row) => row.position),
      `posiciones de «${status}»`,
    ).toEqual(column.map((_, index) => index));
    result[status] = column.map((row) => row.id);
  }
  return result;
}
