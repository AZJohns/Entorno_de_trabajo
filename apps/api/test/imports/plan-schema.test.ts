/**
 * Restricciones de la capa del plan (migración 0010) en la base de datos real: lo que la aplicación no puede
 * saltarse aunque tenga un fallo. Cada caso estropea UNA cosa de una fila válida. Datos FICTICIOS.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { centsFromDb } from '../../src/db/cents.ts';
import { isReferencedRowError, isUniqueViolation } from '../../src/db/errors.ts';
import type { Database } from '../../src/db/schema.ts';
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

const NOW = new Date('2026-11-03T09:00:00Z');
const LATER = new Date('2026-11-04T09:00:00Z');

beforeEach(async () => {
  await db.deleteFrom('category_budgets').execute();
  await db.deleteFrom('plan_category_mappings').execute();
  await db.deleteFrom('plan_snapshots').execute();
  await db.deleteFrom('import_batches').execute();
  await db.deleteFrom('categories').execute();
});

// --- datos de apoyo ----------------------------------------------------------------------------------

async function newBatch(month = '2026-11-01'): Promise<string> {
  const row = await db
    .insertInto('import_batches')
    .values({
      kind: 'plan_excel',
      month,
      file_name: 'plan.xlsx',
      file_size_bytes: 1000,
      file_sha256: randomBytes(32),
      content_hash: randomBytes(32),
      template_version: 2,
      status: 'preview',
      extracted: '{}',
      issues: '[]',
      created_at: NOW,
      expires_at: LATER,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Una foto vigente válida (con su lote). */
