/**
 * Decisiones de la vista previa y presupuesto por categoría (`domain/decisions.ts`): funciones puras, sin
 * base de datos. Datos FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import type {
  ExtractedBudgetLine,
  ExtractedItem,
  ExtractedPlan,
  ImportIssue,
} from '@backoffice/shared';
import {
  budgetsByCategory,
  effectiveIssues,
  effectivePlan,
} from '../../src/modules/imports/domain/decisions.ts';

const CAT_A = '00000000-0000-4000-8000-00000000000a';
const CAT_B = '00000000-0000-4000-8000-00000000000b';
const CAT_C = '00000000-0000-4000-8000-00000000000c';

function item(
  sourceRow: number,
  amountCents: number,
  status: ExtractedItem['status'],
): ExtractedItem {
  return {
    sourceRow,
    recordType: 'expense',
    groupLabel: 'Grupo',
    concept: `Concepto ${String(sourceRow)}`,
    unit: 'eur_per_month',
    amountCents,
    quantityHundredths: null,
    nature: 'recurring',
    status,
    sourceNote: null,
    note: null,
  };
}

function line(
  sourceRow: number,
  label: string,
  categoryId: string | null,
  itemRow: number,
): ExtractedBudgetLine {
  return {
    sourceRow,
    categoryLabel: label,
    categoryKey: label.toLowerCase(),
    categoryId,
    concept: 'Concepto',
    costType: 'fixed',
    essential: true,
    itemRow,
    statusItemRow: itemRow,
  };
}

function plan(items: ExtractedItem[], budgetLines: ExtractedBudgetLine[]): ExtractedPlan {
  return { items, budgetLines, events: [], goals: [], scenarios: [] };
}

describe('budgetsByCategory', () => {
  it('suma en céntimos exactos las líneas de una misma categoría', () => {
    const result = budgetsByCategory(
      plan(
        [item(8, 80_000, 'confirmed'), item(9, 1, 'estimated'), item(10, 7, 'pending')],
        [line(6, 'Vivienda', CAT_A, 8), line(7, 'Vivienda', CAT_A, 9), line(8, 'Ocio', CAT_B, 10)],
      ),
    );
    expect(result.budgets).toEqual([
      { categoryId: CAT_A, amountCents: 80_001 },
      { categoryId: CAT_B, amountCents: 7 },
    ]);
    expect(result.omitted).toBe(0);
  });

  it('solo cuentan las líneas que entran en el plan base (includedInBase, §9.1)', () => {
    const result = budgetsByCategory(
      plan(
        [
          item(8, 1000, 'confirmed'),
          item(9, 500, 'potential'),
          item(10, 400, 'inactive'),
          item(11, 300, 'paused'),
          item(12, 200, 'historical'),
        ],
        [
          line(6, 'A', CAT_A, 8),
          line(7, 'A', CAT_A, 9),
          line(8, 'A', CAT_A, 10),
          line(9, 'A', CAT_A, 11),
          line(10, 'A', CAT_A, 12),
        ],
      ),
    );
    expect(result.budgets).toEqual([{ categoryId: CAT_A, amountCents: 1000 }]);
  });

  it('una categoría que suma 0 no genera presupuesto y se cuenta como omitida', () => {
    const result = budgetsByCategory(
      plan(
        [item(8, 0, 'confirmed'), item(9, 900, 'potential'), item(10, 100, 'confirmed')],
        [line(6, 'A', CAT_A, 8), line(7, 'B', CAT_B, 9), line(8, 'C', CAT_C, 10)],
      ),
    );
    expect(result.budgets).toEqual([{ categoryId: CAT_C, amountCents: 100 }]);
    expect(result.omitted).toBe(2); // A vale 0; B solo tiene una línea fuera del plan base
  });

  it('no pierde precisión con importes grandes y falla si la suma sale del entero seguro', () => {
    const big = budgetsByCategory(
      plan(
        [item(8, 3_000_000_055, 'confirmed'), item(9, 1, 'confirmed')],
        [line(6, 'A', CAT_A, 8), line(7, 'A', CAT_A, 9)],
      ),
    );
    expect(big.budgets).toEqual([{ categoryId: CAT_A, amountCents: 3_000_000_056 }]);
    expect(() =>
      budgetsByCategory(
        plan(
          [item(8, Number.MAX_SAFE_INTEGER, 'confirmed'), item(9, 1, 'confirmed')],
          [line(6, 'A', CAT_A, 8), line(7, 'A', CAT_A, 9)],
        ),
      ),
    ).toThrow(RangeError);
  });

  it('rechaza una línea sin categoría o sin fila de Datos (la extracción no estaba validada)', () => {
    expect(() =>
      budgetsByCategory(plan([item(8, 100, 'confirmed')], [line(6, 'A', null, 8)])),
    ).toThrow(RangeError);
    expect(() =>
      budgetsByCategory(plan([item(8, 100, 'confirmed')], [line(6, 'A', CAT_A, 99)])),
    ).toThrow(RangeError);
  });
});

describe('decisiones aplicadas al leer', () => {
  const unmapped = (label: string): ImportIssue => ({
    code: 'CATEGORY_UNMAPPED',
    severity: 'error',
    sheet: 'Presupuesto',
    cell: 'A6',
    message: 'sin correspondencia',
    found: label,
  });
  const other: ImportIssue = {
    code: 'EVENT_REF_MONTHLY',
    severity: 'info',
    sheet: 'Eventos y compromisos',
    cell: 'C7',
    message: 'información',
  };

  it('effectivePlan pone la categoría decidida, también sobre una coincidencia por nombre', () => {
    const original = plan(
      [item(8, 100, 'confirmed')],
      [line(6, 'ocio', null, 8), line(7, 'vivienda', CAT_A, 8)],
    );
    const effective = effectivePlan(original, {
      categoryMappings: { ocio: CAT_B, vivienda: CAT_C },
    });
    expect(effective.budgetLines.map((entry) => entry.categoryId)).toEqual([CAT_B, CAT_C]);
    // Lo extraído no se modifica: retirar la decisión devuelve el lote a como se subió.
    expect(original.budgetLines.map((entry) => entry.categoryId)).toEqual([null, CAT_A]);
  });

  it('sin decisiones devuelve el mismo plan', () => {
    const original = plan([], []);
    expect(effectivePlan(original, { categoryMappings: {} })).toBe(original);
  });

  it('effectiveIssues solo quita los CATEGORY_UNMAPPED ya decididos (por nombre normalizado)', () => {
    const issues = [unmapped('Ocio '), unmapped('Alimentación'), other];
    expect(effectiveIssues(issues, { categoryMappings: { ocio: CAT_A } })).toEqual([
      unmapped('Alimentación'),
      other,
    ]);
    expect(effectiveIssues(issues, { categoryMappings: { alimentacion: CAT_A } })).toEqual([
      unmapped('Ocio '),
      other,
    ]);
    expect(effectiveIssues(issues, { categoryMappings: {} })).toEqual(issues);
  });
});
