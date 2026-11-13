/**
 * Esquemas de la importación del Excel del plan (docs/plan.md §2.5, §2.10 y §3; docs/plantilla-excel.md §11).
 * Los comparten la API y la web.
 */
import { z } from 'zod';
import {
  COST_TYPES,
  EVENT_STATUSES,
  GOAL_KINDS,
  NATURES,
  RECORD_TYPES,
  STATUSES,
  UNITS,
} from '../plan/catalogs.ts';

// --- catálogo de problemas (plantilla-excel.md §11) --------------------------------------------------

export const ISSUE_SEVERITIES = ['error', 'warning', 'info'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * Códigos de problema y su severidad por defecto. Los marcados «según el caso» la indican al crearse
 * (`REF_TARGET_EMPTY` y `REF_UNIT_MISMATCH`). Los tres últimos no estaban en la revisión 3 del catálogo
 * (§11), aunque §6.3 exigía los avisos: se añadieron en la fase 3b.1 y el catálogo se actualizó.
 */
export const ISSUE_CODES = {
  FILE_TOO_LARGE: 'error',
  FILE_NOT_OOXML: 'error',
  FILE_ZIP_LIMITS: 'error',
  FILE_HAS_MACROS: 'error',
  FILE_EXTERNAL_LINKS: 'error',
  SHEET_MISSING: 'error',
  SHEET_UNEXPECTED: 'warning',
  HEADER_MISMATCH: 'error',
  TEMPLATE_VERSION_UNSUPPORTED: 'error',
  SUMMARY_NOT_FOUND: 'error',
  SUMMARY_UNEXPECTED: 'warning',
  ROW_AFTER_GAP: 'warning',
  CELL_REQUIRED: 'error',
  CELL_TYPE: 'error',
  VALUE_NOT_IN_LIST: 'error',
  AMOUNT_PRECISION: 'error',
  AMOUNT_NEGATIVE: 'error',
  FORMULA_NOT_ALLOWED: 'error',
  FORMULA_REQUIRED: 'error',
  REF_UNSUPPORTED: 'error',
  REF_TARGET_EMPTY: 'error', // warning dentro de un SUMRANGE
  REF_TARGET_COLUMN: 'error',
  REF_ROWS_MISMATCH: 'error',
  REF_UNIT_MISMATCH: 'error', // warning en Escenarios
  DUPLICATE_REFERENCE: 'warning',
  VALUE_IN_CALCULATED_COLUMN: 'warning',
  EVENT_DATE_REQUIRED: 'error',
  EVENT_REF_MONTHLY: 'info',
  EVENT_ITEM_ALREADY_IN_BASE: 'warning',
  SCENARIO_ITEM_ALREADY_IN_BASE: 'warning',
  EMERGENCY_FUND_MONTHS_MISSING: 'error',
  EMERGENCY_FUND_MONTHS_DUPLICATED: 'error',
  CATEGORY_UNMAPPED: 'error',
  TYPE_SIGNAL_MISMATCH: 'warning',
  EXPENSE_NOT_BUDGETED: 'warning',
  CACHED_VALUE_DIFF: 'info',
  // Añadidos en la 3b.1 (avisos de §6.3 que no tenían código):
  EVENT_INCLUDED_BUT_CLOSED: 'warning',
  EVENT_OVERDUE: 'warning',
  EVENT_AFTER_HORIZON: 'info',
} as const satisfies Record<string, IssueSeverity>;

export type IssueCode = keyof typeof ISSUE_CODES;
const issueCodes = Object.keys(ISSUE_CODES) as [IssueCode, ...IssueCode[]];

/** Un problema encontrado en el archivo: hoja y celda en notación A1 (nulas si no aplican). */
export const importIssueSchema = z.object({
  code: z.enum(issueCodes),
  severity: z.enum(ISSUE_SEVERITIES),
  sheet: z.string().nullable(),
  cell: z.string().nullable(),
  message: z.string(),
  expected: z.string().optional(),
  found: z.string().optional(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

// --- entradas extraídas (lo único que se guardará de la hoja) -----------------------------------------

const codes = <T extends readonly { code: string }[]>(catalog: T) =>
  z.enum(catalog.map((entry) => entry.code) as [T[number]['code'], ...T[number]['code'][]]);

/** Importe de una meta: literal en céntimos o referencia a una fila de Datos (por su fila del Excel). */
export const extractedAmountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), cents: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('item'), row: z.number().int().min(6) }),
]);
export type ExtractedAmount = z.infer<typeof extractedAmountSchema>;

