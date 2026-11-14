/**
 * Entrada de los cálculos del plan: la foto de un mes ya leída (docs/plan.md §2.4), con la forma de las
 * tablas `plan_*` pero en camelCase y sin columnas que los cálculos no usan. Los cálculos de este directorio
 * son funciones puras sobre estos tipos: nunca reciben una conexión ni consultan la base de datos.
 *
 * Los identificadores son opacos (el `id` de cada fila); solo importa que `planItemId`, `amountItemId`… se
 * refieran a un `PlanItem.id` de la misma foto, como garantizan las claves ajenas compuestas.
 */
import type {
  Cents,
  CostType,
  EventStatus,
  GoalKind,
  RecordType,
  Status,
  Unit,
} from '@backoffice/shared';
import type { LocalDate, YearMonth } from '../../ledger/domain/dates.ts';

/** Fila de «Datos y supuestos» (`plan_items`). */
export interface PlanItem {
  readonly id: string;
  readonly recordType: RecordType;
  readonly concept: string;
  readonly unit: Unit;
  /** Céntimos (`€` y `€/mes`); `null` si la unidad son meses. */
  readonly amountCents: Cents | null;
  /** Meses en centésimas (6 meses = 600); `null` si la unidad es un importe. */
  readonly quantityHundredths: number | null;
  readonly status: Status;
}

/** Línea de «Presupuesto» (`plan_budget_lines`). El importe y el estado se leen de la fila de Datos. */
export interface PlanBudgetLine {
  readonly id: string;
  readonly concept: string;
  readonly costType: CostType;
  readonly essential: boolean;
  readonly planItemId: string;
}

/** Fila de «Eventos y compromisos» (`plan_events`): importe literal o por referencia. */
export interface PlanEvent {
  readonly id: string;
  readonly concept: string;
  /** Fila en `€` o `€/mes` (con `€/mes`, un único pago igual a la cuota). */
  readonly amountItemId: string | null;
  /** Fila en `meses` (forma cuota × plazo): solo con `amountItemId`. */
  readonly multiplierItemId: string | null;
  /** Literal en céntimos: el importe es esto o una referencia, nunca las dos cosas. */
  readonly amountCents: Cents | null;
  readonly status: EventStatus;
  /** `YYYY-MM-DD`. Obligatoria si `includeInProjection`. */
  readonly expectedDate: LocalDate | null;
  readonly includeInProjection: boolean;
}

/** Fila de «Metas» (`plan_goals`). Cada importe es una referencia o un literal. */
export interface PlanGoal {
  readonly id: string;
  readonly name: string;
  readonly goalKind: GoalKind;
  /** Solo `fixed_amount`: el fondo de emergencia lo calcula la app (§9.4). */
  readonly targetItemId: string | null;
  readonly targetCents: Cents | null;
  readonly currentItemId: string | null;
  readonly currentCents: Cents | null;
  readonly contributionItemId: string | null;
  readonly contributionCents: Cents | null;
}

export type ScenarioRole = 'extra_monthly' | 'one_off';

/** Escenario (`plan_scenarios` + `plan_scenario_items`): una lista de filas de Datos con un rol. */
export interface PlanScenario {
  readonly id: string;
  readonly name: string;
  readonly items: readonly { readonly planItemId: string; readonly role: ScenarioRole }[];
}

/** La foto del plan de un mes con todas sus entradas. */
export interface PlanSnapshot {
  /** Mes 1 de la proyección, `YYYY-MM`. */
  readonly month: YearMonth;
  readonly items: readonly PlanItem[];
  readonly budgetLines: readonly PlanBudgetLine[];
  readonly events: readonly PlanEvent[];
  readonly goals: readonly PlanGoal[];
  readonly scenarios: readonly PlanScenario[];
}
