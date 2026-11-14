/**
 * Esquemas de la API del plan (`/plan/*`, docs/plan.md §2.10 y §3.13), compartidos por la web y la API.
 *
 * Convenciones: importes en céntimos enteros; meses `YYYY-MM`; fechas `YYYY-MM-DD`. Un porcentaje es una
 * fracción entera `{ numerator, denominator }` (o `null` si no hay ingresos): el formato lo pone la
 * presentación. Las lecturas y los estados son **códigos** (`high`, `PASS_WITH_WARNINGS`…), nunca el texto
 * que ve el usuario. Los resultados calculados no se guardan: se calculan al leer (plan.md §3.2).
 */
import { z } from 'zod';
import { budgetMonthSchema, localDateSchema } from '../finance/schemas.ts';
import {
  COST_TYPES,
  EVENT_STATUSES,
  GOAL_KINDS,
  NATURES,
  RECORD_TYPES,
  STATUSES,
  UNITS,
  type CatalogEntry,
} from './catalogs.ts';

/** Máximo de meses del rango de `/plan/snapshots` (el mismo que el de los informes del libro, 5 años). */
export const MAX_PLAN_SNAPSHOT_MONTHS = 60;

/** Convierte un catálogo de `catalogs.ts` en un `z.enum` de sus códigos. */
function codes<T extends readonly CatalogEntry<string>[]>(catalog: T) {
  return z.enum(catalog.map((entry) => entry.code) as [T[number]['code'], ...T[number]['code'][]]);
}

const cents = z.int();
const id = z.uuid();

// --- peticiones ---------------------------------------------------------------------------------------

/** `:month` de las rutas del plan. Desde el año 0001: `0000-xx` no es una fecha de PostgreSQL. */
export const planMonthParamSchema = budgetMonthSchema;

/** `:id` de una foto del plan: un UUID, como el resto de identificadores de la app. */
export const planSnapshotIdParamSchema = id;

/** `?from=YYYY-MM&to=YYYY-MM` de `/plan/snapshots`. Obligatorios; el tamaño máximo lo comprueba el servicio (422). */
export const planSnapshotsQuerySchema = z
  .strictObject({ from: budgetMonthSchema, to: budgetMonthSchema })
  .refine((range) => range.from <= range.to, {
    message: '«from» no puede ser posterior a «to»',
    path: ['from'],
  });

// --- foto: entradas -----------------------------------------------------------------------------------

export const planSnapshotStatusSchema = z.enum(['active', 'superseded']);

/** Datos de una foto, sin sus filas. */
export const planSnapshotSummarySchema = z.object({
  id,
  /** Mes 1 del plan, `YYYY-MM`. */
  month: budgetMonthSchema,
  status: planSnapshotStatusSchema,
  importBatchId: id,
  templateVersion: z.int(),
  /** Instante ISO 8601. */
  createdAt: z.iso.datetime(),
  /** Instante ISO 8601; `null` mientras la foto está vigente. */
  supersededAt: z.iso.datetime().nullable(),
});

export const planItemSchema = z.object({
  id,
  sourceRow: z.int(),
  recordType: codes(RECORD_TYPES),
  groupLabel: z.string(),
  concept: z.string(),
  unit: codes(UNITS),
  /** Céntimos (`€` y `€/mes`); `null` si la unidad son meses. */
  amountCents: cents.nullable(),
  /** Meses en centésimas (6 meses = 600); `null` si la unidad es un importe. */
  quantityHundredths: z.int().nullable(),
  nature: codes(NATURES),
  status: codes(STATUSES),
  sourceNote: z.string().nullable(),
  note: z.string().nullable(),
});

export const planBudgetLineSchema = z.object({
  id,
  sourceRow: z.int(),
  categoryId: id,
  categoryLabel: z.string(),
  concept: z.string(),
  costType: codes(COST_TYPES),
  essential: z.boolean(),
  /** Fila de Datos de la que se lee el importe y el estado. */
  planItemId: id,
});

