/**
 * Confirmación de la importación y decisiones (`PATCH /imports/:id/decisions`, `POST /imports/:id/confirm`):
 * contra la base de datos real. Cubre la transacción única (rollback), la doble confirmación secuencial y
 * concurrente, el presupuesto por categoría (nunca se sobrescribe), las correspondencias persistentes, la
 * caducidad y los códigos 400/404/409/422. Archivos FICTICIOS generados desde el contrato.
 */
import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  confirmImportResponseSchema,
  importDetailResponseSchema,
  problemDetailsSchema,
  type ConfirmImportResponse,
} from '@backoffice/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/db/schema.ts';
import { createImportsMaintenance } from '../../src/modules/imports/index.ts';
import { normalizeKey } from '../../src/modules/imports/domain/normalize.ts';
import { buildValidWorkbook, CHECKS, DATA_ROW, DATOS } from '../fixtures/plan-workbook.ts';
import type { WorkbookBuilder } from '../fixtures/xlsx-builder.ts';
import { useAuthTestContext } from '../support/auth.ts';
import {
  IMPORTS,
  XLSX_TYPE,
  createFixtureCategories,
  resetImports,
  uploadOk,
  uploadUrl,
} from '../support/imports.ts';
import { createCategory, expectProblem } from '../support/ledger.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const MONTH = '2026-11';
const FIRST_OF_MONTH = '2026-11-01';

beforeEach(async () => {
  await resetImports(getCtx().database.db);
});

// --- utilidades ---------------------------------------------------------------------------------------

const confirmUrl = (id: string): string => `${IMPORTS}/${id}/confirm`;
const decisionsUrl = (id: string): string => `${IMPORTS}/${id}/decisions`;

/** Cliente con sesión, las categorías de la fixture y un lote en vista previa listo para confirmar. */
async function readyBatch(book: WorkbookBuilder = buildValidWorkbook()) {
  const client = await getCtx().loggedIn();
  const categories = await createFixtureCategories(client);
  const upload = await uploadOk(client, book.toBuffer());
  expect(upload.summary.canConfirm).toBe(true);
  return { client, categories, id: upload.id };
}

function parseConfirm(res: { status: number; body: unknown }): ConfirmImportResponse {
  return confirmImportResponseSchema.parse(res.body);
}

/** Recuento de filas de cada tabla que escribe una confirmación. */
async function counts(db: Kysely<Database>) {
  const count = async (
    table:
      | 'plan_snapshots'
      | 'plan_items'
      | 'plan_budget_lines'
      | 'plan_events'
      | 'plan_goals'
      | 'plan_scenarios'
      | 'plan_scenario_items'
      | 'category_budgets'
      | 'plan_category_mappings',
  ): Promise<number> =>
    (
      await db
        .selectFrom(table)
        .select(sql<number>`1`.as('one'))
        .execute()
    ).length;
  return {
    snapshots: await count('plan_snapshots'),
    items: await count('plan_items'),
    budgetLines: await count('plan_budget_lines'),
    events: await count('plan_events'),
    goals: await count('plan_goals'),
    scenarios: await count('plan_scenarios'),
    scenarioItems: await count('plan_scenario_items'),
    budgets: await count('category_budgets'),
    mappings: await count('plan_category_mappings'),
  };
}

const EMPTY_COUNTS = {
  snapshots: 0,
  items: 0,
  budgetLines: 0,
  events: 0,
  goals: 0,
  scenarios: 0,
  scenarioItems: 0,
  budgets: 0,
  mappings: 0,
};

