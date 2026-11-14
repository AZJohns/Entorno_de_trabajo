/**
 * Cálculos del plan (docs/plantilla-excel.md §9) como funciones puras sobre la foto ya leída. Sin E/S: el
 * servicio que los use (3b.2, PR 2) lee las tablas `plan_*`, construye un `PlanSnapshot` y llama aquí.
 */
import type { Cents } from '@backoffice/shared';
import type { YearMonth } from '../../ledger/domain/dates.ts';
import { summarizeBudget, type BudgetSummary } from './budget.ts';
import { runChecks, type ChecksSummary } from './checks.ts';
import { evaluateGoals, type GoalsSummary } from './goals.ts';
import { projectCash, type ProjectionRow } from './projection.ts';
import { evaluateScenarios, type ScenarioResult } from './scenarios.ts';
import type { PlanSnapshot } from './types.ts';

export * from './budget.ts';
export * from './checks.ts';
export * from './goals.ts';
export * from './projection.ts';
export * from './ratio.ts';
export * from './rounding.ts';
export * from './scenarios.ts';
export * from './types.ts';

/** Todos los resultados del plan de una foto. */
export interface PlanCalculation {
  readonly budget: BudgetSummary;
  readonly projection: readonly ProjectionRow[];
  readonly goals: GoalsSummary;
  readonly scenarios: readonly ScenarioResult[];
  readonly checks: ChecksSummary;
}

export interface PlanCalculationOptions {
  /** Mes natural en curso (`YYYY-MM`, Europe/Madrid). */
  readonly currentMonth: YearMonth;
  /** Flujo real por mes (céntimos); un mes ausente no tiene movimientos confirmados. */
  readonly realFlowByMonth?: ReadonlyMap<YearMonth, Cents>;
}

/**
 * Calcula presupuesto, proyección, metas, escenarios y comprobaciones de una foto, en este orden y con los
 * mismos `I`, `G`, `E` y `M` para todos.
 *
 * @throws {RangeError} si la foto es incoherente o un importe desborda.
 */
export function calculatePlan(
  snapshot: PlanSnapshot,
  options: PlanCalculationOptions,
): PlanCalculation {
  const budget = summarizeBudget(snapshot);
  const projection = projectCash(snapshot, budget, options);
  const goals = evaluateGoals(snapshot, budget);
  const scenarios = evaluateScenarios(snapshot, budget);
  return {
    budget,
    projection,
    goals,
    scenarios,
    checks: runChecks(snapshot, budget, projection, goals),
  };
}
