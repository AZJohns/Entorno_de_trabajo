/** Gráfico 1: ingresos y gastos de cada mes (barras agrupadas). Los ajustes de conciliación no entran. */
import type { MonthlyReportRow } from '@backoffice/shared';
import { money } from '../amount.ts';
import { formatMonth } from '../dates.ts';
import { DataTable } from './DataTable.tsx';
import { EXPENSE_COLOR, INCOME_COLOR } from './palette.ts';
import { niceAxis, position } from './scale.ts';

const W = 640;
const H = 260;
const LEFT = 84;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 30;

/** `2026-10` → `oct 26`, para que quepa en el eje. */
function shortMonth(month: string): string {
  return `${formatMonth(month).slice(0, 3)} ${month.slice(2, 4)}`;
}

export function MonthlyBarsChart({ rows }: { rows: readonly MonthlyReportRow[] }) {
  const axis = niceAxis(rows.flatMap((row) => [row.incomeCents, row.expenseCents]));
  const y = (value: number) => position(axis, value, H - BOTTOM, TOP);
  const slot = (W - LEFT - RIGHT) / Math.max(1, rows.length);
  const bar = Math.min(26, slot * 0.38);
  return (
    <figure>
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 text-sm">
        <span className="font-medium">Ingresos y gastos por mes</span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-3 w-3" style={{ background: INCOME_COLOR }} /> Ingresos
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-3 w-3" style={{ background: EXPENSE_COLOR }} /> Gastos
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label="Gráfico de barras de ingresos y gastos por mes. Los datos están en la tabla de debajo."
        className="w-full"
      >
        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" />
            <text x={LEFT - 6} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="#475569">
              {money(tick)}
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          const center = LEFT + slot * (index + 0.5);
          return (
            <g key={row.month}>
              <rect
                x={center - bar - 1}
                y={y(row.incomeCents)}
                width={bar}
                height={Math.max(0, y(0) - y(row.incomeCents))}
                fill={INCOME_COLOR}
              />
              <rect
                x={center + 1}
                y={y(row.expenseCents)}
                width={bar}
                height={Math.max(0, y(0) - y(row.expenseCents))}
                fill={EXPENSE_COLOR}
              />
              <text x={center} y={H - 10} textAnchor="middle" fontSize="10" fill="#475569">
                {shortMonth(row.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable
        caption="Ingresos, gastos, neto, ajustes y pendientes por mes"
        head={['Mes', 'Ingresos', 'Gastos', 'Neto', 'Ajustes de conciliación', 'Pendientes']}
        rows={rows.map((row) => [
          formatMonth(row.month),
          money(row.incomeCents),
          money(row.expenseCents),
          money(row.netCents),
          money(row.adjustmentsCents),
          row.pending.count === 0
            ? '—'
            : `${String(row.pending.count)} (ingresos ${money(row.pending.incomeCents)}, gastos ${money(row.pending.expenseCents)})`,
        ])}
      />
    </figure>
  );
}