export const planEventSchema = z.object({
  id,
  sourceRow: z.int(),
  concept: z.string(),
  note: z.string().nullable(),
  natureLabel: z.string().nullable(),
  amountItemId: id.nullable(),
  multiplierItemId: id.nullable(),
  amountCents: cents.nullable(),
  status: codes(EVENT_STATUSES),
  expectedDate: localDateSchema.nullable(),
  includeInProjection: z.boolean(),
});

export const planGoalSchema = z.object({
  id,
  sourceRow: z.int(),
  name: z.string(),
  criterion: z.string().nullable(),
  goalKind: codes(GOAL_KINDS),
  targetItemId: id.nullable(),
  targetCents: cents.nullable(),
  currentItemId: id.nullable(),
  currentCents: cents.nullable(),
  contributionItemId: id.nullable(),
  contributionCents: cents.nullable(),
});

export const planScenarioSchema = z.object({
  id,
  sourceRow: z.int(),
  name: z.string(),
  items: z.array(z.object({ planItemId: id, role: z.enum(['extra_monthly', 'one_off']) })),
});

/** `GET /plan/snapshots/:id` y `GET /plan/months/:month`: la foto con las entradas de las cinco hojas. */
export const planSnapshotResponseSchema = planSnapshotSummarySchema.extend({
  items: z.array(planItemSchema),
  budgetLines: z.array(planBudgetLineSchema),
  events: z.array(planEventSchema),
  goals: z.array(planGoalSchema),
  scenarios: z.array(planScenarioSchema),
});

/** `GET /plan/snapshots?from&to`: historial de fotos, de la más reciente a la más antigua. */
export const planSnapshotsResponseSchema = z.object({ items: z.array(planSnapshotSummarySchema) });

// --- resultados calculados ----------------------------------------------------------------------------

/** Fracción entera sin reducir. `null` (en el campo que la lleva) si el denominador sería 0. */
export const ratioSchema = z.object({ numerator: z.int(), denominator: z.int().positive() });

export const budgetLineResultSchema = z.object({
  lineId: id,
  categoryId: id,
  categoryLabel: z.string(),
  concept: z.string(),
  costType: codes(COST_TYPES),
  essential: z.boolean(),
  /** Estado de la fila de Datos que referencia la línea. */
  status: codes(STATUSES),
  monthlyCents: cents,
  /** Si cuenta en el gasto base (`includedInBase`). */
  included: z.boolean(),
  /** `12 × mensual`. */
  annualCents: cents,
  /** `mensual / ingresos`. */
  incomeShare: ratioSchema.nullable(),
});

export const planBudgetSchema = z.object({
  incomeCents: cents,
  expensesCents: cents,
  marginCents: cents,
  savingsRate: ratioSchema.nullable(),
  essentialCents: cents,
  includedLineCount: z.int().min(0),
  confirmedLineCount: z.int().min(0),
  confirmedShare: ratioSchema.nullable(),
  lines: z.array(budgetLineResultSchema),
});

export const projectionRowSchema = z.object({
  /** 1 a 12. */
  index: z.int().min(1).max(12),
  month: budgetMonthSchema,
  /** Eventos incluidos que caen en el mes. */
  eventsCents: cents,
  /** Flujo mostrado: el del plan o, en un mes pasado con movimientos confirmados, el real. */
  flowCents: cents,
  openingCents: cents,
  closingCents: cents,
  flowRate: ratioSchema.nullable(),
  source: z.enum(['plan', 'real']),
  /** `NO_REAL_DATA`: mes pasado sin movimientos confirmados (se muestra el plan). */
  warning: z.enum(['NO_REAL_DATA']).nullable(),
});

export const goalResultSchema = z.object({
  goalId: id,
  name: z.string(),
  kind: codes(GOAL_KINDS),
  targetCents: cents,
  currentCents: cents,
  remainingCents: cents,
  contributionCents: cents,
  /** 0 si no falta nada; `null` si la aportación es ≤ 0. */
  monthsToGoal: z.int().min(0).nullable(),
  status: z.enum(['completed', 'paused', 'in_progress']),
});

