/**
 * Informes del libro (`/reports/*`). Lee filas con el repositorio y calcula con las funciones puras de
 * `domain/`; aquí no hay sumas propias ni SQL de agregación (docs/plan.md §2.3).
 *
 * Códigos de error: 422 si el rango de meses supera {@link MAX_REPORT_MONTHS}.
 */
import type { Kysely } from 'kysely';
import {
  MAX_REPORT_MONTHS,
  type BalanceHistoryResponse,
  type BalancesReportResponse,
  type CategoryReportResponse,
  type MonthlyReportResponse,
} from '@backoffice/shared';
import type { Database } from '../../../db/schema.ts';
import { AppError } from '../../../http/errors.ts';
import { lastDayOfMonth, monthsBetween, type YearMonth } from './domain/dates.ts';
import {
  accountBalanceLine,
  categoryBreakdown,
  monthlyReport,
  sumCents,
} from './domain/reports.ts';
import { LedgerRepository } from './ledger.repository.ts';

function assertRangeSize(from: YearMonth, to: YearMonth): YearMonth[] {
  const months = monthsBetween(from, to);
  if (months.length > MAX_REPORT_MONTHS) {
    const message = `El rango admite como máximo ${String(MAX_REPORT_MONTHS)} meses`;
    throw new AppError('UNPROCESSABLE', 422, message, [{ path: 'from', message }]);
  }
  return months;
}

export class ReportsService {
  readonly #repo: LedgerRepository;

  constructor(db: Kysely<Database>) {
    this.#repo = new LedgerRepository(db);
  }

  /** Ingresos, gastos, neto, ajustes y pendientes de cada mes de `from` a `to`. */
  async monthly(from: YearMonth, to: YearMonth): Promise<MonthlyReportResponse> {
    assertRangeSize(from, to);
    const movements = await this.#repo.listMovementsBetween(`${from}-01`, lastDayOfMonth(to));
    return { items: monthlyReport(movements, from, to) };
  }

  /** Desglose por categoría de un mes (sin ajustes de conciliación). */
  async categories(month: YearMonth): Promise<CategoryReportResponse> {
    const [movements, categories] = await Promise.all([
      this.#repo.listMovementsBetween(`${month}-01`, lastDayOfMonth(month)),
      this.#repo.listCategories(true),
    ]);
    const names = new Map(categories.map((category) => [category.id, category.name]));
    return {
      month,
      items: categoryBreakdown(movements, `${month}-01`).map((total) => ({
        ...total,
        name: total.categoryId === null ? null : (names.get(total.categoryId) ?? null),
      })),
    };
  }

  /**
   * Saldo de cada cuenta abierta en `at`, con la parte debida a ajustes en su propio campo. Incluye las
   * archivadas (el campo `archived` permite a la web ocultarlas); no las cuentas que aún no existían.
   */
  async balances(at: string): Promise<BalancesReportResponse> {
    const accounts = await this.#repo.listAccounts(true);
    const ledgers = await this.#repo.loadLedgers(accounts);
    const lines = accounts.flatMap((account) => {
      const ledger = ledgers.get(account.id);
      const line =
        ledger === undefined ? null : accountBalanceLine(ledger, account.openingDate, at);
      return line === null
        ? []
        : [
            {
              ...line,
              name: account.name,
              type: account.type,
              archived: account.archivedAt !== null,
            },
          ];
    });
    return {
      at,
      accounts: lines,
      totalCents: sumCents(lines.map((line) => line.balanceCents)),
      totalAdjustmentsCents: sumCents(lines.map((line) => line.adjustmentsCents)),
    };
  }

  /** Saldo de cada cuenta a fin de cada mes de `from` a `to` (`null` antes de su apertura). */
  async balanceHistory(from: YearMonth, to: YearMonth): Promise<BalanceHistoryResponse> {
    const months = assertRangeSize(from, to);
    const accounts = await this.#repo.listAccounts(true);
    const ledgers = await this.#repo.loadLedgers(accounts);
    const series = accounts.map((account) => {
      const ledger = ledgers.get(account.id);
      return {
        accountId: account.id,
        name: account.name,
        archived: account.archivedAt !== null,
        balancesCents: months.map((month) =>
          ledger === undefined
            ? null
            : (accountBalanceLine(ledger, account.openingDate, lastDayOfMonth(month))
                ?.balanceCents ?? null),
        ),
      };
    });
    return {
      months,
      accounts: series,
      totalsCents: months.map((_, index) =>
        sumCents(series.map((account) => account.balancesCents[index] ?? 0)),
      ),
    };
  }
}
