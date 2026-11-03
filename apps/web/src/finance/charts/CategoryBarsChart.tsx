/** Gráfico 2: desglose por categoría de un mes (barras horizontales, gastos). Los ingresos van en la tabla. */
import type { CategoryReportResponse } from '@backoffice/shared';
import { money } from '../amount.ts';
import { formatMonth } from '../dates.ts';
import { DataTable } from './DataTable.tsx';
import { EXPENSE_COLOR } from './palette.ts';
import { niceAxis, position } from './scale.ts';

const W = 640;
const LEFT = 150;
const RIGHT = 90;
const ROW = 26;

const label = (item: { name: string | null }): string => item.name ?? 'Sin categoría';

export function CategoryBarsChart({ report }: { report: CategoryReportResponse }) {
  const expenses = report.items.filter((item) => item.kind === 'expense');
  const axis = niceAxis(expenses.map((item) => item.totalCents));
  const x = (value: number) => position(axis, value, LEFT, W - RIGHT);
  const height = Math.max(1, expenses.length) * ROW + 8;
  return (
    <figure>
      <figcaption className="mb-1 text-sm font-medium">
        Gastos por categoría — {formatMonth(report.month)}
      </figcaption>
      {expenses.length === 0 ? (
        <p className="text-sm text-slate-500">No hay gastos confirmados en este mes.</p>
      ) : (
        <svg
          viewBox={`0 0 ${String(W)} ${String(height)}`}
          role="img"
          aria-label={`Gráfico de barras de gastos por categoría en ${formatMonth(report.month)}. Los datos están en la tabla de debajo.`}
          className="w-full"
        >
          {expenses.map((item, index) => (
            <g key={item.categoryId ?? 'none'}>
              <text x={LEFT - 6} y={index * ROW + 19} textAnchor="end" fontSize="11" fill="#334155">
                {label(item)}
              </text>
              <rect
                x={x(0)}
                y={index * ROW + 6}
                width={Math.max(1, x(item.totalCents) - x(0))}
                height={ROW - 10}
                fill={EXPENSE_COLOR}
              />
              <text
                x={x(item.totalCents) + 6}
                y={index * ROW + 19}
                fontSize="11"
                fill="#334155"
                className="tabular-nums"
              >
                {money(item.totalCents)}
              </text>
            </g>
          ))}
        </svg>
      )}
      <DataTable
        caption={`Ingresos y gastos por categoría en ${formatMonth(report.month)}`}
        head={['Categoría', 'Tipo', 'Importe']}
        rows={report.items.map((item) => [
          label(item),
          item.kind === 'income' ? 'Ingreso' : 'Gasto',
          money(item.totalCents),
        ])}
      />
    </figure>
  );
}
