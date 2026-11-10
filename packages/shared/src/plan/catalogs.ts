/**
 * Catálogos cerrados de la plantilla Excel del plan (docs/plantilla-excel.md §6 y §7) y el predicado de
 * inclusión en el plan base (§9.1). Los usan el importador y, después, los cálculos del plan: una sola
 * definición para que no puedan contradecirse.
 *
 * `code` es el identificador del código y de la base de datos; `label` es el texto del Excel.
 */

export interface CatalogEntry<C extends string> {
  readonly code: C;
  readonly label: string;
}

/** Unidades de «Datos y supuestos» (columna D). */
export const UNITS = [
  { code: 'eur_per_month', label: '€/mes' },
  { code: 'eur', label: '€' },
  { code: 'months', label: 'meses' },
] as const satisfies readonly CatalogEntry<string>[];
export type Unit = (typeof UNITS)[number]['code'];

/** Naturaleza de «Datos y supuestos» (columna E): 11 valores. */
export const NATURES = [
  { code: 'recurring', label: 'Recurrente' },
  { code: 'variable', label: 'Variable' },
  { code: 'irregular', label: 'Irregular' },
  { code: 'balance', label: 'Saldo' },
  { code: 'assumption', label: 'Supuesto' },
  { code: 'target', label: 'Objetivo' },
  { code: 'potential', label: 'Potencial' },
  { code: 'finished', label: 'Finalizado' },
  { code: 'accumulated', label: 'Acumulado' },
  { code: 'paid', label: 'Pagado' },
  { code: 'one_off', label: 'Puntual' },
] as const satisfies readonly CatalogEntry<string>[];
export type Nature = (typeof NATURES)[number]['code'];

/** Estado de «Datos y supuestos» (columna F): 10 valores. */
export const STATUSES = [
  { code: 'confirmed', label: 'Confirmado' },
  { code: 'pending', label: 'Pendiente' },
  { code: 'to_confirm', label: 'Confirmar' },
  { code: 'provisional', label: 'Provisional' },
  { code: 'estimated', label: 'Estimado' },
  { code: 'to_confirm_paid', label: 'Confirmar pagado' },
  { code: 'potential', label: 'Potencial' },
  { code: 'inactive', label: 'No activo' },
  { code: 'paused', label: 'Pausado' },
  { code: 'historical', label: 'Histórico' },
] as const satisfies readonly CatalogEntry<string>[];
export type Status = (typeof STATUSES)[number]['code'];

/** Estados que cuentan en el plan base (§6.1). Los demás quedan fuera. */
const INCLUDED_IN_BASE: ReadonlySet<Status> = new Set<Status>([
  'confirmed',
  'pending',
  'to_confirm',
  'provisional',
  'estimated',
  'to_confirm_paid',
]);

/**
 * Predicado único de inclusión en el plan base (§9.1): lo usan todos los cálculos del plan base y todas las
 * comprobaciones del importador. Excepción documentada: los escenarios no lo aplican (§9.5).
 */
export function includedInBase(status: Status): boolean {
  return INCLUDED_IN_BASE.has(status);
}

/** Tipo de registro de «Datos y supuestos» (columna I, solo en la v2): 9 valores (§7). */
export const RECORD_TYPES = [
  { code: 'income', label: 'Ingreso' },
  { code: 'expense', label: 'Gasto' },
  { code: 'savings_balance', label: 'Saldo de ahorro' },
  { code: 'assumption', label: 'Supuesto' },
  { code: 'emergency_fund_months', label: 'Meses de fondo de emergencia' },
  { code: 'goal', label: 'Meta' },
  { code: 'scenario', label: 'Escenario' },
  { code: 'historical', label: 'Histórico' },
  { code: 'one_off_payment', label: 'Pago puntual' },
] as const satisfies readonly CatalogEntry<string>[];
export type RecordType = (typeof RECORD_TYPES)[number]['code'];

/** Unidades que admite cada tipo de registro (§7). */
export const RECORD_TYPE_UNITS: Readonly<Record<RecordType, readonly Unit[]>> = {
  income: ['eur_per_month'],
  expense: ['eur_per_month'],
  savings_balance: ['eur'],
  assumption: ['eur_per_month', 'eur', 'months'],
  emergency_fund_months: ['months'],
  goal: ['eur', 'eur_per_month'],
  scenario: ['eur_per_month', 'eur'],
  historical: ['eur_per_month', 'eur', 'months'],
  one_off_payment: ['eur'],
};

/** Tipo de coste de las líneas de Presupuesto (columna C). */
export const COST_TYPES = [
  { code: 'fixed', label: 'Fijo' },
  { code: 'variable', label: 'Variable' },
  { code: 'irregular', label: 'Irregular' },
] as const satisfies readonly CatalogEntry<string>[];
export type CostType = (typeof COST_TYPES)[number]['code'];

/** Estado de «Eventos y compromisos» (columna D): 6 valores. */
export const EVENT_STATUSES = [
  { code: 'estimated', label: 'Estimado' },
  { code: 'paid', label: 'Pagado' },
  { code: 'finished', label: 'Finalizado' },
  { code: 'active', label: 'Activo' },
  { code: 'inactive', label: 'No activo' },
  { code: 'not_committed', label: 'No comprometido' },
] as const satisfies readonly CatalogEntry<string>[];
export type EventStatus = (typeof EVENT_STATUSES)[number]['code'];

/** Tipo de meta (columna I de Metas, solo en la v2). */
export const GOAL_KINDS = [
  { code: 'fixed_amount', label: 'Importe fijo' },
  { code: 'emergency_fund', label: 'Fondo de emergencia' },
] as const satisfies readonly CatalogEntry<string>[];
export type GoalKind = (typeof GOAL_KINDS)[number]['code'];

/** Sí/No (se acepta «Si» sin tilde, §3). */
export const YES_NO = [
  { code: 'yes', label: 'Sí' },
  { code: 'no', label: 'No' },
] as const satisfies readonly CatalogEntry<string>[];
