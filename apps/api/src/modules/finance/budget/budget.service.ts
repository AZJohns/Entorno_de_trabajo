/**
 * Reglas de negocio del presupuesto por categoría y mes (docs/plan.md §2.3b, fase 3a). No conoce `req`
 * ni `res`. Lo gastado no se guarda: se calcula al leer con `domain/budget.ts` sobre los movimientos
 * confirmados que lee `LedgerRepository` (el mismo criterio que los informes).
 *
 * Códigos de error (la base de datos impone además todas las restricciones de la migración 0005):
 * - 404: el presupuesto de la URL no existe.
 * - 422 (`UNPROCESSABLE`): el cuerpo es válido pero incoherente con el libro: la categoría no existe o
 *   es de ingreso, o no hay mes anterior al `0001-01`.
 * - 409 (`CONFLICT`): el estado actual lo impide: categoría archivada o ya existe el presupuesto de ese
 *   mes y categoría. Copiar del mes anterior nunca da 409 (ver `copyFromPreviousMonth`).
 */
import type { Kysely } from 'kysely';
import type {
  BudgetMonthResponse,
  CopyBudgetsResponse,
  CreateBudgetRequest,
} from '@backoffice/shared';
import { isUniqueViolation } from '../../../db/errors.ts';
import type { Database } from '../../../db/schema.ts';
import { AppError } from '../../../http/errors.ts';
import type { Clock } from '../../../lib/clock.ts';
import { lastDayOfMonth, previousMonth, type YearMonth } from '../ledger/domain/dates.ts';
import { LedgerRepository, type CategoryRecord } from '../ledger/ledger.repository.ts';
import { budgetProgress } from './domain/budget.ts';
import { BudgetRepository, type BudgetRecord } from './budget.repository.ts';

export interface BudgetServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

const BUDGET_EXISTS = 'category_budgets_month_category_key';

function unprocessable(path: string, message: string): AppError {
  return new AppError('UNPROCESSABLE', 422, message, [{ path, message }]);
}

function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message);
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'El presupuesto no existe');
}

function assertNotArchived(category: CategoryRecord): void {
  if (category.archivedAt !== null) {
    throw conflict(`La categoría «${category.name}» está archivada`);
  }
}

export class BudgetService {
  readonly #deps: BudgetServiceDeps;

  constructor(deps: BudgetServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Presupuestos de un mes con lo gastado y lo que queda, más el gasto de las categorías sin
   * presupuesto. Ordenados por nombre de categoría. Un mes sin presupuestos da la lista vacía (y, si hay
   * gasto, todo en `unbudgeted`).
   */
  async list(month: YearMonth): Promise<BudgetMonthResponse> {
    const first = `${month}-01`;
    const ledger = new LedgerRepository(this.#deps.db);
    const [budgets, movements, categories] = await Promise.all([
      new BudgetRepository(this.#deps.db).listByMonth(first),
      ledger.listMovementsBetween(first, lastDayOfMonth(month)),
      ledger.listCategories(true),
    ]);
    const byId = new Map(categories.map((category) => [category.id, category]));
    const progress = budgetProgress(budgets, movements, first);
    const items = progress.lines
      .map((line) => {
        const category = byId.get(line.categoryId);
        return {
          id: line.id,
          categoryId: line.categoryId,
          // La FK garantiza que existe; el respaldo solo satisface al tipo.
          categoryName: category?.name ?? '',
          categoryArchived: category !== undefined && category.archivedAt !== null,
          amountCents: line.amountCents,
          spentCents: line.spentCents,
          remainingCents: line.remainingCents,
        };
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.id.localeCompare(b.id));
    return {
      month,
      items,
      unbudgeted: progress.unbudgeted.map((entry) => ({
        categoryId: entry.categoryId,
        categoryName: entry.categoryId === null ? null : (byId.get(entry.categoryId)?.name ?? null),
        spentCents: entry.spentCents,
      })),
      totals: progress.totals,
    };
  }

  /** Crea el presupuesto de una categoría de gasto en un mes. */
  async create(input: CreateBudgetRequest): Promise<BudgetRecord> {
    const category = await new LedgerRepository(this.#deps.db).findCategory(input.categoryId);
    if (category === undefined) throw unprocessable('categoryId', 'La categoría no existe');
    if (category.kind !== 'expense') {
      throw unprocessable('categoryId', 'Solo se presupuestan las categorías de gasto');
    }
    assertNotArchived(category);
    try {
      return await new BudgetRepository(this.#deps.db).insert({
        month: `${input.month}-01`,
        categoryId: input.categoryId,
        amountCents: input.amountCents,
      });
    } catch (error) {
      if (isUniqueViolation(error, BUDGET_EXISTS)) {
        throw conflict(`Ya hay un presupuesto de «${category.name}» en ${input.month}`);
      }
      throw error;
    }
  }

  /** Cambia el importe. El mes y la categoría no se cambian: sería otro presupuesto. */
  async update(id: string, amountCents: number): Promise<BudgetRecord> {
    const repo = new BudgetRepository(this.#deps.db);
    const budget = await repo.find(id);
    if (budget === undefined) throw notFound();
    const category = await new LedgerRepository(this.#deps.db).findCategory(budget.categoryId);
    // La FK garantiza que la categoría existe; sin ella no habría presupuesto.
    if (category !== undefined) assertNotArchived(category);
    const updated = await repo.updateAmount(id, amountCents, this.#deps.clock.now());
    if (updated === undefined) throw notFound();
    return updated;
  }

  /** Borra el presupuesto (también el de una categoría archivada: es la forma de limpiarlo). */
  async delete(id: string): Promise<void> {
    if (!(await new BudgetRepository(this.#deps.db).delete(id))) throw notFound();
  }

  /**
   * Copia los presupuestos del mes anterior a `month`. Es una acción explícita, nunca automática.
   *
   * Solo rellena huecos: lo que `month` ya tiene no se toca ni se sobrescribe (se cuenta en
   * `skippedExisting`) y las categorías archivadas no se copian (`skippedArchived`). Es idempotente.
   * Va en una transacción y el alta ignora los duplicados en la propia base de datos, así que dos copias
   * a la vez no duplican nada.
   *
   * Respuesta coherente: siempre 200 con los recuentos, también cuando no queda nada por copiar (mes
   * anterior sin presupuestos o todo ya copiado: `copied: 0`). Es una acción idempotente y repetirla no
   * es un conflicto. El único error es el 422 cuando no existe mes anterior (`0001-01`).
   */
  async copyFromPreviousMonth(month: YearMonth): Promise<CopyBudgetsResponse> {
    const sourceMonth = previousMonth(month);
    if (sourceMonth === null) throw unprocessable('month', 'No hay un mes anterior a ese');
    return this.#deps.db.transaction().execute(async (trx) => {
      const budgets = new BudgetRepository(trx);
      const source = await budgets.listByMonth(`${sourceMonth}-01`);
      const categories = await new LedgerRepository(trx).listCategories(true);
      const archived = new Set(
        categories.filter((category) => category.archivedAt !== null).map(({ id }) => id),
      );
      const toCopy = source.filter((budget) => !archived.has(budget.categoryId));
      const copied = await budgets.insertMissing(
        toCopy.map((budget) => ({
          month: `${month}-01`,
          categoryId: budget.categoryId,
          amountCents: budget.amountCents,
        })),
      );
      return {
        month,
        sourceMonth,
        copied,
        skippedExisting: toCopy.length - copied,
        skippedArchived: source.length - toCopy.length,
      };
    });
  }
}
