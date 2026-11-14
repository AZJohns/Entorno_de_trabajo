/**
 * Constructores de fotos del plan para los tests de los cálculos (`finance/plan/domain/`). Datos FICTICIOS.
 * Cada fila de Datos se identifica con un texto corto (`'sal'`, `'rent'`…) para que los casos se lean solos.
 */
import type { ExtractedPlan, RecordType, Status, Unit } from '@backoffice/shared';
import type {
  PlanBudgetLine,
  PlanEvent,
  PlanGoal,
  PlanItem,
  PlanScenario,
  PlanSnapshot,
  ScenarioRole,
} from '../../src/modules/finance/plan/domain/types.ts';

export const MONTH_1 = '2026-11';

export function item(
  id: string,
  recordType: RecordType,
  unit: Unit,
  value: number,
  status: Status = 'confirmed',
): PlanItem {
  return {
    id,
    recordType,
    concept: `Concepto ${id}`,
    unit,
    amountCents: unit === 'months' ? null : value,
    quantityHundredths: unit === 'months' ? value : null,
    status,
  };
}

export const income = (id: string, cents: number, status: Status = 'confirmed'): PlanItem =>
  item(id, 'income', 'eur_per_month', cents, status);
export const expense = (id: string, cents: number, status: Status = 'confirmed'): PlanItem =>
  item(id, 'expense', 'eur_per_month', cents, status);
export const savings = (id: string, cents: number, status: Status = 'confirmed'): PlanItem =>
  item(id, 'savings_balance', 'eur', cents, status);
export const emergencyMonths = (id: string, hundredths: number): PlanItem =>
  item(id, 'emergency_fund_months', 'months', hundredths);

export function line(id: string, planItemId: string, essential = false): PlanBudgetLine {
  return { id, concept: `Línea ${id}`, costType: 'fixed', essential, planItemId };
}

export function event(
  id: string,
  options: Partial<Omit<PlanEvent, 'id' | 'concept'>> = {},
): PlanEvent {
  return {
    id,
    concept: `Evento ${id}`,
    amountItemId: null,
    multiplierItemId: null,
    amountCents: 100,
    status: 'estimated',
    expectedDate: null,
    includeInProjection: false,
    ...options,
  };
}

/** Meta `fixed_amount` con importes literales (céntimos). */
export function fixedGoal(
  id: string,
  targetCents: number,
  currentCents: number,
  contributionCents: number,
): PlanGoal {
  return {
    id,
    name: `Meta ${id}`,
    goalKind: 'fixed_amount',
    targetItemId: null,
    targetCents,
    currentItemId: null,
    currentCents,
    contributionItemId: null,
    contributionCents,
  };
}

/** Meta de fondo de emergencia: el objetivo lo calcula la app. */
export function fundGoal(id: string, currentCents: number, contributionCents: number): PlanGoal {
  return {
    ...fixedGoal(id, 0, currentCents, contributionCents),
    goalKind: 'emergency_fund',
    targetCents: null,
  };
}

export function scenario(
  id: string,
  ...entries: readonly [planItemId: string, role: ScenarioRole][]
): PlanScenario {
  return {
    id,
    name: `Escenario ${id}`,
    items: entries.map(([planItemId, role]) => ({ planItemId, role })),
  };
}

export function snapshot(parts: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    month: MONTH_1,
    items: [],
    budgetLines: [],
    events: [],
    goals: [],
    scenarios: [],
    ...parts,
  };
}

/** Id de una fila de la fixture a partir de su fila del Excel. */
export const rowId = (row: number): string => `r${String(row)}`;

function need<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`La fixture no debería tener ${what} vacío`);
  return value;
}

/**
 * Convierte lo que extrae el importador de un archivo en la foto de los cálculos, como lo hará el servicio
 * al leer las tablas `plan_*` (con la fila del Excel como identificador).
 */
export function snapshotFromExtracted(plan: ExtractedPlan, month: string): PlanSnapshot {
  const ref = (row: number | null): string | null => (row === null ? null : rowId(row));
  const amount = (value: ExtractedPlan['goals'][number]['current']) => {
    const extracted = need(value, 'un importe de meta');
    return extracted.kind === 'item'
      ? { itemId: rowId(extracted.row), cents: null }
      : { itemId: null, cents: extracted.cents };
  };
  return {
    month,
    items: plan.items.map((row) => ({
      id: rowId(row.sourceRow),
      recordType: need(row.recordType, 'el tipo de registro'),
      concept: row.concept,
      unit: need(row.unit, 'la unidad'),
      amountCents: row.amountCents,
      quantityHundredths: row.quantityHundredths,
      status: need(row.status, 'el estado'),
    })),
    budgetLines: plan.budgetLines.map((row) => ({
      id: rowId(row.sourceRow),
      concept: row.concept,
      costType: need(row.costType, 'el tipo de coste'),
      essential: need(row.essential, 'Esencial'),
      planItemId: need(ref(row.itemRow), 'la fila de Datos'),
    })),
    events: plan.events.map((row) => ({
      id: rowId(row.sourceRow),
      concept: row.concept,
      amountItemId: ref(row.amountItemRow),
      multiplierItemId: ref(row.multiplierItemRow),
      amountCents: row.amountCents,
      status: need(row.status, 'el estado del evento'),
      expectedDate: row.expectedDate,
      includeInProjection: need(row.includeInProjection, 'Incluir 12M'),
    })),
    goals: plan.goals.map((row) => {
      const goalKind = need(row.goalKind, 'el tipo de meta');
      const target = row.target === null ? { itemId: null, cents: null } : amount(row.target);
      const current = amount(row.current);
      const contribution = amount(row.contribution);
      return {
        id: rowId(row.sourceRow),
        name: row.name,
        goalKind,
        targetItemId: target.itemId,
        targetCents: target.cents,
        currentItemId: current.itemId,
        currentCents: current.cents,
        contributionItemId: contribution.itemId,
        contributionCents: contribution.cents,
      };
    }),
    scenarios: plan.scenarios.map((row) => ({
      id: rowId(row.sourceRow),
      name: row.name,
      items: [
        ...row.extraMonthlyRows.map((r) => ({
          planItemId: rowId(r),
          role: 'extra_monthly' as const,
        })),
        ...row.oneOffRows.map((r) => ({ planItemId: rowId(r), role: 'one_off' as const })),
      ],
    })),
  };
}
