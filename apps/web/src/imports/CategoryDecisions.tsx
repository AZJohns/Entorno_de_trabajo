/**
 * Correspondencia entre las categorías del Excel y las categorías de gasto de la app. Cada cambio se envía
 * al momento (`PATCH /imports/:id/decisions`) y la vista previa se actualiza con la respuesta. Las
 * categorías que se ofrecen son solo las de gasto no archivadas; la API lo vuelve a comprobar (422).
 */
import type { CategoryResponse } from '@backoffice/shared';
import { useId } from 'react';
import type { CategoryRow } from './previewLogic.ts';

interface Props {
  rows: readonly CategoryRow[];
  /** Todas las categorías activas; aquí se filtran las de gasto. */
  categories: readonly CategoryResponse[];
  disabled: boolean;
  onChoose: (categoryKey: string, categoryId: string | null) => void;
}

function Row({
  row,
  options,
  disabled,
  onChoose,
}: {
  row: CategoryRow;
  options: readonly CategoryResponse[];
  disabled: boolean;
  onChoose: Props['onChoose'];
}) {
  const id = useId();
  const known = options.some((category) => category.id === row.categoryId);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 flex-col">
        <span id={`${id}-name`} className="font-medium break-words">
          {row.label}
        </span>
        <span className="text-xs text-slate-500">
          {row.lines === 1 ? '1 línea' : `${String(row.lines)} líneas`} en la hoja Presupuesto
          {row.categoryId === null && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 font-medium text-red-800">
              <span aria-hidden="true">✕ </span>Sin categoría
            </span>
          )}
        </span>
      </div>
      <select
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-help`}
        value={known && row.categoryId !== null ? row.categoryId : ''}
        disabled={disabled}
        onChange={(event) =>
          onChoose(row.key, event.target.value === '' ? null : event.target.value)
        }
        className="min-w-0 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none disabled:opacity-50"
      >
        <option value="">Sin elegir</option>
        {options.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <span id={`${id}-help`} className="sr-only">
        Categoría de gasto de la app a la que corresponde esta categoría del Excel
      </span>
    </li>
  );
}

export function CategoryDecisions({ rows, categories, disabled, onChoose }: Props) {
  const options = categories.filter(
    (category) => category.kind === 'expense' && !category.archived,
  );
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <Row key={row.key} row={row} options={options} disabled={disabled} onChoose={onChoose} />
      ))}
    </ul>
  );
}