async function batchRow(db: Kysely<Database>, id: string) {
  return db.selectFrom('import_batches').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

/** El lote no cambió: sigue en vista previa, con sus entradas y sin fecha de confirmación. */
async function expectStillPreview(db: Kysely<Database>, id: string): Promise<void> {
  const row = await batchRow(db, id);
  expect(row.status).toBe('preview');
  expect(row.extracted).not.toBeNull();
  expect(row.confirmed_at).toBeNull();
}

// --- confirmar: camino feliz --------------------------------------------------------------------------

describe('confirmar', () => {
  it('crea la foto con todas sus filas, rellena el presupuesto y deja el lote confirmado', async () => {
    const ctx = getCtx();
    const { client, categories, id } = await readyBatch();
    const res = await client.post(confirmUrl(id));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = parseConfirm(res);
    expect(body.budgets).toEqual({ created: 7, omitted: 0 });

    const db = ctx.database.db;
    expect(await counts(db)).toEqual({
      snapshots: 1,
      items: 24,
      budgetLines: 7,
      events: 5,
      goals: 4,
      scenarios: 4,
      scenarioItems: expect.any(Number) as number,
      budgets: 7,
      mappings: 0, // sin decisiones del usuario no hay nada que recordar
    });
    const snapshot = await db.selectFrom('plan_snapshots').selectAll().executeTakeFirstOrThrow();
    expect(snapshot).toMatchObject({
      id: body.snapshotId,
      import_batch_id: id,
      month: FIRST_OF_MONTH,
      status: 'active',
      template_version: 2,
      superseded_at: null,
    });
    const batch = await batchRow(db, id);
    expect(batch.status).toBe('confirmed');
    expect(batch.confirmed_at).toEqual(ctx.t.clock.now());
    // Las entradas viven ya en las tablas del plan: el lote las suelta.
    expect(batch.extracted).toBeNull();
    expect(Buffer.compare(snapshot.content_hash, batch.content_hash ?? Buffer.alloc(0))).toBe(0);

    // La respuesta de lectura lo refleja y ya no enseña entradas.
    const detail = importDetailResponseSchema.parse((await client.get(`${IMPORTS}/${id}`)).body);
    expect(detail.status).toBe('confirmed');
    expect(detail.extracted).toBeNull();
    expect(detail.summary.canConfirm).toBe(false);

    // Presupuesto por categoría: lo que dice la fixture (Alquiler 800 €, Electricidad 60 €…).
    const budgets = await db
      .selectFrom('category_budgets')
      .select(['category_id', 'amount_cents', 'month'])
      .execute();
    const byCategory = new Map(budgets.map((row) => [row.category_id, row.amount_cents]));
    expect(budgets.every((row) => row.month === FIRST_OF_MONTH)).toBe(true);
    expect(byCategory.get(categories['Vivienda'] ?? '')).toBe('80000');
    expect(byCategory.get(categories['Suministros'] ?? '')).toBe('6000');
    expect(byCategory.get(categories['Alimentación'] ?? '')).toBe('35000');
    expect(byCategory.get(categories['Transporte'] ?? '')).toBe('4000');
    expect(byCategory.get(categories['Seguros'] ?? '')).toBe('2500');
    expect(byCategory.get(categories['Ocio'] ?? '')).toBe('3000');
    expect(byCategory.get(categories['Préstamos'] ?? '')).toBe('12000');
  });

  it('las referencias entre hojas se conservan por fila de Datos de la misma foto', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    expect((await client.post(confirmUrl(id))).status).toBe(201);
    const db = ctx.database.db;
    // La línea de Alquiler apunta a la fila de Datos 8 (Alquiler, 800 €/mes).
    const rent = await db
      .selectFrom('plan_budget_lines as l')
      .innerJoin('plan_items as i', (join) =>
        join.onRef('i.id', '=', 'l.plan_item_id').onRef('i.snapshot_id', '=', 'l.snapshot_id'),
      )
      .select(['l.concept', 'i.source_row', 'i.amount_cents', 'i.status'])
      .where('l.source_row', '=', 6)
      .executeTakeFirstOrThrow();
    expect(rent).toEqual({
      concept: 'Alquiler',
      source_row: DATA_ROW.rent,
      amount_cents: '80000',
      status: 'confirmed',
    });
    // El evento «cuota × plazo» guarda las dos referencias y ningún importe literal.
    const loan = await db
      .selectFrom('plan_events')
      .select(['amount_item_id', 'multiplier_item_id', 'amount_cents', 'expected_date'])
      .where('concept', '=', 'Préstamo total')
      .executeTakeFirstOrThrow();
    expect(loan.amount_item_id).not.toBeNull();
    expect(loan.multiplier_item_id).not.toBeNull();
    expect(loan.amount_cents).toBeNull();
    expect(loan.expected_date).toBe('2028-05-01');
    // Lo calculado no se guarda: ninguna tabla del plan tiene columnas de totales o estados calculados.
    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name LIKE 'plan\\_%' ESCAPE '\\'
    `.execute(db);
    const names = columns.rows.map((row) => row.column_name);
    expect(
      names.filter((name) => /total|balance|projection(?!$)|result|margin/u.test(name)),
    ).toEqual([]);
  });

  it('agrupa por categoría las líneas que la comparten y deja fuera las que no cuentan en el plan base', async () => {
    const ctx = getCtx();
    const book = buildValidWorkbook();
    // «Suministros» pasa a «Vivienda» (800 + 60 €) y «Seguros» queda en una fila de Datos pausada (0 €).
    book.sheet('Presupuesto').set('A7', 'Vivienda');
    book.sheet(DATOS).set(`F${String(DATA_ROW.insurance)}`, 'Pausado');
    const { client, categories, id } = await readyBatch(book);
    const res = await client.post(confirmUrl(id));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(parseConfirm(res).budgets).toEqual({ created: 5, omitted: 1 });
    const budgets = await ctx.database.db.selectFrom('category_budgets').selectAll().execute();
    const byCategory = new Map(budgets.map((row) => [row.category_id, row.amount_cents]));
    expect(byCategory.get(categories['Vivienda'] ?? '')).toBe('86000');
    expect(byCategory.has(categories['Suministros'] ?? '')).toBe(false);
    expect(byCategory.has(categories['Seguros'] ?? '')).toBe(false); // 0 €: sin fila, no una fila a 0
  });

  it('importes con céntimos y por encima de 32 bits se guardan exactos', async () => {
    const ctx = getCtx();
    const book = buildValidWorkbook();
    const datos = book.sheet(DATOS);
    datos.set(`C${String(DATA_ROW.rent)}`, 30_000_000.55); // 3.000.000.055 céntimos
    datos.set(`C${String(DATA_ROW.electricity)}`, 0.07); // 0,07 × 100 no es exacto en coma flotante
    const { client, categories, id } = await readyBatch(book);
    expect((await client.post(confirmUrl(id))).status).toBe(201);
    const db = ctx.database.db;
    const read = async (row: number) =>
      (
        await db
          .selectFrom('plan_items')
          .select('amount_cents')
          .where('source_row', '=', row)
          .executeTakeFirstOrThrow()
      ).amount_cents;
    expect(await read(DATA_ROW.rent)).toBe('3000000055');
    expect(await read(DATA_ROW.electricity)).toBe('7');
    const budget = await db
      .selectFrom('category_budgets')
      .select('amount_cents')
      .where('category_id', '=', categories['Vivienda'] ?? '')
      .executeTakeFirstOrThrow();
    expect(budget.amount_cents).toBe('3000000055');
  });
});

// --- doble confirmación -------------------------------------------------------------------------------

describe('doble confirmación', () => {
  it('secuencial: la segunda devuelve 200 con el mismo snapshotId y no duplica nada', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    const first = await client.post(confirmUrl(id));
    expect(first.status).toBe(201);
    const after = await counts(ctx.database.db);
    const second = await client.post(confirmUrl(id));
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(parseConfirm(second).snapshotId).toBe(parseConfirm(first).snapshotId);
    // El primer 201 cuenta qué hizo con el presupuesto; el 200 no lo repite (sería un dato derivado).
    expect(parseConfirm(second).budgets).toBeNull();
    expect(await counts(ctx.database.db)).toEqual(after);
  });

  it('concurrente: una crea (201) y la otra recibe el mismo resultado (200), sin duplicados', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    const results = await Promise.all(Array.from({ length: 4 }, () => client.post(confirmUrl(id))));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses, JSON.stringify(results.map((res) => res.body as unknown))).toEqual([
      200, 200, 200, 201,
    ]);
    const ids = new Set(results.map((res) => parseConfirm(res).snapshotId));
    expect(ids.size).toBe(1);
    const total = await counts(ctx.database.db);
    expect(total).toMatchObject({ snapshots: 1, items: 24, budgetLines: 7, budgets: 7 });
  });

  it('dos lotes del mismo contenido: el segundo no crea nada y apunta a la misma foto', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    // Mismos datos con otros bytes (una celda suelta en una hoja que no se lee): otro lote, mismo contenido.
    const other = buildValidWorkbook();
    other.sheet(CHECKS).set('Z99', 'otro guardado');
    const second = await uploadOk(client, other.toBuffer());
    expect(second.id).not.toBe(id);
    const first = parseConfirm(await client.post(confirmUrl(id)));
    const again = await client.post(confirmUrl(second.id));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(parseConfirm(again).snapshotId).toBe(first.snapshotId);
    expect(await counts(ctx.database.db)).toMatchObject({ snapshots: 1, items: 24, budgets: 7 });
    // El segundo lote no se toca: no se crea ni se cambia nada.
    await expectStillPreview(ctx.database.db, second.id);
  });

  it('dos contenidos distintos a la vez para el mismo mes: solo uno gana y el otro no deja nada', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await createFixtureCategories(client);
    const a = await uploadOk(client, buildValidWorkbook().toBuffer());
    const changed = buildValidWorkbook();
    changed.sheet(DATOS).set(`C${String(DATA_ROW.electricity)}`, 65);
    const b = await uploadOk(client, changed.toBuffer());
    const results = await Promise.all([
      client.post(confirmUrl(a.id)),
      client.post(confirmUrl(b.id)),
    ]);
    // Se serializan por mes: la primera crea la foto; la segunda la sustituiría, pero el presupuesto de
    // la primera ya existe y no se sobrescribe, así que da 409 y no escribe nada.
    expect(
      results.map((res) => res.status).sort(),
      JSON.stringify(results.map((res) => res.body as unknown)),
    ).toEqual([201, 409]);
    const db = ctx.database.db;
    expect(await counts(db)).toMatchObject({ snapshots: 1, items: 24, budgets: 7 });
    const active = await db
      .selectFrom('plan_snapshots')
      .select(['status', 'import_batch_id'])
      .execute();
    expect(active).toHaveLength(1);
    expect(active[0]?.status).toBe('active');
    const loser = [a.id, b.id].find((candidate) => candidate !== active[0]?.import_batch_id);
    await expectStillPreview(db, loser ?? '');
  });
});

// --- reglas del estado --------------------------------------------------------------------------------

describe('confirmar: estado del lote', () => {
  it('un lote que no existe es 404', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.post(confirmUrl(MISSING_ID)), 404, 'NOT_FOUND');
  });

  it('un identificador mal formado es 400', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.post(confirmUrl('no-es-un-uuid')), 400, 'VALIDATION_ERROR');
  });

  it('con errores sin resolver (categorías sin correspondencia) es 409 y no escribe nada', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const upload = await uploadOk(client, buildValidWorkbook().toBuffer());
    expect(upload.summary.canConfirm).toBe(false);
    const res = await client.post(confirmUrl(upload.id));
    expectProblem(res, 409, 'CONFLICT');
    const problem = problemDetailsSchema.parse(res.body);
    expect(problem.errors?.[0]?.path).toBe('IMPORT_HAS_ERRORS');
    expect(problem.errors).toHaveLength(7);
    expect(await counts(ctx.database.db)).toEqual(EMPTY_COUNTS);
    await expectStillPreview(ctx.database.db, upload.id);
  });

  it('un libro con la estructura inválida (lote failed) es 409', async () => {
    const client = await getCtx().loggedIn();
    const book = buildValidWorkbook();
    book.removeSheet('Metas');
    const upload = await uploadOk(client, book.toBuffer());
    expect(upload.status).toBe('failed');
    const res = await client.post(confirmUrl(upload.id));
    expectProblem(res, 409, 'CONFLICT');
    expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe('IMPORT_NOT_PREVIEW');
  });

  it('un lote descartado es 409', async () => {
    const { client, id } = await readyBatch();
    expect((await client.delete(`${IMPORTS}/${id}`)).status).toBe(204);
    const res = await client.post(confirmUrl(id));
    expectProblem(res, 409, 'CONFLICT');
    expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe('IMPORT_NOT_PREVIEW');
  });

  it('una vista previa caducada es 409, también antes de que el trabajo periódico la marque', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    const db = ctx.database.db;
    const past = new Date(ctx.t.clock.now().getTime() - 1000);
    await db
      .updateTable('import_batches')
      .set({ expires_at: past, created_at: new Date(past.getTime() - 1000) })
      .where('id', '=', id)
      .execute();
    const res = await client.post(confirmUrl(id));
    expectProblem(res, 409, 'CONFLICT');
    expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe('IMPORT_EXPIRED');
    expect(await counts(db)).toEqual(EMPTY_COUNTS);
    // El trabajo periódico la marca `expired` y vacía las entradas; repetirlo no cambia nada.
    const maintenance = createImportsMaintenance({ db, clock: ctx.t.clock });
    expect(await maintenance.expireStalePreviews()).toBe(1);
    expect(await maintenance.expireStalePreviews()).toBe(0);
    const row = await batchRow(db, id);
    expect(row.status).toBe('expired');
    expect(row.extracted).toBeNull();
  });

  it('el trabajo de caducidad no toca las vistas previas vigentes ni los lotes confirmados', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    expect((await client.post(confirmUrl(id))).status).toBe(201);
    const maintenance = createImportsMaintenance({ db: ctx.database.db, clock: ctx.t.clock });
    expect(await maintenance.expireStalePreviews()).toBe(0);
    expect((await batchRow(ctx.database.db, id)).status).toBe('confirmed');
  });

  it('la categoría archivada entre la vista previa y la confirmación da 409 y no escribe nada', async () => {
    const ctx = getCtx();
    const { client, categories, id } = await readyBatch();
    expect(
      (await client.post(`/api/v1/categories/${categories['Ocio'] ?? ''}/archive`)).status,
    ).toBe(200);
    expectProblem(await client.post(confirmUrl(id)), 409, 'CONFLICT');
    expect(await counts(ctx.database.db)).toEqual(EMPTY_COUNTS);
    await expectStillPreview(ctx.database.db, id);
  });
});

// --- rollback -----------------------------------------------------------------------------------------

describe('confirmar: todo en una sola transacción (ASVS 2.3.3)', () => {
  it('un presupuesto que ya existe da 409 DESPUÉS de escribir la foto, y no queda nada de la foto', async () => {
    const ctx = getCtx();
    const { client, categories, id } = await readyBatch();
    const existing = await client.post('/api/v1/budgets', {
      month: MONTH,
      categoryId: categories['Ocio'],
      amountCents: 1234,
    });
    expect(existing.status, JSON.stringify(existing.body)).toBe(201);
    const res = await client.post(confirmUrl(id));
    expectProblem(res, 409, 'CONFLICT');
    const problem = problemDetailsSchema.parse(res.body);
    expect(problem.errors?.map((error) => error.path)).toEqual(['BUDGET_EXISTS']);
    // Ninguna fila del plan, ni presupuestos nuevos, ni correspondencias; el lote, intacto.
    expect(await counts(ctx.database.db)).toEqual({ ...EMPTY_COUNTS, budgets: 1 });
    await expectStillPreview(ctx.database.db, id);
    // Y el presupuesto que ya había no se tocó.
    const budget = await ctx.database.db
      .selectFrom('category_budgets')
      .select('amount_cents')
      .executeTakeFirstOrThrow();
    expect(budget.amount_cents).toBe('1234');
  });

  it.each([
    [
      'al crear los presupuestos (después de las tablas del plan)',
      'CREATE TRIGGER fallo_forzado BEFORE INSERT ON category_budgets FOR EACH ROW EXECUTE FUNCTION fallo_forzado()',
    ],
    [
      'al marcar el lote como confirmado (el último paso)',
      "CREATE TRIGGER fallo_forzado BEFORE UPDATE ON import_batches FOR EACH ROW WHEN (NEW.status = 'confirmed') EXECUTE FUNCTION fallo_forzado()",
    ],
  ])('un fallo inesperado %s no deja nada escrito', async (_name, createTrigger) => {
    const ctx = getCtx();
    const db = ctx.database.db;
    // Parte de un lote cuyas categorías se resuelven con decisiones: así también hay correspondencias que
    // guardar y que deben deshacerse.
    const client = await ctx.loggedIn();
    const upload = await uploadOk(client, buildValidWorkbook().toBuffer());
    const targets = await createFixtureCategories(client);
    const decide = await client.patch(decisionsUrl(upload.id), {
      categoryMappings: Object.entries(targets).map(([name, categoryId]) => ({
        categoryKey: normalizeKey(name),
        categoryId,
      })),
    });
    expect(decide.status, JSON.stringify(decide.body)).toBe(200);

    // Un fallo forzado en la propia base de datos (no una excepción simulada en el código).
    await sql
      .raw(
        `CREATE FUNCTION fallo_forzado() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo forzado del test'; END $$`,
      )
      .execute(db);
    await sql.raw(createTrigger).execute(db);
    try {
      const res = await client.post(confirmUrl(upload.id));
      expectProblem(res, 500, 'INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('fallo forzado'); // sin detalles internos (ASVS 16.5.1)
    } finally {
      await sql.raw('DROP FUNCTION fallo_forzado() CASCADE').execute(db);
    }
    expect(await counts(db)).toEqual(EMPTY_COUNTS);
    await expectStillPreview(db, upload.id);
    // Las decisiones siguen en el lote: se puede reintentar la confirmación sin repetirlas.
    const retry = await client.post(confirmUrl(upload.id));
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
  });
});

