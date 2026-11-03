/** Gráfico 3: saldo a fin de cada mes (líneas), una por cuenta y el total. */
import type { BalanceHistoryResponse } from '@backoffice/shared';
import { money } from '../amount.ts';
import { formatMonth } from '../dates.ts';
import { DataTable } from './DataTable.tsx';
import { SERIES_COLORS } from './palette.ts';
import { niceAxis, position } from './scale.ts';

const W = 640;
const H = 260;
const LEFT = 84;
const RIGHT = 12;
const TOP = 10;
const BOTTOM = 30;

interface Series {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  readonly dashed: boolean;
}

/** Tramos continuos de una serie: un `null` (cuenta aún sin abrir) corta la línea. */
function segments(points: readonly ({ x: number; y: number } | null)[]) {
  const result: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point === null) {
      if (current.length > 0) result.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

export function BalanceLinesChart({ history }: { history: BalanceHistoryResponse }) {
  const series: Series[] = [
    {
      key: 'total',
      name: 'Total',
      color: '#0f172a',
      values: history.totalsCents,
      dashed: true,
    },
    ...history.accounts.map((account, index) => ({
      key: account.accountId,
      name: account.archived ? `${account.name} (archivada)` : account.name,
      color: SERIES_COLORS[index % SERIES_COLORS.length] ?? '#7F7F7F',
      values: account.balancesCents,
      dashed: false,
    })),
  ];
  const axis = niceAxis(series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const count = history.months.length;
  const x = (index: number) =>
    count === 1 ? (LEFT + W - RIGHT) / 2 : LEFT + (index / (count - 1)) * (W - LEFT - RIGHT);
  const y = (value: number) => position(axis, value, H - BOTTOM, TOP);
  const labelEvery = Math.ceil(count / 8);
  return (
    <figure>
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 text-sm">
        <span className="font-medium">Saldo a fin de cada mes</span>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <i
              className="inline-block h-0.5 w-4"
              style={{
                background: s.color,
                height: s.dashed ? 0 : undefined,
                borderTop: s.dashed ? `2px dashed ${s.color}` : undefined,
              }}
            />
            {s.name}
          </span>
        ))}
      </figcaption>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label="Gráfico de líneas del saldo a fin de cada mes por cuenta. Los datos están en la tabla de debajo."
        className="w-full"
      >
        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? '#94a3b8' : '#e2e8f0'}
            />
            <text x={LEFT - 6} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="#475569">
              {money(tick)}
            </text>
          </g>
        ))}
        {history.months.map((month, index) =>
          index % labelEvery === 0 ? (
            <text
              key={month}
              x={x(index)}
              y={H - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#475569"
            >
              {`${formatMonth(month).slice(0, 3)} ${month.slice(2, 4)}`}
            </text>
          ) : null,
        )}
        {series.map((s) =>
          segments(s.values.map((v, i) => (v === null ? null : { x: x(i), y: y(v) }))).map(
            (points, i) =>
              points.length === 1 ? (
                <circle
                  key={`${s.key}-${String(i)}`}
                  cx={points[0]?.x}
                  cy={points[0]?.y}
                  r="3"
                  fill={s.color}
                />
              ) : (
                <polyline
                  key={`${s.key}-${String(i)}`}
                  points={points.map((p) => `${String(p.x)},${String(p.y)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.dashed ? 2.5 : 2}
                  strokeDasharray={s.dashed ? '6 4' : undefined}
                />
              ),
          ),
        )}
      </svg>
      <DataTable
        caption="Saldo a fin de cada mes por cuenta"
        head={['Mes', ...series.map((s) => s.name)]}
        rows={history.months.map((month, index) => [
          formatMonth(month),
          ...series.map((s) => {
            const value = s.values[index];
            return value === null || value === undefined ? '—' : money(value);
          }),
        ])}
      />
    </figure>
  );
}
