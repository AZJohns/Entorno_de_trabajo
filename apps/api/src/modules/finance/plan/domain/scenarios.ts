/**
 * Escenarios (docs/plantilla-excel.md §9.5): extra mensual, pago puntual, salida total, caja libre, tasa
 * libre y lectura. Funciones puras; importes en céntimos enteros.
 *
 * **Excepción documentada al predicado único (§9.1):** los escenarios NO filtran por estado. Incluyen a
 * propósito filas `potential` o `inactive`, porque simulan justo lo que hoy no está en la base.
 *
 * El pago puntual se resta **entero**: el escenario es la foto de un mes y no se prorratea.
 */
import { assertCents, type Cents } from '@backoffice/shared';
import { indexItems, itemById, type ItemIndex } from './items.ts';
import { comparePercent, ratio, type Ratio } from './ratio.ts';
import { sumCents } from './rounding.ts';
import type { PlanScenario, PlanSnapshot, ScenarioRole } from './types.ts';

/** Lectura del escenario por su tasa libre (§9.5). Las etiquetas del texto («Margen alto»…) son de la capa de presentación. */
export type ScenarioReading = 'no_income' | 'deficit' | 'low' | 'moderate' | 'high';

/** Umbrales de la lectura, en porcentaje entero. Un 20 % exacto es moderado y un 40 % exacto, alto. */
export const LOW_MARGIN_PERCENT = 20;
export const HIGH_MARGIN_PERCENT = 40;

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly name: string;
  /** Σ de las filas con rol `extra_monthly`. */
  readonly extraCents: Cents;
  /** Σ de las filas con rol `one_off`. */
  readonly oneOffCents: Cents;
  /** `G + extra + puntual`. */
  readonly totalOutflowCents: Cents;
  /** `I − salida total` (negativa si hay déficit). */
  readonly freeCashCents: Cents;
  /** `caja libre / I`; `null` si `I = 0`. */
  readonly freeRate: Ratio | null;
  readonly reading: ScenarioReading;
}

/**
 * Lectura de una caja libre frente a los ingresos, con aritmética entera:
 * `I = 0` → sin ingresos; `< 0` → déficit; `< 20 %` → bajo; `< 40 %` → moderado; si no, alto.
 *
 * @throws {RangeError} si algún importe no es un entero seguro o los ingresos son negativos.
 */
export function readScenario(freeCashCents: Cents, incomeCents: Cents): ScenarioReading {
  if (incomeCents < 0) throw new RangeError('Los ingresos no pueden ser negativos');
  if (incomeCents === 0) return 'no_income';
  if (freeCashCents < 0) return 'deficit';
  if (comparePercent(freeCashCents, incomeCents, LOW_MARGIN_PERCENT) < 0) return 'low';
  if (comparePercent(freeCashCents, incomeCents, HIGH_MARGIN_PERCENT) < 0) return 'moderate';
  return 'high';
}

/** Σ de los importes de las filas de un escenario con ese rol. Una fila sin importe (en meses) suma 0. */
function sumRole(scenario: PlanScenario, role: ScenarioRole, items: ItemIndex): Cents {
  return sumCents(
    scenario.items
      .filter((entry) => entry.role === role)
      .map(
        (entry) =>
          itemById(items, entry.planItemId, `Escenario «${scenario.name}»`).amountCents ?? 0,
      ),
  );
}

/**
 * Evalúa cada escenario de la foto contra el presupuesto base.
 *
 * @param budget `I` y `G` del resumen del presupuesto de la misma foto.
 * @throws {RangeError} si un escenario referencia una fila inexistente o un importe desborda.
 */
export function evaluateScenarios(
  snapshot: PlanSnapshot,
  budget: { readonly incomeCents: Cents; readonly expensesCents: Cents },
): ScenarioResult[] {
  const items = indexItems(snapshot.items);
  return snapshot.scenarios.map((scenario) => {
    const extraCents = sumRole(scenario, 'extra_monthly', items);
    const oneOffCents = sumRole(scenario, 'one_off', items);
    const totalOutflowCents = assertCents(budget.expensesCents + extraCents + oneOffCents);
    const freeCashCents = assertCents(budget.incomeCents - totalOutflowCents);
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      extraCents,
      oneOffCents,
      totalOutflowCents,
      freeCashCents,
      freeRate: ratio(freeCashCents, budget.incomeCents),
      reading: readScenario(freeCashCents, budget.incomeCents),
    };
  });
}