// --- idempotencia por contenido y sustitución ----------------------------------------------------------

describe('idempotencia por contenido y sustitución', () => {
  it('subir otra vez el mismo contenido (otros bytes) devuelve 200 con el lote confirmado, sin crear lote', async () => {
    const ctx = getCtx();
    const { client, id } = await readyBatch();
    expect((await client.post(confirmUrl(id))).status).toBe(201);
    const batchesBefore = await ctx.database.db.selectFrom('import_batches').select('id').execute();

    const resaved = buildValidWorkbook();
    resaved.sheet(CHECKS).set('Z99', 'otro guardado');
    const res = await client.postBinary(uploadUrl(), resaved.toBuffer(), XLSX_TYPE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { id: string }).id).toBe(id);
    expect((res.body as { status: string }).status).toBe('confirmed');
    expect(await ctx.database.db.selectFrom('import_batches').select('id').execute()).toHaveLength(
      batchesBefore.length,
    );
  });

  it('un contenido distinto sustituye la foto: la anterior queda superseded y el historial se conserva', async () => {
    const ctx = getCtx();
    const db = ctx.database.db;
    const { client, id } = await readyBatch();
    const first = parseConfirm(await client.post(confirmUrl(id)));

    // Un mes que ya tiene presupuesto no se sobrescribe (decisión conservadora): se vacía para poder
    // probar solo la sustitución de la foto.
    await db.deleteFrom('category_budgets').execute();
    const changed = buildValidWorkbook();
    changed.sheet(DATOS).set(`C${String(DATA_ROW.electricity)}`, 65);
    const second = await uploadOk(client, changed.toBuffer());
    expect(second.id).not.toBe(id);
    const res = await client.post(confirmUrl(second.id));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const newer = parseConfirm(res);
    expect(newer.snapshotId).not.toBe(first.snapshotId);

    const snapshots = await db
      .selectFrom('plan_snapshots')
      .select(['id', 'status', 'superseded_at'])
      .orderBy('created_at')
      .execute();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.find((row) => row.id === first.snapshotId)).toMatchObject({
      status: 'superseded',
    });
    expect(snapshots.find((row) => row.id === first.snapshotId)?.superseded_at).not.toBeNull();
    expect(snapshots.find((row) => row.id === newer.snapshotId)).toMatchObject({
      status: 'active',
      superseded_at: null,
    });
    // Las filas de la foto anterior siguen ahí (24 + 24).
    expect(await counts(db)).toMatchObject({ snapshots: 2, items: 48 });
  });

  it('volver a un contenido que ya fue sustituido no lo reactiva: 409 y no escribe nada', async () => {
    const ctx = getCtx();
    const db = ctx.database.db;
    const { client, id } = await readyBatch();
    expect((await client.post(confirmUrl(id))).status).toBe(201);
    await db.deleteFrom('category_budgets').execute();
    const changed = buildValidWorkbook();
    changed.sheet(DATOS).set(`C${String(DATA_ROW.electricity)}`, 65);
    const second = await uploadOk(client, changed.toBuffer());
    expect((await client.post(confirmUrl(second.id))).status).toBe(201);
    await db.deleteFrom('category_budgets').execute();

    // El contenido original ya no es la foto vigente: se sube como una vista previa nueva...
    const back = await uploadOk(client, buildValidWorkbook().toBuffer());
    expect(back.status).toBe('preview');
    const before = await counts(db);
    const res = await client.post(confirmUrl(back.id));
    expectProblem(res, 409, 'CONFLICT');
    expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe('CONTENT_ALREADY_IMPORTED');
    expect(await counts(db)).toEqual(before);
    await expectStillPreview(db, back.id);
  });
});