async function newSnapshot(month = '2026-11-01', overrides: Record<string, unknown> = {}) {
  const row = await db
    .insertInto('plan_snapshots')
    .values({
      month,
      import_batch_id: await newBatch(month),
      content_hash: randomBytes(32),
      template_version: 2,
      status: 'active',
      created_at: NOW,
      ...overrides,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function newCategory(kind: 'expense' | 'income', name = 'Categoría'): Promise<string> {
  const row = await db
    .insertInto('categories')
    .values({ kind, name: `${name} ${randomBytes(3).toString('hex')}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

let nextRow = 6;
const item = (snapshotId: string, overrides: Record<string, unknown> = {}) => ({
  snapshot_id: snapshotId,
  source_row: nextRow++,
  record_type: 'expense',
  group_label: 'Grupo',
  concept: 'Concepto',
  unit: 'eur_per_month',
  amount_cents: 1000,
  quantity_hundredths: null,
  nature: 'recurring',
  status: 'confirmed',
  source_note: null,
  note: null,
  ...overrides,
});

async function newItem(snapshotId: string, overrides: Record<string, unknown> = {}) {
  const row = await db
    .insertInto('plan_items')
    .values(item(snapshotId, overrides))
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Comprueba que la base de datos rechaza la inserción, y por qué restricción si se indica. */
async function expectRejected(run: () => Promise<unknown>, constraint?: RegExp): Promise<void> {
  if (constraint === undefined) {
    await expect(run()).rejects.toThrow();
  } else {
    await expect(run()).rejects.toThrow(constraint);
  }
}

// --- plan_snapshots ----------------------------------------------------------------------------------

describe('plan_snapshots', () => {
  it('admite una foto válida', async () => {
    const id = await newSnapshot();
    const row = await db
      .selectFrom('plan_snapshots')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('active');
    expect(row.superseded_at).toBeNull();
  });

  it.each([
    ['un mes que no es el día 1', { month: '2026-11-15' }],
    ['un hash de contenido de otra longitud', { content_hash: Buffer.alloc(16) }],
    ['la plantilla v1', { template_version: 1 }],
    ['un estado desconocido', { status: 'borrada' }],
    ['una foto sustituida sin fecha de sustitución', { status: 'superseded' }],
    ['una fecha de sustitución en una foto vigente', { superseded_at: LATER }],
    [
      'una sustitución anterior a la creación',
      { status: 'superseded', superseded_at: new Date('2026-11-02T00:00:00Z') },
    ],
  ])('rechaza %s', async (_name, overrides) => {
    await expectRejected(() => newSnapshot('2026-11-01', overrides));
  });

  it('solo puede haber una foto vigente por mes, pero sí varias sustituidas', async () => {
    await newSnapshot('2026-11-01');
    await expect(newSnapshot('2026-11-01')).rejects.toSatisfy((error) =>
      isUniqueViolation(error, 'plan_snapshots_active_month_key'),
    );
    await newSnapshot('2026-12-01'); // otro mes, bien
    await newSnapshot('2026-11-01', { status: 'superseded', superseded_at: LATER });
    await newSnapshot('2026-11-01', { status: 'superseded', superseded_at: LATER });
  });

  it('el mismo contenido no puede ser dos fotos del mismo mes (ni una sustituida)', async () => {
    const hash = randomBytes(32);
    await newSnapshot('2026-11-01', {
      content_hash: hash,
      status: 'superseded',
      superseded_at: LATER,
    });
    await expect(newSnapshot('2026-11-01', { content_hash: hash })).rejects.toSatisfy((error) =>
      isUniqueViolation(error, 'plan_snapshots_month_content_key'),
    );
    await newSnapshot('2026-12-01', { content_hash: hash }); // otro mes, bien
  });

  it('un lote da una sola foto', async () => {
    const batchId = await newBatch();
    const values = {
      month: '2026-11-01',
      import_batch_id: batchId,
      content_hash: randomBytes(32),
      template_version: 2,
      status: 'superseded' as const,
      created_at: NOW,
      superseded_at: LATER,
    };
    await db.insertInto('plan_snapshots').values(values).execute();
    await expect(
      db
        .insertInto('plan_snapshots')
        .values({ ...values, content_hash: randomBytes(32) })
        .execute(),
    ).rejects.toSatisfy((error) => isUniqueViolation(error));
  });

  it('el lote de una foto no se borra (RESTRICT) y un lote inexistente no vale', async () => {
    const id = await newSnapshot();
    const { import_batch_id: batchId } = await db
      .selectFrom('plan_snapshots')
      .select('import_batch_id')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    await expect(
      db.deleteFrom('import_batches').where('id', '=', batchId).execute(),
    ).rejects.toSatisfy((error) => isReferencedRowError(error));
    await expectRejected(() =>
      db
        .insertInto('plan_snapshots')
        .values({
          month: '2026-12-01',
          import_batch_id: '00000000-0000-4000-8000-000000000000',
          content_hash: randomBytes(32),
          template_version: 2,
          status: 'active',
        })
        .execute(),
    );
  });

  it('borrar la foto borra todas sus filas (CASCADE), también las referenciadas entre sí', async () => {
    const snapshotId = await newSnapshot();
    const categoryId = await newCategory('expense');
    const itemId = await newItem(snapshotId);
    const monthsId = await newItem(snapshotId, {
      unit: 'months',
      amount_cents: null,
      quantity_hundredths: 600,
      record_type: 'assumption',
    });
    await db
      .insertInto('plan_budget_lines')
      .values({
        snapshot_id: snapshotId,
        source_row: 6,
        category_id: categoryId,
        category_label: 'Vivienda',
        concept: 'Alquiler',
        cost_type: 'fixed',
        essential: true,
        plan_item_id: itemId,
      })
      .execute();
    await db
      .insertInto('plan_events')
      .values({
        snapshot_id: snapshotId,
        source_row: 6,
        concept: 'Cuota × plazo',
        amount_item_id: itemId,
        multiplier_item_id: monthsId,
        status: 'active',
        include_in_projection: false,
      })
      .execute();
    const scenario = await db
      .insertInto('plan_scenarios')
      .values({ snapshot_id: snapshotId, source_row: 6, name: 'Escenario' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('plan_scenario_items')
      .values({
        scenario_id: scenario.id,
        snapshot_id: snapshotId,
        plan_item_id: itemId,
        role: 'extra_monthly',
      })
      .execute();

    await db.deleteFrom('plan_snapshots').where('id', '=', snapshotId).execute();
    for (const table of [
      'plan_items',
      'plan_budget_lines',
      'plan_events',
      'plan_goals',
      'plan_scenarios',
      'plan_scenario_items',
    ] as const) {
      const rows = await db
        .selectFrom(table)
        .select(sql<number>`1`.as('one'))
        .execute();
      expect(rows, table).toHaveLength(0);
    }
  });
});

// --- plan_items --------------------------------------------------------------------------------------

describe('plan_items', () => {
  it.each([
    ['una fila de Excel anterior a la 6', { source_row: 5 }],
    ['un tipo de registro desconocido', { record_type: 'otro' }],
    ['un grupo vacío', { group_label: '' }],
    ['un concepto vacío', { concept: '' }],
    ['una unidad desconocida', { unit: 'usd' }],
    ['una naturaleza desconocida', { nature: 'rara' }],
    ['un estado desconocido', { status: 'quizás' }],
    ['un importe negativo', { amount_cents: -1 }],
    ['una unidad en € sin importe', { amount_cents: null }],
    ['una unidad en € con meses', { quantity_hundredths: 100 }],
    ['meses con importe', { unit: 'months', quantity_hundredths: 600 }],
    ['meses sin cantidad', { unit: 'months', amount_cents: null, quantity_hundredths: null }],
    [
      'meses negativos',
      { unit: 'months', amount_cents: null, quantity_hundredths: -100, record_type: 'assumption' },
    ],
  ])('rechaza %s', async (_name, overrides) => {
    const snapshotId = await newSnapshot();
    await expectRejected(() => newItem(snapshotId, overrides));
  });

  it('no repite la fila del Excel dentro de una foto, pero sí entre fotos', async () => {
    const a = await newSnapshot('2026-11-01');
    const b = await newSnapshot('2026-12-01');
    await newItem(a, { source_row: 40 });
    await expect(newItem(a, { source_row: 40 })).rejects.toSatisfy((error) =>
      isUniqueViolation(error, 'plan_items_snapshot_row_key'),
    );
    await newItem(b, { source_row: 40 });
  });

  it('como mucho una fila de «Meses de fondo de emergencia» por foto', async () => {
    const a = await newSnapshot('2026-11-01');
    const b = await newSnapshot('2026-12-01');
    const months = {
      record_type: 'emergency_fund_months',
      unit: 'months',
      amount_cents: null,
      quantity_hundredths: 600,
    };
    await newItem(a, months);
    await expect(newItem(a, months)).rejects.toSatisfy((error) =>
      isUniqueViolation(error, 'plan_items_emergency_months_key'),
    );
    await newItem(b, months);
  });

  it('el importe es un bigint exacto: más de 32 bits y hasta el entero seguro de JavaScript', async () => {
    const snapshotId = await newSnapshot();
    const big = 3_000_000_055; // 30.000.000,55 €: no cabe en un entero de 32 bits
    const safe = Number.MAX_SAFE_INTEGER; // 9.007.199.254.740.991 céntimos
    const bigId = await newItem(snapshotId, { amount_cents: big });
    const safeId = await newItem(snapshotId, { amount_cents: safe });
    const read = async (id: string) =>
      (
        await db
          .selectFrom('plan_items')
          .select('amount_cents')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).amount_cents;
    // `pg` entrega el bigint como cadena: exacta, sin pasar por un número de coma flotante.
    expect(await read(bigId)).toBe('3000000055');
    expect(await read(safeId)).toBe('9007199254740991');
    expect(centsFromDb((await read(safeId)) ?? '')).toBe(safe);
  });

  it('un importe por encima del entero seguro se guarda exacto, pero nunca se lee redondeado', async () => {
    const snapshotId = await newSnapshot();
    const id = await newItem(snapshotId, { amount_cents: 1 });
    // 2^53 + 1: un `number` lo redondearía a 2^53. La base de datos lo conserva...
    await sql`UPDATE plan_items SET amount_cents = 9007199254740993 WHERE id = ${id}`.execute(db);
    const { amount_cents: stored } = await db
      .selectFrom('plan_items')
      .select('amount_cents')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored).toBe('9007199254740993');
    // ...y la conversión a céntimos lo rechaza en lugar de perder precisión.
    expect(() => centsFromDb(stored ?? '')).toThrow(RangeError);
  });
});

// --- plan_budget_lines -------------------------------------------------------------------------------

describe('plan_budget_lines', () => {
  const line = (
    snapshotId: string,
    categoryId: string,
    itemId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    snapshot_id: snapshotId,
    source_row: nextRow++,
    category_id: categoryId,
    category_label: 'Vivienda',
    concept: 'Alquiler',
    cost_type: 'fixed',
    essential: true,
    plan_item_id: itemId,
    ...overrides,
  });
  const insertLine = (values: ReturnType<typeof line>) =>
    db.insertInto('plan_budget_lines').values(values).execute();

  it('admite una línea válida', async () => {
    const snapshotId = await newSnapshot();
    await insertLine(line(snapshotId, await newCategory('expense'), await newItem(snapshotId)));
  });

  it('impide una categoría de ingreso o inexistente (clave compuesta con kind = expense)', async () => {
    const snapshotId = await newSnapshot();
    const itemId = await newItem(snapshotId);
    await expectRejected(() =>
      insertLine(line(snapshotId, '00000000-0000-4000-8000-000000000000', itemId)),
    );
    await expect(insertLine(line(snapshotId, await newCategory('income'), itemId))).rejects.toThrow(
      /plan_budget_lines_category_expense_fkey/u,
    );
  });

  it('impide un tipo `kind` distinto de expense', async () => {
    const snapshotId = await newSnapshot();
    const itemId = await newItem(snapshotId);
    const categoryId = await newCategory('income');
    await expectRejected(() =>
      db
        .insertInto('plan_budget_lines')
        .values({
          ...line(snapshotId, categoryId, itemId),
          kind: 'income' as unknown as 'expense',
        })
        .execute(),
    );
  });

  it('impide apuntar a una fila de Datos de otra foto', async () => {
    const a = await newSnapshot('2026-11-01');
    const b = await newSnapshot('2026-12-01');
    const itemOfB = await newItem(b);
    await expect(insertLine(line(a, await newCategory('expense'), itemOfB))).rejects.toThrow(
      /plan_budget_lines_item_fkey/u,
    );
  });

  it('no se puede borrar una fila de Datos a la que apunta una línea (NO ACTION)', async () => {
    const snapshotId = await newSnapshot();
    const itemId = await newItem(snapshotId);
    await insertLine(line(snapshotId, await newCategory('expense'), itemId));
    await expect(db.deleteFrom('plan_items').where('id', '=', itemId).execute()).rejects.toSatisfy(
      (error) => isReferencedRowError(error),
    );
  });

  it('no se borra una categoría con líneas del plan (RESTRICT)', async () => {
    const snapshotId = await newSnapshot();
    const categoryId = await newCategory('expense');
    await insertLine(line(snapshotId, categoryId, await newItem(snapshotId)));
    await expect(
      db.deleteFrom('categories').where('id', '=', categoryId).execute(),
    ).rejects.toSatisfy((error) => isReferencedRowError(error));
  });

  it.each([
    ['un tipo de coste desconocido', { cost_type: 'raro' }],
    ['una categoría sin texto', { category_label: '' }],
    ['un concepto vacío', { concept: '' }],
    ['una fila anterior a la 6', { source_row: 5 }],
  ])('rechaza %s', async (_name, overrides) => {
    const snapshotId = await newSnapshot();
    await expectRejected(async () =>
      insertLine(
        line(snapshotId, await newCategory('expense'), await newItem(snapshotId), overrides),
      ),
    );
  });
});

// --- plan_events -------------------------------------------------------------------------------------

describe('plan_events', () => {
  const event = (snapshotId: string, overrides: Record<string, unknown> = {}) => ({
    snapshot_id: snapshotId,
    source_row: nextRow++,
    concept: 'Evento',
    amount_cents: 9000,
    status: 'estimated',
    include_in_projection: false,
    ...overrides,
  });
  const insertEvent = (values: Record<string, unknown>) =>
    db
      .insertInto('plan_events')
      .values(values as never)
      .execute();

  it('admite un literal, una referencia y una referencia con plazo', async () => {
    const snapshotId = await newSnapshot();
    const amount = await newItem(snapshotId);
    const months = await newItem(snapshotId, {
      unit: 'months',
      amount_cents: null,
      quantity_hundredths: 1800,
      record_type: 'assumption',
    });
    await insertEvent(event(snapshotId));
    await insertEvent(event(snapshotId, { amount_cents: null, amount_item_id: amount }));
    await insertEvent(
      event(snapshotId, {
        amount_cents: null,
        amount_item_id: amount,
        multiplier_item_id: months,
        include_in_projection: true,
        expected_date: '2027-05-01',
      }),
    );
  });

  it.each([
    ['sin importe', { amount_cents: null }],
    ['un importe literal negativo', { amount_cents: -5 }],
    ['un estado desconocido', { status: 'otro' }],
    ['incluido en la proyección sin fecha', { include_in_projection: true, expected_date: null }],
    ['una fecha que no existe', { expected_date: '2026-02-30' }],
  ])('rechaza %s', async (_name, overrides) => {
    const snapshotId = await newSnapshot();
    await expectRejected(() => insertEvent(event(snapshotId, overrides)));
  });

  it('rechaza un importe que es a la vez referencia y literal', async () => {
    const snapshotId = await newSnapshot();
    await expect(
      insertEvent(event(snapshotId, { amount_item_id: await newItem(snapshotId) })),
    ).rejects.toThrow(/plan_events_amount_source/u);
  });

  it('rechaza un plazo sin referencia al importe', async () => {
    const snapshotId = await newSnapshot();
    const months = await newItem(snapshotId, {
      unit: 'months',
      amount_cents: null,
      quantity_hundredths: 600,
      record_type: 'assumption',
    });
    await expect(insertEvent(event(snapshotId, { multiplier_item_id: months }))).rejects.toThrow(
      /plan_events_multiplier_needs_reference|plan_events_amount_source/u,
    );
  });

  it('impide referencias a filas de Datos de otra foto', async () => {
    const a = await newSnapshot('2026-11-01');
    const b = await newSnapshot('2026-12-01');
    await expect(
      insertEvent(event(a, { amount_cents: null, amount_item_id: await newItem(b) })),
    ).rejects.toThrow(/plan_events_amount_item_fkey/u);
  });
});

// --- plan_goals --------------------------------------------------------------------------------------

describe('plan_goals', () => {
  const goal = (snapshotId: string, overrides: Record<string, unknown> = {}) => ({
    snapshot_id: snapshotId,
    source_row: nextRow++,
    name: 'Meta',
    goal_kind: 'fixed_amount',
    target_cents: 300000,
    current_cents: 0,
    contribution_cents: 15000,
    ...overrides,
  });
  const insertGoal = (values: Record<string, unknown>) =>
    db
      .insertInto('plan_goals')
      .values(values as never)
      .execute();

  it('admite una meta de importe fijo, y un fondo de emergencia sin objetivo', async () => {
    const snapshotId = await newSnapshot();
    const itemId = await newItem(snapshotId);
    await insertGoal(goal(snapshotId));
    await insertGoal(
      goal(snapshotId, {
        goal_kind: 'emergency_fund',
        target_cents: null,
        current_cents: null,
        current_item_id: itemId,
      }),
    );
  });

  it.each([
    ['un tipo de meta desconocido', { goal_kind: 'sueño' }],
    ['una meta de importe fijo sin objetivo', { target_cents: null }],
    ['un fondo de emergencia con objetivo', { goal_kind: 'emergency_fund' }],
    ['sin importe actual', { current_cents: null }],
    ['sin aportación', { contribution_cents: null }],
    ['un objetivo negativo', { target_cents: -1 }],
    ['una aportación negativa', { contribution_cents: -1 }],
    ['un nombre vacío', { name: '' }],
  ])('rechaza %s', async (_name, overrides) => {
    const snapshotId = await newSnapshot();
    await expectRejected(() => insertGoal(goal(snapshotId, overrides)));
  });

  it('rechaza un objetivo que es a la vez referencia y literal', async () => {
    const snapshotId = await newSnapshot();
    await expect(
      insertGoal(goal(snapshotId, { target_item_id: await newItem(snapshotId) })),
    ).rejects.toThrow(/plan_goals_target/u);
  });

  it('como mucho una meta de fondo de emergencia por foto', async () => {
    const snapshotId = await newSnapshot();
    const fund = { goal_kind: 'emergency_fund', target_cents: null };
    await insertGoal(goal(snapshotId, fund));
    await expect(insertGoal(goal(snapshotId, fund))).rejects.toSatisfy((error) =>
      isUniqueViolation(error, 'plan_goals_emergency_fund_key'),
    );
  });

  it('impide referencias a filas de Datos de otra foto', async () => {
    const a = await newSnapshot('2026-11-01');
    const b = await newSnapshot('2026-12-01');
    await expect(
      insertGoal(goal(a, { current_cents: null, current_item_id: await newItem(b) })),
    ).rejects.toThrow(/plan_goals_current_item_fkey/u);
  });
});

// --- plan_scenarios y plan_scenario_items ------------------------------------------------------------

describe('plan_scenarios y plan_scenario_items', () => {
  async function newScenario(snapshotId: string): Promise<string> {
    const row = await db
      .insertInto('plan_scenarios')
      .values({ snapshot_id: snapshotId, source_row: nextRow++, name: 'Escenario' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
  const insertEntry = (values: Record<string, unknown>) =>
    db
      .insertInto('plan_scenario_items')
      .values(values as never)
      .execute();

  it('admite la lista de filas de un escenario con sus dos roles', async () => {
    const snapshotId = await newSnapshot();
    const scenarioId = await newScenario(snapshotId);
    const itemId = await newItem(snapshotId);
    const base = { scenario_id: scenarioId, snapshot_id: snapshotId, plan_item_id: itemId };
    await insertEntry({ ...base, role: 'extra_monthly' });
    await insertEntry({ ...base, role: 'one_off' });
  });

  it('rechaza un rol desconocido y una fila repetida con el mismo rol', async () => {
    const snapshotId = await newSnapshot();
    const scenarioId = await newScenario(snapshotId);
    const itemId = await newItem(snapshotId);
    const base = { scenario_id: scenarioId, snapshot_id: snapshotId, plan_item_id: itemId };
    await expectRejected(() => insertEntry({ ...base, role: 'otro' }));
    await insertEntry({ ...base, role: 'one_off' });
    await expect(insertEntry({ ...base, role: 'one_off' })).rejects.toSatisfy((error) =>
      isUniqueViolation(error),
    );
  });

  it('impide mezclar el escenario de una foto con filas de Datos de otra', async () => {
    const a = await newSnapshot('2026-11-01');
    const b = await newSnapshot('2026-12-01');
    const scenarioOfA = await newScenario(a);
    await expect(
      insertEntry({
        scenario_id: scenarioOfA,
        snapshot_id: a,
        plan_item_id: await newItem(b),
        role: 'extra_monthly',
      }),
    ).rejects.toThrow(/plan_scenario_items_item_fkey/u);
    await expect(
      insertEntry({
        scenario_id: scenarioOfA,
        snapshot_id: b,
        plan_item_id: await newItem(b),
        role: 'extra_monthly',
      }),
    ).rejects.toThrow(/plan_scenario_items_scenario_fkey/u);
  });

  it('borrar un escenario borra su lista (CASCADE) y no toca las filas de Datos', async () => {
    const snapshotId = await newSnapshot();
    const scenarioId = await newScenario(snapshotId);
    const itemId = await newItem(snapshotId);
    await insertEntry({
      scenario_id: scenarioId,
      snapshot_id: snapshotId,
      plan_item_id: itemId,
      role: 'extra_monthly',
    });
    await db.deleteFrom('plan_scenarios').where('id', '=', scenarioId).execute();
    expect(await db.selectFrom('plan_scenario_items').selectAll().execute()).toHaveLength(0);
    expect(await db.selectFrom('plan_items').selectAll().execute()).toHaveLength(1);
  });
});

// --- plan_category_mappings --------------------------------------------------------------------------

describe('plan_category_mappings', () => {
  const insertMapping = (name: string, categoryId: string) =>
    db
      .insertInto('plan_category_mappings')
      .values({ source_name_normalized: name, category_id: categoryId })
      .execute();

  it('admite una categoría de gasto y no repite el nombre', async () => {
    const categoryId = await newCategory('expense');
    await insertMapping('ocio', categoryId);
    await expect(insertMapping('ocio', categoryId)).rejects.toSatisfy((error) =>
      isUniqueViolation(error),
    );
  });

  it('rechaza una categoría de ingreso, una inexistente y nombres no normalizados', async () => {
    await expect(insertMapping('ocio', await newCategory('income'))).rejects.toThrow(
      /plan_category_mappings_category_expense_fkey/u,
    );
    await expectRejected(() => insertMapping('ocio', '00000000-0000-4000-8000-000000000000'));
    const categoryId = await newCategory('expense');
    await expectRejected(() => insertMapping('', categoryId));
    await expectRejected(() => insertMapping(' ocio', categoryId));
    await expectRejected(() => insertMapping('a'.repeat(201), categoryId));
  });

  it('no se borra una categoría con una correspondencia (RESTRICT)', async () => {
    const categoryId = await newCategory('expense');
    await insertMapping('ocio', categoryId);
    await expect(
      db.deleteFrom('categories').where('id', '=', categoryId).execute(),
    ).rejects.toSatisfy((error) => isReferencedRowError(error));
  });
});

// --- import_batches ----------------------------------------------------------------------------------

describe('import_batches (ampliado en la 0010)', () => {
  it('un lote confirmado no conserva las entradas extraídas', async () => {
    const batchId = await newBatch();
    await expect(
      db
        .updateTable('import_batches')
        .set({ status: 'confirmed', confirmed_at: NOW })
        .where('id', '=', batchId)
        .execute(),
    ).rejects.toThrow(/import_batches_confirmed_without_extracted/u);
    await db
      .updateTable('import_batches')
      .set({ status: 'confirmed', confirmed_at: NOW, extracted: null })
      .where('id', '=', batchId)
      .execute();
  });
});

// --- category_budgets.source_snapshot_id -------------------------------------------------------------

describe('category_budgets.source_snapshot_id (origen de los presupuestos importados)', () => {
  const insertBudget = (categoryId: string, month: string, sourceSnapshotId: string | undefined) =>
    db
      .insertInto('category_budgets')
      .values({
        month,
        category_id: categoryId,
        amount_cents: 1000,
        ...(sourceSnapshotId === undefined ? {} : { source_snapshot_id: sourceSnapshotId }),
      })
      .execute();
  const sourceOf = async (categoryId: string) =>
    (
      await db
        .selectFrom('category_budgets')
        .select('source_snapshot_id')
        .where('category_id', '=', categoryId)
        .executeTakeFirstOrThrow()
    ).source_snapshot_id;

  it('un presupuesto manual no lleva origen (por defecto NULL)', async () => {
    const categoryId = await newCategory('expense');
    await insertBudget(categoryId, '2026-11-01', undefined);
    expect(await sourceOf(categoryId)).toBeNull();
  });

  it('admite como origen una foto del mismo mes', async () => {
    const snapshotId = await newSnapshot('2026-11-01');
    const categoryId = await newCategory('expense');
    await insertBudget(categoryId, '2026-11-01', snapshotId);
    expect(await sourceOf(categoryId)).toBe(snapshotId);
  });

  it('rechaza como origen una foto de otro mes o que no existe', async () => {
    const december = await newSnapshot('2026-12-01');
    const categoryId = await newCategory('expense');
    await expect(insertBudget(categoryId, '2026-11-01', december)).rejects.toThrow(
      /category_budgets_source_snapshot_fkey/u,
    );
    await expectRejected(() =>
      insertBudget(categoryId, '2026-11-01', '00000000-0000-4000-8000-000000000000'),
    );
  });

  it('si la foto desaparece, el presupuesto se conserva y pasa a manual (SET NULL, sin tocar el mes)', async () => {
    const snapshotId = await newSnapshot('2026-11-01');
    const categoryId = await newCategory('expense');
    await insertBudget(categoryId, '2026-11-01', snapshotId);
    await db.deleteFrom('plan_snapshots').where('id', '=', snapshotId).execute();
    const row = await db
      .selectFrom('category_budgets')
      .select(['month', 'source_snapshot_id', 'amount_cents'])
      .where('category_id', '=', categoryId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ month: '2026-11-01', source_snapshot_id: null, amount_cents: '1000' });
  });
});
