/**
 * Utilidades de los tests de la API del plan (`/plan/*`): importar y confirmar la fixture ficticia
 * `plan-ficticio-v2.xlsx` y las rutas. Todo con datos FICTICIOS.
 */
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { confirmImportResponseSchema } from '@backoffice/shared';
import { FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import type { TestClient } from './client.ts';
import { IMPORTS, createFixtureCategories, uploadOk } from './imports.ts';

export const PLAN = '/api/v1/plan';
export const MONTH = FIXTURE_MONTH;

const FIXTURE = readFileSync(new URL('../fixtures/plan-ficticio-v2.xlsx', import.meta.url));

/** `/plan/months/:month/<rest>` (sin `rest`, la foto vigente). */
export const monthUrl = (month: string, rest = ''): string =>
  `${PLAN}/months/${month}${rest === '' ? '' : `/${rest}`}`;

/**
 * Sube y confirma `plan-ficticio-v2.xlsx` (mes 2026-11) con las categorías de gasto de la fixture.
 * @returns el identificador de la foto vigente creada.
 */
export async function importFixturePlan(
  client: TestClient,
  options: { createCategories?: boolean } = {},
): Promise<string> {
  if (options.createCategories ?? true) await createFixtureCategories(client);
  const upload = await uploadOk(client, FIXTURE);
  expect(upload.summary.canConfirm).toBe(true);
  const res = await client.post(`${IMPORTS}/${upload.id}/confirm`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return confirmImportResponseSchema.parse(res.body).snapshotId;
}
