/**
 * Lectura del plan (`GET /plan/*`, fase 3b.2 PR 2) contra la base de datos real. Los valores esperados son
 * los de `apps/api/test/fixtures/plan-ficticio-v2.expected.md` («Resultados de los cálculos»), calculados a
 * mano antes del código y copiados aquí como literales: no se calculan con el código bajo prueba.
 * Archivos y datos FICTICIOS.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  planBudgetResponseSchema,
  planChecksResponseSchema,
  planDashboardResponseSchema,
  planGoalsResponseSchema,
  planProjectionResponseSchema,
  planScenariosResponseSchema,
  planSnapshotResponseSchema,
  planSnapshotsResponseSchema,
  type PlanDashboardResponse,
} from '@backoffice/shared';
import { buildValidWorkbook, DATA_ROW, DATOS } from '../fixtures/plan-workbook.ts';
import { useAuthTestContext } from '../support/auth.ts';
import { IMPORTS, resetImports, uploadOk } from '../support/imports.ts';
import { expectProblem } from '../support/ledger.ts';
import { MONTH, PLAN, importFixturePlan, monthUrl } from '../support/plan.ts';
import type { TestClient } from '../support/client.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetImports(getCtx().database.db);
});

const CALCULATED = ['budget', 'projection', 'goals', 'scenarios', 'checks', 'dashboard'] as const;

async function dashboardOf(client: TestClient) {
  const res = await client.get(monthUrl(MONTH, 'dashboard'));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return planDashboardResponseSchema.parse(res.body);
}

describe('GET /plan/months/:month/dashboard con plan-ficticio-v2.xlsx', () => {
  it('devuelve los valores de plan-ficticio-v2.expected.md', async () => {
    const client = await getCtx().loggedIn();
    const snapshotId = await importFixturePlan(client);
    const dashboard = await dashboardOf(client);

    expect(dashboard.snapshotId).toBe(snapshotId);
    expect(dashboard.month).toBe('2026-11');
    expect(dashboard.currentMonth).toBe('2026-11');

    // Presupuesto (§9.2): I, G, M, tasa de ahorro, E y % de líneas confirmadas.
    expect(dashboard.budget).toMatchObject({
      incomeCents: 280_000,
      expensesCents: 142_500,
      marginCents: 137_500,
      savingsRate: { numerator: 137_500, denominator: 280_000 },
      essentialCents: 133_000,
      includedLineCount: 7,
      confirmedLineCount: 2,
      confirmedShare: { numerator: 2, denominator: 7 },
    });
    // Líneas en el orden de la hoja: [concepto, mensual, anual, estado].
    expect(
      dashboard.budget.lines.map((line) => [
        line.concept,
        line.monthlyCents,
        line.annualCents,
        line.status,
        line.included,
        line.incomeShare,
      ]),
    ).toEqual([
      ['Alquiler', 80_000, 960_000, 'confirmed', true, { numerator: 80_000, denominator: 280_000 }],
      [
        'Electricidad',
        6_000,
        72_000,
        'estimated',
        true,
        { numerator: 6_000, denominator: 280_000 },
      ],
      [
        'Supermercado',
        35_000,
        420_000,
        'to_confirm',
        true,
        { numerator: 35_000, denominator: 280_000 },
      ],
      [
        'Abono de transporte',
        4_000,
        48_000,
        'pending',
        true,
        { numerator: 4_000, denominator: 280_000 },
      ],
      [
        'Seguro anual',
        2_500,
        30_000,
        'provisional',
        true,
        { numerator: 2_500, denominator: 280_000 },
      ],
      [
        'Suscripciones',
        3_000,
        36_000,
        'to_confirm_paid',
        true,
        { numerator: 3_000, denominator: 280_000 },
      ],
      [
        'Cuota del préstamo',
        12_000,
        144_000,
        'confirmed',
        true,
        { numerator: 12_000, denominator: 280_000 },
      ],
    ]);

    // Proyección (§9.3): [mes, P_k, flujo, inicial, final], todos del plan y sin aviso.
    expect(
      dashboard.projection.map((row) => [
        row.month,
        row.eventsCents,
        row.flowCents,
        row.openingCents,
        row.closingCents,
      ]),
    ).toEqual([
      ['2026-11', 9_000, 128_500, 650_000, 778_500],
      ['2026-12', 0, 137_500, 778_500, 916_000],
      ['2027-01', 0, 137_500, 916_000, 1_053_500],
      ['2027-02', 45_000, 92_500, 1_053_500, 1_146_000],
      ['2027-03', 0, 137_500, 1_146_000, 1_283_500],
      ['2027-04', 0, 137_500, 1_283_500, 1_421_000],
      ['2027-05', 0, 137_500, 1_421_000, 1_558_500],
      ['2027-06', 0, 137_500, 1_558_500, 1_696_000],
      ['2027-07', 0, 137_500, 1_696_000, 1_833_500],
      ['2027-08', 45_000, 92_500, 1_833_500, 1_926_000],
      ['2027-09', 0, 137_500, 1_926_000, 2_063_500],
      ['2027-10', 0, 137_500, 2_063_500, 2_201_000],
    ]);
    expect(dashboard.projection.map((row) => row.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(dashboard.projection.every((row) => row.source === 'plan' && row.warning === null)).toBe(
      true,
    );
    expect(dashboard.projection[0]?.flowRate).toEqual({ numerator: 128_500, denominator: 280_000 });

    // Metas (§9.4): [nombre, objetivo, actual, pendiente, aportación, meses, estado].
    expect(
      dashboard.goals.items.map((goal) => [
        goal.name,
        goal.kind,
        goal.targetCents,
        goal.currentCents,
        goal.remainingCents,
        goal.contributionCents,
        goal.monthsToGoal,
        goal.status,
      ]),
    ).toEqual([
      ['Viaje', 'fixed_amount', 300_000, 100_000, 200_000, 15_000, 14, 'in_progress'],
      [
        'Fondo de emergencia',
        'emergency_fund',
        798_000,
        500_000,
        298_000,
        20_000,
        15,
        'in_progress',
      ],
      ['Meta ya completada', 'fixed_amount', 50_000, 50_000, 0, 0, 0, 'completed'],
      ['Meta sin aportación', 'fixed_amount', 200_000, 30_000, 170_000, 0, null, 'paused'],
    ]);
    expect(dashboard.goals.capacity).toEqual({
      contributionsCents: 35_000,
      marginCents: 137_500,
      unallocatedCents: 102_500,
      ok: true,
    });

    // Escenarios (§9.5): [nombre, extra, puntual, salida total, caja libre, tasa libre, lectura].
    expect(
      dashboard.scenarios.map((scenario) => [
        scenario.name,
        scenario.extraCents,
        scenario.oneOffCents,
        scenario.totalOutflowCents,
        scenario.freeCashCents,
        scenario.freeRate,
        scenario.reading,
      ]),
    ).toEqual([
      [
        'Escenario base',
        0,
        0,
        142_500,
        137_500,
        { numerator: 137_500, denominator: 280_000 },
        'high',
      ],
      [
        'Con curso',
        8_000,
        0,
        150_500,
        129_500,
        { numerator: 129_500, denominator: 280_000 },
        'high',
      ],
      [
        'Con extras y reparación',
        12_500,
        60_000,
        215_000,
        65_000,
        { numerator: 65_000, denominator: 280_000 },
        'moderate',
      ],
      [
        'Con luz duplicada',
        6_000,
        0,
        148_500,
        131_500,
        { numerator: 131_500, denominator: 280_000 },
        'high',
      ],
    ]);

    // Comprobaciones (§9.6): siete, en este orden; estado global PASS WITH WARNINGS.
    expect(dashboard.checks.overall).toBe('PASS_WITH_WARNINGS');
    expect(
      dashboard.checks.items.map((check) => [
        check.code,
        check.severity,
        check.passed,
        check.subjects.length,
      ]),
    ).toEqual([
      ['CONTRIBUTIONS_EXCEED_MARGIN', 'FAIL', true, 0],
      ['NEGATIVE_MARGIN', 'FAIL', true, 0],
      ['ESSENTIAL_NOT_CONFIRMED', 'WARN', false, 2],
      ['NEGATIVE_FINAL_BALANCE', 'WARN', true, 0],
      ['EXPENSE_NOT_BUDGETED', 'WARN', true, 0],
      ['SCENARIO_ITEM_ALREADY_IN_BASE', 'WARN', false, 1],
      ['EVENT_ITEM_ALREADY_IN_BASE', 'WARN', false, 1],
    ]);
    // Las dos líneas esenciales sin confirmar son Electricidad y Supermercado.
    const essential = dashboard.checks.items[2]?.subjects ?? [];
    expect(
      dashboard.budget.lines
        .filter((line) => essential.includes(line.lineId))
        .map((line) => line.concept),
    ).toEqual(['Electricidad', 'Supermercado']);
  });
});

describe('cada endpoint calculado', () => {
  it('devuelve lo mismo que su parte del dashboard, con la misma cabecera', async () => {
    const client = await getCtx().loggedIn();
    await importFixturePlan(client);
    const dashboard: PlanDashboardResponse = await dashboardOf(client);
    const header = {
      snapshotId: dashboard.snapshotId,
      month: dashboard.month,
      currentMonth: dashboard.currentMonth,
    };

    const get = async (rest: string) => {
      const res = await client.get(monthUrl(MONTH, rest));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as unknown;
    };
    expect(planBudgetResponseSchema.parse(await get('budget'))).toEqual({
      ...header,
      budget: dashboard.budget,
    });
    expect(planProjectionResponseSchema.parse(await get('projection'))).toEqual({
      ...header,
      projection: dashboard.projection,
    });
    expect(planGoalsResponseSchema.parse(await get('goals'))).toEqual({
      ...header,
      goals: dashboard.goals,
    });
    expect(planScenariosResponseSchema.parse(await get('scenarios'))).toEqual({
      ...header,
      scenarios: dashboard.scenarios,
    });
    expect(planChecksResponseSchema.parse(await get('checks'))).toEqual({
      ...header,
      checks: dashboard.checks,
    });
  });
});

describe('fotos y entradas', () => {
  it('GET /plan/months/:month y /plan/snapshots/:id dan las entradas de las cinco hojas', async () => {
    const client = await getCtx().loggedIn();
    const snapshotId = await importFixturePlan(client);

    const byMonth = await client.get(monthUrl(MONTH));
    expect(byMonth.status, JSON.stringify(byMonth.body)).toBe(200);
    const snapshot = planSnapshotResponseSchema.parse(byMonth.body);
    expect(snapshot).toMatchObject({
      id: snapshotId,
      month: '2026-11',
      status: 'active',
      templateVersion: 2,
      supersededAt: null,
    });
    expect(snapshot.items).toHaveLength(24);
    expect(snapshot.budgetLines).toHaveLength(7);
    expect(snapshot.events).toHaveLength(5);
    expect(snapshot.goals).toHaveLength(4);
    expect(snapshot.scenarios).toHaveLength(4);
    // Orden de la hoja: la primera fila de Datos es la 6 (Salario neto, 250.000 céntimos).
    expect(snapshot.items[0]).toMatchObject({
      sourceRow: 6,
      amountCents: 250_000,
      status: 'confirmed',
    });
    // El evento cuota × plazo guarda las dos referencias y ningún literal.
    const loan = snapshot.events.find((event) => event.multiplierItemId !== null);
    expect(loan).toMatchObject({
      amountCents: null,
      expectedDate: '2028-05-01',
      includeInProjection: true,
    });

    const byId = await client.get(`${PLAN}/snapshots/${snapshotId}`);
    expect(byId.status).toBe(200);
    expect(planSnapshotResponseSchema.parse(byId.body)).toEqual(snapshot);
  });

  it('una foto sustituida sale por su id y en el historial, pero no es la del mes', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const first = await importFixturePlan(client);

    // Otro instante: el historial ordena por creación y dos fotos del mismo instante no tienen orden.
    ctx.t.clock.advance(60_000);
    const changed = buildValidWorkbook();
    changed.sheet(DATOS).set(`C${String(DATA_ROW.electricity)}`, 65);
    const upload = await uploadOk(client, changed.toBuffer());
    const confirmed = await client.post(`${IMPORTS}/${upload.id}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
    const second = (confirmed.body as { snapshotId: string }).snapshotId;
    expect(second).not.toBe(first);

    // El mes y todos los endpoints calculados usan la nueva.
    const month = planSnapshotResponseSchema.parse((await client.get(monthUrl(MONTH))).body);
    expect(month).toMatchObject({ id: second, status: 'active' });
    expect((await dashboardOf(client)).snapshotId).toBe(second);
    // Electricidad pasó de 60 a 65 €: el gasto pasa de 142.500 a 143.000.
    expect((await dashboardOf(client)).budget.expensesCents).toBe(143_000);

    // La anterior sigue ahí, sustituida.
    const old = await client.get(`${PLAN}/snapshots/${first}`);
    expect(old.status).toBe(200);
    expect(planSnapshotResponseSchema.parse(old.body)).toMatchObject({
      id: first,
      status: 'superseded',
    });
    expect(planSnapshotResponseSchema.parse(old.body).supersededAt).not.toBeNull();

    // Historial: las dos, la última creada primero.
    const list = await client.get(`${PLAN}/snapshots?from=2026-01&to=2026-12`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const items = planSnapshotsResponseSchema.parse(list.body).items;
    expect(items.map((entry) => [entry.id, entry.status])).toEqual([
      [second, 'active'],
      [first, 'superseded'],
    ]);
  });

  it('el historial se limita al rango pedido', async () => {
    const client = await getCtx().loggedIn();
    await importFixturePlan(client);
    for (const [from, to, expected] of [
      ['2026-11', '2026-11', 1],
      ['2026-12', '2027-03', 0],
      ['2026-01', '2026-10', 0],
      ['2025-12', '2027-12', 1],
    ] as const) {
      const res = await client.get(`${PLAN}/snapshots?from=${from}&to=${to}`);
      expect(planSnapshotsResponseSchema.parse(res.body).items, `${from}..${to}`).toHaveLength(
        expected,
      );
    }
  });
});

describe('404: no hay foto vigente', () => {
  it('un mes sin foto da 404 en la foto y en todos los endpoints calculados', async () => {
    const client = await getCtx().loggedIn();
    await importFixturePlan(client);
    // El mes siguiente tiene foto vigente en otro momento, pero aquí no hay ninguna: no se «hereda» la anterior.
    for (const rest of ['', ...CALCULATED]) {
      expectProblem(await client.get(monthUrl('2026-12', rest)), 404, 'NOT_FOUND');
    }
  });

  it('un mes cuya única foto está sustituida da 404, pero su id sigue sirviéndola', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const snapshotId = await importFixturePlan(client);
    await ctx.database.db
      .updateTable('plan_snapshots')
      .set({ status: 'superseded', superseded_at: ctx.t.clock.now() })
      .where('id', '=', snapshotId)
      .execute();
    for (const rest of ['', ...CALCULATED]) {
      expectProblem(await client.get(monthUrl(MONTH, rest)), 404, 'NOT_FOUND');
    }
    expect((await client.get(`${PLAN}/snapshots/${snapshotId}`)).status).toBe(200);
  });

  it('un id que no existe da 404', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(`${PLAN}/snapshots/${MISSING_ID}`), 404, 'NOT_FOUND');
  });
});

describe('validación', () => {
  it.each([
    ['mes mal escrito', 'months/2026-1'],
    ['mes 13', 'months/2026-13'],
    ['mes con día', 'months/2026-11-01'],
    ['año 0000', 'months/0000-05'],
    ['mes mal escrito en un cálculo', 'months/2026-1/dashboard'],
    ['id que no es un UUID', 'snapshots/no-es-un-id'],
    ['historial sin parámetros', 'snapshots'],
    ['historial sin «to»', 'snapshots?from=2026-01'],
    ['historial con mes mal escrito', 'snapshots?from=2026-1&to=2026-12'],
    ['historial con rango invertido', 'snapshots?from=2026-12&to=2026-01'],
    ['historial con parámetro desconocido', 'snapshots?from=2026-01&to=2026-12&x=1'],
    ['historial desde el año 0000', 'snapshots?from=0000-12&to=0001-01'],
  ])('400 con %s', async (_name, path) => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(`${PLAN}/${path}`), 400, 'VALIDATION_ERROR');
  });

  it('un rango de más de 60 meses da 422; 60 meses justos, 200', async () => {
    const client = await getCtx().loggedIn();
    const tooBig = await client.get(`${PLAN}/snapshots?from=2020-01&to=2025-01`);
    expectProblem(tooBig, 422, 'UNPROCESSABLE');
    expect(JSON.stringify(tooBig.body)).toContain('60');
    expect((await client.get(`${PLAN}/snapshots?from=2020-01&to=2024-12`)).status).toBe(200);
  });
});

describe('sin sesión', () => {
  it.each([
    'snapshots?from=2026-01&to=2026-12',
    `snapshots/${MISSING_ID}`,
    ...['', ...CALCULATED].map((rest) =>
      rest === '' ? 'months/2026-11' : `months/2026-11/${rest}`,
    ),
  ])('401 en GET /plan/%s', async (path) => {
    const res = await getCtx().client().get(`${PLAN}/${path}`);
    expect(res.status).toBe(401);
  });
});