const sourceRow = z.number().int().min(6);

/** Fila de «Datos y supuestos» → `plan_items`. */
export const extractedItemSchema = z.object({
  sourceRow,
  recordType: codes(RECORD_TYPES).nullable(),
  groupLabel: z.string(),
  concept: z.string(),
  unit: codes(UNITS).nullable(),
  /** Céntimos (`€` y `€/mes`) o `null` (meses). */
  amountCents: z.number().int().nullable(),
  /** Meses en centésimas (6 meses = 600) o `null`. */
  quantityHundredths: z.number().int().nullable(),
  nature: codes(NATURES).nullable(),
  status: codes(STATUSES).nullable(),
  sourceNote: z.string().nullable(),
  note: z.string().nullable(),
});
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

/** Fila de «Presupuesto» → `plan_budget_lines`. Importe y estado se leen de las filas de Datos. */
export const extractedBudgetLineSchema = z.object({
  sourceRow,
  categoryLabel: z.string(),
  /** Nombre normalizado (§3): clave de la correspondencia de categorías. */
  categoryKey: z.string(),
  /** Categoría de gasto de la app, o `null` si todavía no tiene correspondencia. */
  categoryId: z.uuid().nullable(),
  concept: z.string(),
  costType: codes(COST_TYPES).nullable(),
  essential: z.boolean().nullable(),
  /** Fila de Datos a la que apuntan Mensual (E) y Estado del dato (H). */
  itemRow: z.number().int().min(6).nullable(),
  statusItemRow: z.number().int().min(6).nullable(),
});
export type ExtractedBudgetLine = z.infer<typeof extractedBudgetLineSchema>;

/** Fila de «Eventos y compromisos» → `plan_events`. */
export const extractedEventSchema = z.object({
  sourceRow,
  concept: z.string(),
  natureLabel: z.string().nullable(),
  /** Literal en céntimos, o `null` si el importe viene de filas de Datos. */
  amountCents: z.number().int().nonnegative().nullable(),
  /** Fila en `€` o `€/mes` (con `€/mes`, un único pago igual a la cuota). */
  amountItemRow: z.number().int().min(6).nullable(),
  /** Fila en `meses` (forma cuota × plazo). */
  multiplierItemRow: z.number().int().min(6).nullable(),
  status: codes(EVENT_STATUSES).nullable(),
  /** Fecha prevista `YYYY-MM-DD`. */
  expectedDate: z.string().nullable(),
  includeInProjection: z.boolean().nullable(),
  note: z.string().nullable(),
});
export type ExtractedEvent = z.infer<typeof extractedEventSchema>;

/** Fila de «Metas» → `plan_goals`. */
export const extractedGoalSchema = z.object({
  sourceRow,
  name: z.string(),
  goalKind: codes(GOAL_KINDS).nullable(),
  /** `null` en el fondo de emergencia: el objetivo lo calcula la app. */
  target: extractedAmountSchema.nullable(),
  current: extractedAmountSchema.nullable(),
  contribution: extractedAmountSchema.nullable(),
  criterion: z.string().nullable(),
});
export type ExtractedGoal = z.infer<typeof extractedGoalSchema>;

/** Fila de «Escenarios» → `plan_scenarios` + `plan_scenario_items`. */
export const extractedScenarioSchema = z.object({
  sourceRow,
  name: z.string(),
  /** Filas de Datos de «Extra mensual» (C) y de «Pago puntual» (D). */
  extraMonthlyRows: z.array(z.number().int().min(6)),
  oneOffRows: z.array(z.number().int().min(6)),
});
export type ExtractedScenario = z.infer<typeof extractedScenarioSchema>;

/** Todo lo extraído de un archivo. Solo entradas: nunca totales ni resultados. */
export const extractedPlanSchema = z.object({
  items: z.array(extractedItemSchema),
  budgetLines: z.array(extractedBudgetLineSchema),
  events: z.array(extractedEventSchema),
  goals: z.array(extractedGoalSchema),
  scenarios: z.array(extractedScenarioSchema),
});
export type ExtractedPlan = z.infer<typeof extractedPlanSchema>;

// --- API ------------------------------------------------------------------------------------------

export const IMPORT_STATUSES = ['preview', 'confirmed', 'discarded', 'failed', 'expired'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** `?month=YYYY-MM&fileName=` de la subida (el cuerpo es el archivo en binario). */
export const uploadPlanExcelQuerySchema = z.strictObject({
  month: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u, 'Formato YYYY-MM'),
  fileName: z.string().min(1).max(1024),
});
export type UploadPlanExcelQuery = z.infer<typeof uploadPlanExcelQuerySchema>;