// --- PATCH decisions ----------------------------------------------------------------------------------

describe('PATCH /imports/:id/decisions', () => {
  /** Lote con solo «Ocio» y «Préstamos» sin correspondencia (el resto de categorías existe). */
  async function batchWithTwoUnmapped() {
    const client = await getCtx().loggedIn();
    for (const name of ['Vivienda', 'Suministros', 'Alimentación', 'Transporte', 'Seguros']) {
      await createCategory(client, 'expense', { name });
    }
    const upload = await uploadOk(client, buildValidWorkbook().toBuffer());
    expect(upload.issues.filter((issue) => issue.code === 'CATEGORY_UNMAPPED')).toHaveLength(2);
    const entertainment = await createCategory(client, 'expense', { name: 'Entretenimiento' });
    const loans = await createCategory(client, 'expense', { name: 'Deudas' });
    return { client, id: upload.id, entertainment: entertainment.id, loans: loans.id };
  }

  it('resuelve las categorías: desaparecen los CATEGORY_UNMAPPED y el lote ya se puede confirmar', async () => {
    const { client, id, entertainment, loans } = await batchWithTwoUnmapped();
    const res = await client.patch(decisionsUrl(id), {
      categoryMappings: [
        { categoryKey: 'ocio', categoryId: entertainment },
        { categoryKey: 'prestamos', categoryId: loans },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const detail = importDetailResponseSchema.parse(res.body);
    expect(detail.summary.errors).toBe(0);
    expect(detail.summary.canConfirm).toBe(true);
    expect(detail.issues.some((issue) => issue.code === 'CATEGORY_UNMAPPED')).toBe(false);
    expect(detail.decisions.categoryMappings).toEqual({
      ocio: entertainment,
      prestamos: loans,
    });
    expect(
      detail.extracted?.budgetLines.find((line) => line.categoryKey === 'ocio')?.categoryId,
    ).toBe(entertainment);
    // La lista refleja lo mismo.
    const list = (await client.get(IMPORTS)).body as { items: { id: string; errors: number }[] };
    expect(list.items.find((item) => item.id === id)?.errors).toBe(0);

    const confirm = await client.post(confirmUrl(id));
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);
    // Al confirmar se guardan las correspondencias para los meses siguientes.
    const mappings = await getCtx()
      .database.db.selectFrom('plan_category_mappings')
      .select(['source_name_normalized', 'category_id'])
      .orderBy('source_name_normalized')
      .execute();
    expect(mappings).toEqual([
      { source_name_normalized: 'ocio', category_id: entertainment },
      { source_name_normalized: 'prestamos', category_id: loans },
    ]);
  });

  it('es un parche: lo no mencionado se conserva y `null` retira una decisión', async () => {
    const { client, id, entertainment, loans } = await batchWithTwoUnmapped();
    await client.patch(decisionsUrl(id), {
      categoryMappings: [
        { categoryKey: 'ocio', categoryId: entertainment },
        { categoryKey: 'prestamos', categoryId: loans },
      ],
    });
    const res = await client.patch(decisionsUrl(id), {
      categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const detail = importDetailResponseSchema.parse(res.body);
    expect(detail.decisions.categoryMappings).toEqual({ prestamos: loans });
    // «Ocio» vuelve a no tener correspondencia: el lote es exactamente el que se subió para esa categoría.
    expect(detail.issues.filter((issue) => issue.code === 'CATEGORY_UNMAPPED')).toHaveLength(1);
    expect(detail.summary.canConfirm).toBe(false);
    expectProblem(await client.post(confirmUrl(id)), 409, 'CONFLICT');
  });

  it('las correspondencias guardadas se reutilizan al subir otro mes', async () => {
    const { client, id, entertainment, loans } = await batchWithTwoUnmapped();
    await client.patch(decisionsUrl(id), {
      categoryMappings: [
        { categoryKey: 'ocio', categoryId: entertainment },
        { categoryKey: 'prestamos', categoryId: loans },
      ],
    });
    expect((await client.post(confirmUrl(id))).status).toBe(201);
    // Diciembre, con los mismos nombres: ya no hay nada sin correspondencia.
    const december = await uploadOk(client, buildValidWorkbook().toBuffer(), { month: '2026-12' });
    expect(december.issues.filter((issue) => issue.code === 'CATEGORY_UNMAPPED')).toEqual([]);
    expect(december.summary.canConfirm).toBe(true);
    // Si la categoría elegida se archiva, la correspondencia deja de valer y se pregunta otra vez.
    await client.post(`/api/v1/categories/${entertainment}/archive`);
    const january = await uploadOk(client, buildValidWorkbook().toBuffer(), { month: '2027-01' });
    expect(
      january.issues
        .filter((issue) => issue.code === 'CATEGORY_UNMAPPED')
        .map((issue) => issue.cell),
    ).toEqual(['A11']);
  });

  describe('400: formato incorrecto', () => {
    it.each([
      ['un cuerpo sin la lista', {}],
      ['una lista vacía', { categoryMappings: [] }],
      ['una lista que no es lista', { categoryMappings: 'ocio' }],
      [
        'un campo desconocido',
        { categoryMappings: [{ categoryKey: 'ocio', categoryId: null }], extra: 1 },
      ],
      ['una decisión sin clave', { categoryMappings: [{ categoryId: null }] }],
      ['una clave vacía', { categoryMappings: [{ categoryKey: '', categoryId: null }] }],
      [
        'una categoría que no es un uuid',
        { categoryMappings: [{ categoryKey: 'a', categoryId: '1' }] },
      ],
      [
        'un campo desconocido en la decisión',
        { categoryMappings: [{ categoryKey: 'a', categoryId: null, otro: true }] },
      ],
      [
        'más de 200 decisiones',
        {
          categoryMappings: Array.from({ length: 201 }, (_, index) => ({
            categoryKey: `k${String(index)}`,
            categoryId: null,
          })),
        },
      ],
    ])('rechaza %s', async (_name, body) => {
      const { client, id } = await batchWithTwoUnmapped();
      expectProblem(await client.patch(decisionsUrl(id), body), 400, 'VALIDATION_ERROR');
    });

    it('rechaza un identificador mal formado', async () => {
      const client = await getCtx().loggedIn();
      expectProblem(
        await client.patch(decisionsUrl('no-es-un-uuid'), {
          categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
        }),
        400,
        'VALIDATION_ERROR',
      );
    });
  });

  describe('422: decisión incoherente', () => {
    it('una clave que no está en la importación', async () => {
      const { client, id, entertainment } = await batchWithTwoUnmapped();
      const res = await client.patch(decisionsUrl(id), {
        categoryMappings: [{ categoryKey: 'no-existe', categoryId: entertainment }],
      });
      expectProblem(res, 422, 'UNPROCESSABLE');
      expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe(
        'categoryMappings.0.categoryKey',
      );
    });

    it('una categoría que no existe', async () => {
      const { client, id } = await batchWithTwoUnmapped();
      const res = await client.patch(decisionsUrl(id), {
        categoryMappings: [{ categoryKey: 'ocio', categoryId: MISSING_ID }],
      });
      expectProblem(res, 422, 'UNPROCESSABLE');
      expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe(
        'categoryMappings.0.categoryId',
      );
    });

    it('una categoría de ingreso', async () => {
      const { client, id } = await batchWithTwoUnmapped();
      const income = await createCategory(client, 'income', { name: 'Nómina' });
      expectProblem(
        await client.patch(decisionsUrl(id), {
          categoryMappings: [{ categoryKey: 'ocio', categoryId: income.id }],
        }),
        422,
        'UNPROCESSABLE',
      );
    });

    it('una categoría archivada', async () => {
      const { client, id, entertainment } = await batchWithTwoUnmapped();
      await client.post(`/api/v1/categories/${entertainment}/archive`);
      expectProblem(
        await client.patch(decisionsUrl(id), {
          categoryMappings: [{ categoryKey: 'ocio', categoryId: entertainment }],
        }),
        422,
        'UNPROCESSABLE',
      );
    });

    it('la misma clave dos veces', async () => {
      const { client, id, entertainment, loans } = await batchWithTwoUnmapped();
      const res = await client.patch(decisionsUrl(id), {
        categoryMappings: [
          { categoryKey: 'ocio', categoryId: entertainment },
          { categoryKey: 'ocio', categoryId: loans },
        ],
      });
      expectProblem(res, 422, 'UNPROCESSABLE');
      expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe(
        'categoryMappings.1.categoryKey',
      );
    });

    it('una decisión incoherente no cambia nada, ni siquiera las válidas de la misma petición', async () => {
      const { client, id, entertainment } = await batchWithTwoUnmapped();
      expectProblem(
        await client.patch(decisionsUrl(id), {
          categoryMappings: [
            { categoryKey: 'ocio', categoryId: entertainment },
            { categoryKey: 'no-existe', categoryId: entertainment },
          ],
        }),
        422,
        'UNPROCESSABLE',
      );
      const row = await batchRow(getCtx().database.db, id);
      expect(row.decisions).toEqual({});
    });
  });

  describe('409: el estado del lote lo impide', () => {
    it('un lote ya confirmado', async () => {
      const { client, id } = await readyBatch();
      expect((await client.post(confirmUrl(id))).status).toBe(201);
      const res = await client.patch(decisionsUrl(id), {
        categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
      });
      expectProblem(res, 409, 'CONFLICT');
      expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe('IMPORT_NOT_PREVIEW');
    });

    it('un lote descartado', async () => {
      const { client, id } = await readyBatch();
      await client.delete(`${IMPORTS}/${id}`);
      expectProblem(
        await client.patch(decisionsUrl(id), {
          categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
        }),
        409,
        'CONFLICT',
      );
    });

    it('un lote fallido', async () => {
      const client = await getCtx().loggedIn();
      const book = buildValidWorkbook();
      book.removeSheet('Metas');
      const upload = await uploadOk(client, book.toBuffer());
      expect(upload.status).toBe('failed');
      expectProblem(
        await client.patch(decisionsUrl(upload.id), {
          categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
        }),
        409,
        'CONFLICT',
      );
    });

    it('una vista previa caducada', async () => {
      const ctx = getCtx();
      const { client, id } = await readyBatch();
      const past = new Date(ctx.t.clock.now().getTime() - 1000);
      await ctx.database.db
        .updateTable('import_batches')
        .set({ expires_at: past, created_at: new Date(past.getTime() - 1000) })
        .where('id', '=', id)
        .execute();
      const res = await client.patch(decisionsUrl(id), {
        categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
      });
      expectProblem(res, 409, 'CONFLICT');
      expect(problemDetailsSchema.parse(res.body).errors?.[0]?.path).toBe('IMPORT_EXPIRED');
    });

    it('el estado se comprueba antes que la coherencia: confirmado + decisión absurda es 409, no 422', async () => {
      const { client, id } = await readyBatch();
      await client.post(confirmUrl(id));
      expectProblem(
        await client.patch(decisionsUrl(id), {
          categoryMappings: [{ categoryKey: 'no-existe', categoryId: MISSING_ID }],
        }),
        409,
        'CONFLICT',
      );
    });
  });

  it('404: un lote que no existe', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(
      await client.patch(decisionsUrl(MISSING_ID), {
        categoryMappings: [{ categoryKey: 'ocio', categoryId: null }],
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('una decisión sobre una categoría que ya tenía coincidencia por nombre manda sobre ella', async () => {
    const { client, categories, id } = await readyBatch();
    const other = await createCategory(client, 'expense', { name: 'Otra cosa' });
    const res = await client.patch(decisionsUrl(id), {
      categoryMappings: [{ categoryKey: 'ocio', categoryId: other.id }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(confirmImportResponseSchema.safeParse(res.body).success).toBe(false); // es el detalle, no la confirmación
    const confirm = await client.post(confirmUrl(id));
    expect(confirm.status).toBe(201);
    const budgets = await getCtx()
      .database.db.selectFrom('category_budgets')
      .select(['category_id', 'amount_cents'])
      .execute();
    const byCategory = new Map(budgets.map((row) => [row.category_id, row.amount_cents]));
    expect(byCategory.get(other.id)).toBe('3000');
    expect(byCategory.has(categories['Ocio'] ?? '')).toBe(false);
  });
});