export const planGoalsSchema = z.object({
  items: z.array(goalResultSchema),
  capacity: z.object({
    contributionsCents: cents,
    marginCents: cents,
    unallocatedCents: cents,
    ok: z.boolean(),
  }),
});

export const SCENARIO_READINGS = ['no_income', 'deficit', 'low', 'moderate', 'high'] as const;

export const scenarioResultSchema = z.object({
  scenarioId: id,
  name: z.string(),
  extraCents: cents,
  oneOffCents: cents,
  totalOutflowCents: cents,
  freeCashCents: cents,
  freeRate: ratioSchema.nullable(),
  reading: z.enum(SCENARIO_READINGS),
});

export const CHECK_CODES = [
  'CONTRIBUTIONS_EXCEED_MARGIN',
  'NEGATIVE_MARGIN',
  'ESSENTIAL_NOT_CONFIRMED',
  'NEGATIVE_FINAL_BALANCE',
  'EXPENSE_NOT_BUDGETED',
  'SCENARIO_ITEM_ALREADY_IN_BASE',
  'EVENT_ITEM_ALREADY_IN_BASE',
] as const;

export const checkResultSchema = z.object({
  code: z.enum(CHECK_CODES),
  severity: z.enum(['FAIL', 'WARN']),
  /** `true` si no hay nada que señalar. */
  passed: z.boolean(),
  /** Qué identifican los `subjects`. */
  subjectKind: z.enum(['none', 'budget_line', 'month', 'item', 'scenario', 'event']),
  /** Identificadores (o meses `YYYY-MM`) que la disparan. Vacío si `passed` o si no hay sujeto. */
  subjects: z.array(z.string()),
});

export const planChecksSchema = z.object({
  overall: z.enum(['FAIL', 'PASS_WITH_WARNINGS', 'PASS']),
  items: z.array(checkResultSchema),
});

/** Qué foto y qué mes en curso (Europe/Madrid) usó un cálculo. */
const calculationHeader = {
  snapshotId: id,
  /** Mes 1 de la foto. */
  month: budgetMonthSchema,
  /** Mes natural en curso en Europe/Madrid: los meses anteriores son «pasados». */
  currentMonth: budgetMonthSchema,
};

export const planBudgetResponseSchema = z.object({
  ...calculationHeader,
  budget: planBudgetSchema,
});
export const planProjectionResponseSchema = z.object({
  ...calculationHeader,
  projection: z.array(projectionRowSchema),
});
export const planGoalsResponseSchema = z.object({ ...calculationHeader, goals: planGoalsSchema });
export const planScenariosResponseSchema = z.object({
  ...calculationHeader,
  scenarios: z.array(scenarioResultSchema),
});
export const planChecksResponseSchema = z.object({
  ...calculationHeader,
  checks: planChecksSchema,
});

/** `GET /plan/months/:month/dashboard`: lo mismo que las cinco anteriores juntas, del mismo cálculo. */
export const planDashboardResponseSchema = z.object({
  ...calculationHeader,
  budget: planBudgetSchema,
  projection: z.array(projectionRowSchema),
  goals: planGoalsSchema,
  scenarios: z.array(scenarioResultSchema),
  checks: planChecksSchema,
});

export type PlanSnapshotsQuery = z.infer<typeof planSnapshotsQuerySchema>;
export type PlanSnapshotSummaryResponse = z.infer<typeof planSnapshotSummarySchema>;
export type PlanSnapshotsResponse = z.infer<typeof planSnapshotsResponseSchema>;
export type PlanSnapshotResponse = z.infer<typeof planSnapshotResponseSchema>;
export type PlanRatio = z.infer<typeof ratioSchema>;
export type PlanBudgetResponse = z.infer<typeof planBudgetResponseSchema>;
export type PlanProjectionResponse = z.infer<typeof planProjectionResponseSchema>;
export type PlanGoalsResponse = z.infer<typeof planGoalsResponseSchema>;
export type PlanScenariosResponse = z.infer<typeof planScenariosResponseSchema>;
export type PlanChecksResponse = z.infer<typeof planChecksResponseSchema>;
export type PlanDashboardResponse = z.infer<typeof planDashboardResponseSchema>;