export const listImportsQuerySchema = z.strictObject({
  month: z
    .string()
    .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u, 'Formato YYYY-MM')
    .optional(),
});

/** Recuentos de la vista previa. `canConfirm` es falso si hay algún error. */
export const importSummarySchema = z.object({
  items: z.number().int(),
  budgetLines: z.number().int(),
  events: z.number().int(),
  goals: z.number().int(),
  scenarios: z.number().int(),
  errors: z.number().int(),
  warnings: z.number().int(),
  infos: z.number().int(),
  canConfirm: z.boolean(),
});
export type ImportSummary = z.infer<typeof importSummarySchema>;

/** Respuesta de la subida: `{ id, status, issues, summary }`. */
export const importUploadResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(IMPORT_STATUSES),
  issues: z.array(importIssueSchema),
  summary: importSummarySchema,
});
export type ImportUploadResponse = z.infer<typeof importUploadResponseSchema>;

/** Una importación para la lista (sin las entradas extraídas). */
export const importListItemSchema = z.object({
  id: z.uuid(),
  month: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number().int(),
  status: z.enum(IMPORT_STATUSES),
  templateVersion: z.number().int().nullable(),
  errors: z.number().int(),
  warnings: z.number().int(),
  createdAt: z.string(),
  expiresAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type ImportListItem = z.infer<typeof importListItemSchema>;

export const importListResponseSchema = z.object({ items: z.array(importListItemSchema) });
export type ImportListResponse = z.infer<typeof importListResponseSchema>;

/**
 * Lo que se guarda en `import_batches.decisions`: nombre de categoría normalizado → categoría elegida en la
 * vista previa (`PATCH /imports/:id/decisions`).
 */
export const importDecisionsSchema = z.object({
  categoryMappings: z.record(z.string(), z.uuid()).default({}),
});
export type ImportDecisions = z.infer<typeof importDecisionsSchema>;

/** Vista previa completa. `extracted` es `null` tras confirmar, descartar o caducar. */
export const importDetailResponseSchema = importUploadResponseSchema.extend({
  month: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number().int(),
  templateVersion: z.number().int().nullable(),
  extracted: extractedPlanSchema.nullable(),
  /** Decisiones tomadas en la vista previa. */
  decisions: importDecisionsSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type ImportDetailResponse = z.infer<typeof importDetailResponseSchema>;

// --- decisiones y confirmación (fase 3b.1, PR 2) -----------------------------------------------------

/**
 * Una decisión sobre una categoría de Presupuesto: a qué categoría de gasto de la app corresponde el nombre
 * (ya normalizado, `categoryKey`) o `null` para retirar la decisión anterior.
 */
export const categoryMappingDecisionSchema = z.strictObject({
  categoryKey: z.string().min(1).max(200),
  categoryId: z.uuid().nullable(),
});
export type CategoryMappingDecision = z.infer<typeof categoryMappingDecisionSchema>;

/** Máximo de decisiones por petición: una por categoría distinta de un archivo (5.000 filas como tope). */
export const MAX_CATEGORY_DECISIONS = 200;

/** Cuerpo de `PATCH /imports/:id/decisions`. Cada clave aparece una sola vez (si no, 422). */
export const updateImportDecisionsRequestSchema = z.strictObject({
  categoryMappings: z.array(categoryMappingDecisionSchema).min(1).max(MAX_CATEGORY_DECISIONS),
});
export type UpdateImportDecisionsRequest = z.infer<typeof updateImportDecisionsRequestSchema>;

/**
 * Respuesta de `POST /imports/:id/confirm`: 201 al confirmar, 200 si ya estaba confirmada (entonces
 * `budgets` es `null`: no se guarda qué hizo la primera vez, porque sería un dato derivado).
 */
export const confirmImportResponseSchema = z.object({
  snapshotId: z.uuid(),
  budgets: z
    .object({
      /** Presupuestos de categoría nuevos en `category_budgets`. */
      created: z.number().int().nonnegative(),
      /** Presupuestos que creó la foto anterior y cuyo importe cambia en la nueva. */
      updated: z.number().int().nonnegative(),
      /** Presupuestos de la foto anterior que se borran (la categoría ya no está o suma 0). */
      deleted: z.number().int().nonnegative(),
      /** Categorías cuyas líneas suman 0 (o ninguna cuenta en el plan base): no se crea presupuesto. */
      omitted: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ConfirmImportResponse = z.infer<typeof confirmImportResponseSchema>;
