/**
 * Qué cambia en `category_budgets` al confirmar un mes importado (`planBudgetChanges`): función pura, sin base
 * de datos. Importes y categorías FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import {
  planBudgetChanges,
  type ExistingBudget,
} from '../../src/modules/finance/budget/domain/import-changes.ts';

const SNAPSHOT = '00000000-0000-4000-8000-0000000000aa';

const existing = (
  id: string,
  categoryId: string,
  amountCents: number,
  sourceSnapshotId: string | null,
): ExistingBudget => ({ id, categoryId, amountCents, sourceSnapshotId });

describe('planBudgetChanges', () => {
  it('un mes sin presupuestos: todo son altas', () => {
    const changes = planBudgetChanges([], [{ categoryId: 'a', amountCents: 100 }]);
    expect(changes).toEqual({
      inserts: [{ categoryId: 'a', amountCents: 100 }],
      updates: [],
      deletes: [],
      conflicts: [],
    });
  });

  it('sustituye los importados: cambia los que siguen, borra los que ya no están y crea los nuevos', () => {
    const changes = planBudgetChanges(
      [
        existing('1', 'a', 100, SNAPSHOT), // sigue, mismo importe
        existing('2', 'b', 200, SNAPSHOT), // sigue, cambia el importe
        existing('3', 'c', 300, SNAPSHOT), // desaparece
      ],
      [
        { categoryId: 'a', amountCents: 100 },
        { categoryId: 'b', amountCents: 250 },
        { categoryId: 'd', amountCents: 400 },
      ],
    );
    expect(changes.inserts).toEqual([{ categoryId: 'd', amountCents: 400 }]);
    expect(changes.updates).toEqual([
      { id: '1', categoryId: 'a', amountCents: 100, amountChanged: false },
      { id: '2', categoryId: 'b', amountCents: 250, amountChanged: true },
    ]);
    expect(changes.deletes).toEqual([{ id: '3', categoryId: 'c' }]);
    expect(changes.conflicts).toEqual([]);
  });

  it('una categoría que ya no se incluye (suma 0) pierde su presupuesto importado', () => {
    const changes = planBudgetChanges([existing('1', 'a', 100, SNAPSHOT)], []);
    expect(changes.deletes).toEqual([{ id: '1', categoryId: 'a' }]);
  });

  it('los presupuestos manuales no se tocan, ni se borran aunque su categoría no esté', () => {
    const changes = planBudgetChanges(
      [existing('1', 'a', 100, null), existing('2', 'b', 200, null)],
      [{ categoryId: 'c', amountCents: 300 }],
    );
    expect(changes.deletes).toEqual([]);
    expect(changes.updates).toEqual([]);
    expect(changes.inserts).toEqual([{ categoryId: 'c', amountCents: 300 }]);
    expect(changes.conflicts).toEqual([]);
  });

  it('chocar con un presupuesto manual es un conflicto (y no se propone sobrescribirlo)', () => {
    const changes = planBudgetChanges(
      [existing('1', 'a', 100, null), existing('2', 'b', 200, SNAPSHOT)],
      [
        { categoryId: 'a', amountCents: 150 },
        { categoryId: 'b', amountCents: 250 },
      ],
    );
    expect(changes.conflicts).toEqual(['a']);
    expect(changes.updates.map((update) => update.id)).toEqual(['2']);
  });
});
