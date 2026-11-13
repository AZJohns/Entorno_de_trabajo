/**
 * Caducidad de las vistas previas a las 24 h (docs/plan.md §3.6) con un reloj controlado y sin pasar por la
 * sesión HTTP (que caduca por inactividad a 1 h): el límite exacto, el trabajo periódico registrado en
 * `createJobs` y lo que ese trabajo no debe tocar. Archivos FICTICIOS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import type { RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/db/schema.ts';
import { createJobs } from '../../src/jobs/index.ts';
import { runJobsOnce } from '../../src/jobs/scheduler.ts';
import { createFinanceModule } from '../../src/modules/finance/index.ts';
import { createImportsModule } from '../../src/modules/imports/index.ts';
import { PREVIEW_TTL_MS } from '../../src/modules/imports/imports.service.ts';
import { buildValidWorkbook, FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import type { WorkbookBuilder } from '../fixtures/xlsx-builder.ts';
import { FakeClock } from '../support/clock.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';

let database: TestDatabase;
let db: Kysely<Database>;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await database.drop();
}, DB_TIMEOUT_MS);

beforeEach(async () => {
  await db.deleteFrom('import_batches').execute();
});

const passThrough: RequestHandler = (_req, _res, next) => {
  next();
};

function setup() {
  const clock = new FakeClock();
  const finance = createFinanceModule({
    db,
    clock,
    requireReauth: passThrough,
    recordExport: () => Promise.resolve(),
  });
  const { imports } = createImportsModule({
    db,
    clock,
    categories: finance.ledger,
    budgets: finance.budgets,
    plan: finance.plan,
    requireReauth: passThrough,
  });
  return { clock, imports };
}

type Imports = ReturnType<typeof setup>['imports'];

async function upload(imports: Imports, book: WorkbookBuilder = buildValidWorkbook()) {
  const { response } = await imports.uploadPlanExcel({
    bytes: book.toBuffer(),
    fileName: 'plan-ficticio.xlsx',
    month: FIXTURE_MONTH,
  });
  return response;
}

async function statusOf(id: string): Promise<string> {
  const row = await db
    .selectFrom('import_batches')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.status;
}

describe('caducidad a las 24 h', () => {
  it('el límite es exacto: 1 ms antes sigue vigente y a las 24 h ya caducó', async () => {
    const { clock, imports } = setup();
    const { id } = await upload(imports);
    const row = await db
      .selectFrom('import_batches')
      .select(['created_at', 'expires_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(PREVIEW_TTL_MS);
    expect(PREVIEW_TTL_MS).toBe(24 * 60 * 60 * 1000);

    clock.advance(PREVIEW_TTL_MS - 1);
    const almost = await imports.get(id);
    expect(almost.status).toBe('preview');
    expect(almost.extracted).not.toBeNull();

    clock.advance(1);
    const exactly = await imports.get(id);
    expect(exactly.status).toBe('expired');
    expect(exactly.extracted).toBeNull();
    expect(exactly.summary.canConfirm).toBe(false);
    // Caducada, tampoco se confirma ni se decide sobre ella.
    await expect(imports.confirm(id)).rejects.toMatchObject({
      status: 409,
      errors: [{ path: 'IMPORT_EXPIRED' }],
    });
    await expect(
      imports.updateDecisions(id, {
        categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
      }),
    ).rejects.toMatchObject({ status: 409, errors: [{ path: 'IMPORT_EXPIRED' }] });
  });

  it('el trabajo `caducidad-de-importaciones` está en createJobs y marca expired y vacía las entradas', async () => {
    const { clock, imports } = setup();
    const { id } = await upload(imports);
    const logger = pino({ level: 'silent' });
    const job = createJobs({ db, clock, logger }).find(
      (candidate) => candidate.name === 'caducidad-de-importaciones',
    );
    expect(job).toBeDefined();
    const jobs = job === undefined ? [] : [job];

    // Antes del límite no hace nada.
    clock.advance(PREVIEW_TTL_MS - 1);
    await runJobsOnce(jobs, logger);
    expect(await statusOf(id)).toBe('preview');

    clock.advance(1);
    await runJobsOnce(jobs, logger);
    const row = await db
      .selectFrom('import_batches')
      .select(['status', 'extracted'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'expired', extracted: null });
  });

  it('el trabajo no toca los lotes descartados ni los fallidos aunque haya pasado su fecha', async () => {
    const { clock, imports } = setup();
    const preview = await upload(imports);
    const toDiscard = buildValidWorkbook();
    toDiscard.sheet('Presupuesto').set('B6', 'Alquiler (otro contenido)');
    const discarded = await upload(imports, toDiscard);
    await imports.discard(discarded.id);
    const withoutSheet = buildValidWorkbook();
    withoutSheet.removeSheet('Metas');
    const failed = await upload(imports, withoutSheet);
    expect(failed.status).toBe('failed');

    clock.advance(PREVIEW_TTL_MS + 1000);
    expect(await imports.expireStalePreviews()).toBe(1);
    expect(await statusOf(preview.id)).toBe('expired');
    expect(await statusOf(discarded.id)).toBe('discarded');
    expect(await statusOf(failed.id)).toBe('failed');
    // Idempotente.
    expect(await imports.expireStalePreviews()).toBe(0);
  });
});
