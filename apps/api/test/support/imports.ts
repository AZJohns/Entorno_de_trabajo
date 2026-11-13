/**
 * Utilidades de los tests de la API de importaciones: limpieza, categorías de la fixture y subida.
 */
import { expect } from 'vitest';
import type { Kysely } from 'kysely';
import { importUploadResponseSchema, type ImportUploadResponse } from '@backoffice/shared';
import type { Database } from '../../src/db/schema.ts';
import { FIXTURE_CATEGORIES, FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import type { TestClient } from './client.ts';
import { createCategory, resetLedger } from './ledger.ts';

export const IMPORTS = '/api/v1/imports';
export const UPLOAD = `${IMPORTS}/plan-excel`;
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Borra los lotes y el libro (las categorías). La autenticación la limpia `useAuthTestContext`. */
export async function resetImports(db: Kysely<Database>): Promise<void> {
  // Las fotos del plan referencian sus lotes (RESTRICT): `resetLedger` las borra antes que las categorías.
  await resetLedger(db);
  await db.deleteFrom('import_batches').execute();
}

/** Crea las categorías de gasto de la fixture para que ninguna línea quede sin correspondencia. */
export async function createFixtureCategories(client: TestClient): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const name of FIXTURE_CATEGORIES) {
    ids[name] = (await createCategory(client, 'expense', { name })).id;
  }
  return ids;
}

export function uploadUrl(options: { month?: string; fileName?: string } = {}): string {
  const query = new URLSearchParams({
    month: options.month ?? FIXTURE_MONTH,
    fileName: options.fileName ?? 'plan-ficticio.xlsx',
  });
  return `${UPLOAD}?${query.toString()}`;
}

/** Sube el archivo y exige un 201 con la forma del esquema compartido. */
export async function uploadOk(
  client: TestClient,
  bytes: Buffer,
  options: { month?: string; fileName?: string } = {},
): Promise<ImportUploadResponse> {
  const res = await client.postBinary(uploadUrl(options), bytes, XLSX_TYPE);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return importUploadResponseSchema.parse(res.body);
}
