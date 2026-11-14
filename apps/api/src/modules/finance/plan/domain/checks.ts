/**
 * Comprobaciones «en ejecución» del plan (docs/plantilla-excel.md §9.6) y el estado global.
 *
 * Solo están las que se calculan al leer. Las marcadas como «Invariante» en §9.6 (gasto = Σ líneas,
 * ingresos = gasto + margen, saldo inicial = ahorro, roll-forward) son **tests**, no comprobaciones; la
 * comprobación «los ingresos cuadran» se eliminó (era una tautología), y las de eventos con fecha son una
 * restricción del importador y de la base de datos.
 *
 * Todas usan el predicado único `includedInBase` (§9.1) a través de `resolveBudgetLines`: el total del
 * gasto y estas comprobaciones miran las mismas líneas. Los escenarios no lo aplican (§9.5), pero su
 * comprobación de doble cómputo sí mira si la fila **está** en la base.
 */
import { includedInBase } from '@backoffice/shared';
import { resolveBudgetLines, type BudgetSummary } from './budget.ts';
import type { GoalsSummary } from './goals.ts';
import { indexItems } from './items.ts';
import type { ProjectionRow } from './projection.ts';
import type { PlanSnapshot } from './types.ts';

export type CheckSeverity = 'FAIL' | 'WARN';

export type CheckCode =
  | 'CONTRIBUTIONS_EXCEED_MARGIN'
  | 'NEGATIVE_MARGIN'
  | 'ESSENTIAL_NOT_CONFIRMED'
  | 'NEGATIVE_FINAL_BALANCE'
  | 'EXPENSE_NOT_BUDGETED'
  | 'SCENARIO_ITEM_ALREADY_IN_BASE'
  | 'EVENT_ITEM_ALREADY_IN_BASE';

/** Qué identifican los `subjects` de una comprobación. */
export type CheckSubjectKind = 'none' | 'budget_line' | 'month' | 'item' | 'scenario' | 'event';

export interface CheckResult {
  readonly code: CheckCode;
  readonly severity: CheckSeverity;
  /** `true` si no hay nada que señalar. */
  readonly passed: boolean;
  readonly subjectKind: CheckSubjectKind;
  /** Lo que la dispara (ids de líneas, filas, escenarios o eventos; meses `YYYY-MM`). Vacío si `passed` o si no hay sujeto (`none`). */
  readonly subjects: readonly string[];
}

/** `FAIL` si hay algún FAIL; si no, `PASS_WITH_WARNINGS` si hay algún WARN; si no, `PASS`. */
export type OverallStatus = 'FAIL' | 'PASS_WITH_WARNINGS' | 'PASS';

export interface ChecksSummary {
  readonly checks: readonly CheckResult[];
  readonly overall: OverallStatus;
}

function check(
  code: CheckCode,
  severity: CheckSeverity,
  subjectKind: CheckSubjectKind,
  subjects: readonly string[],
  failed: boolean = subjects.length > 0,
): CheckResult {
  return { code, severity, passed: !failed, subjectKind, subjects };
}

/** Estado global a partir de las comprobaciones (§9.6). */
export function overallStatus(checks: readonly CheckResult[]): OverallStatus {
  const failing = checks.filter((entry) => !entry.passed);
  if (failing.some((entry) => entry.severity === 'FAIL')) return 'FAIL';
  return failing.length > 0 ? 'PASS_WITH_WARNINGS' : 'PASS';
}

/**
 * Ejecuta las siete comprobaciones sobre una foto ya calculada.
 *
 * - `CONTRIBUTIONS_EXCEED_MARGIN` (FAIL): Σ aportaciones de las metas en curso > margen. Con margen
 *   negativo y ninguna meta en curso también salta (`0 ≤ M` es falso), a la vez que `NEGATIVE_MARGIN`.
 * - `NEGATIVE_MARGIN` (FAIL): `M < 0`.
 * - `ESSENTIAL_NOT_CONFIRMED` (WARN): líneas esenciales **incluidas** con estado distinto de `confirmed`.
 * - `NEGATIVE_FINAL_BALANCE` (WARN): meses con `final_k < 0`.
 * - `EXPENSE_NOT_BUDGETED` (WARN): filas `expense` incluidas que ninguna línea de Presupuesto referencia.
 * - `SCENARIO_ITEM_ALREADY_IN_BASE` (WARN): escenarios cuyo extra mensual es una fila que ya está en el gasto base.
 * - `EVENT_ITEM_ALREADY_IN_BASE` (WARN): eventos incluidos en la proyección cuya fila de importe ya está en el
 *   gasto base (se restaría dos veces). No mira si la fecha cae dentro de los 12 meses.
 *
 * @throws {RangeError} si la foto es incoherente (referencias que no existen).
 */
export function runChecks(
  snapshot: PlanSnapshot,
  budget: BudgetSummary,
  projection: readonly ProjectionRow[],
  goals: GoalsSummary,
): ChecksSummary {
  const items = indexItems(snapshot.items);
  const lines = resolveBudgetLines(snapshot.budgetLines, items);
  const includedLines = lines.filter((entry) => entry.included);

  // Filas que el gasto base cuenta: las que referencia una línea y su estado está incluido.
  const itemsInBase = new Set(includedLines.map((entry) => entry.item.id));
  // Filas que alguna línea referencia, cuenten o no: para saber si un gasto está presupuestado.
  const budgetedItems = new Set(lines.map((entry) => entry.item.id));

  const checks: CheckResult[] = [
    check('CONTRIBUTIONS_EXCEED_MARGIN', 'FAIL', 'none', [], !goals.capacity.ok),
    check('NEGATIVE_MARGIN', 'FAIL', 'none', [], budget.marginCents < 0),
    check(
      'ESSENTIAL_NOT_CONFIRMED',
      'WARN',
      'budget_line',
      includedLines
        .filter((entry) => entry.line.essential && entry.status !== 'confirmed')
        .map((entry) => entry.line.id),
    ),
    check(
      'NEGATIVE_FINAL_BALANCE',
      'WARN',
      'month',
      projection.filter((row) => row.closingCents < 0).map((row) => row.month),
    ),
    check(
      'EXPENSE_NOT_BUDGETED',
      'WARN',
      'item',
      snapshot.items
        .filter(
          (item) =>
            item.recordType === 'expense' &&
            includedInBase(item.status) &&
            !budgetedItems.has(item.id),
        )
        .map((item) => item.id),
    ),
    check(
      'SCENARIO_ITEM_ALREADY_IN_BASE',
      'WARN',
      'scenario',
      snapshot.scenarios
        .filter((scenario) =>
          scenario.items.some(
            (entry) => entry.role === 'extra_monthly' && itemsInBase.has(entry.planItemId),
          ),
        )
        .map((scenario) => scenario.id),
    ),
    check(
      'EVENT_ITEM_ALREADY_IN_BASE',
      'WARN',
      'event',
      snapshot.events
        .filter(
          (event) =>
            event.includeInProjection &&
            event.amountItemId !== null &&
            itemsInBase.has(event.amountItemId),
        )
        .map((event) => event.id),
    ),
  ];
  return { checks, overall: overallStatus(checks) };
}
