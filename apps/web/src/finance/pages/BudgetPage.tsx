/**
 * Presupuesto por categoría y mes: una fila por categoría con presupuesto (presupuestado, gastado,
 * restante y barra), el gasto sin presupuesto aparte y los totales del mes. Las cifras las calcula la
 * API; aquí solo se dibujan y se gestionan altas, cambios, borrados y la copia del mes anterior.
 */
import type { BudgetMonthResponse } from '@backoffice/shared';
import { useId, useState } from 'react';
import { Button, ErrorMessage, Loading, SuccessMessage } from '../../ui/forms.tsx';
import { ConfirmBar, ProblemNotice } from '../../ui/finance-forms.tsx';
import { money } from '../amount.ts';
import { BudgetBar } from '../budget/BudgetBar.tsx';
import { copyResultMessage } from '../budgetLogic.ts';
import { formatMonth, monthOf, shiftMonth, todayLocal } from '../dates.ts';
import { BudgetForm } from '../forms/BudgetForm.tsx';
import {
  useBudgets,
  useCategories,
  useCopyBudgets,
  useCreateBudget,
  useDeleteBudget,
  useUpdateBudget,
} from '../queries.ts';

/** Meses que ofrece el selector: 12 hacia atrás y 6 hacia delante desde el mes actual. */
const MONTHS_BACK = 12;
const MONTHS_AHEAD = 6;
/** Primer mes que admite la API (`0001-01`): no se puede retroceder más. */
const FIRST_MONTH = '0001-01';

type Item = BudgetMonthResponse['items'][number];

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function remainingLabel(remainingCents: number): string {
  return remainingCents < 0 ? 'Te has pasado en' : 'Restante';
}

function BudgetRow({ item, month }: { item: Item; month: string }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateBudget();
  const remove = useDeleteBudget();

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {item.categoryName}
          {item.categoryArchived && (
            <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-normal">
              Archivada
            </span>
          )}
        </h3>
        <span className="flex gap-2">
          {!item.categoryArchived && (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Editar <span className="sr-only">presupuesto de {item.categoryName}</span>
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            Borrar <span className="sr-only">presupuesto de {item.categoryName}</span>
          </Button>
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Cell label="Presupuestado" value={money(item.amountCents)} />
        <Cell label="Gastado" value={money(item.spentCents)} />
        <Cell
          label={remainingLabel(item.remainingCents)}
          value={money(Math.abs(item.remainingCents))}
        />
      </dl>
      <BudgetBar
        name={item.categoryName}
        amountCents={item.amountCents}
        spentCents={item.spentCents}
      />
      {editing && (
        <BudgetForm
          month={month}
          budget={item}
          pending={update.isPending}
          error={update.error}
          onUpdate={(body) =>
            update.mutate({ id: item.id, body }, { onSuccess: () => setEditing(false) })
          }
          onCancel={() => {
            update.reset();
            setEditing(false);
          }}
        />
      )}
      {confirming && (
        <>
          <ConfirmBar
            message={`¿Borrar el presupuesto de «${item.categoryName}» de ${formatMonth(month)}? Los gastos no se tocan.`}
            confirmLabel="Borrar presupuesto"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(item.id, { onSuccess: () => setConfirming(false) })}
            onCancel={() => {
              remove.reset();
              setConfirming(false);
            }}
          />
          <ProblemNotice error={remove.error} />
        </>
      )}
    </li>
  );
}

const NAV_BUTTON =
  'shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50';

/**
 * Selector de mes en una tarjeta: «anterior», desplegable y «siguiente» en la misma línea (también en
 * móvil, donde los botones se acortan a una flecha). La etiqueta «Mes» es solo para lectores de
 * pantalla: el propio desplegable ya dice qué mes es.
 */
function MonthPicker(props: {
  month: string;
  options: readonly string[];
  canGoBack: boolean;
  onChange: (month: string) => void;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-label="Elegir mes"
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3"
    >
      <button
        type="button"
        aria-label="Mes anterior"
        disabled={!props.canGoBack}
        onClick={() => props.onChange(shiftMonth(props.month, -1))}
        className={NAV_BUTTON}
      >
        <span aria-hidden="true">←</span>
        <span aria-hidden="true" className="ml-1 hidden sm:inline">
          Anterior
        </span>
      </button>
      <label htmlFor={id} className="sr-only">
        Mes
      </label>
      <select
        id={id}
        value={props.month}
        onChange={(event) => props.onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none"
      >
        {props.options.map((value) => (
          <option key={value} value={value}>
            {formatMonth(value)}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Mes siguiente"
        onClick={() => props.onChange(shiftMonth(props.month, 1))}
        className={NAV_BUTTON}
      >
        <span aria-hidden="true" className="mr-1 hidden sm:inline">
          Siguiente
        </span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

export function BudgetPage() {
  const current = monthOf(todayLocal());
  const [month, setMonth] = useState(current);
  const budgets = useBudgets(month);
  const categories = useCategories(false);
  const create = useCreateBudget();
  const copy = useCopyBudgets();

  const monthOptions = Array.from({ length: MONTHS_BACK + MONTHS_AHEAD + 1 }, (_, i) =>
    shiftMonth(current, MONTHS_AHEAD - i),
  );
  // Con «Mes anterior/siguiente» se puede salir del rango del selector: el mes elegido siempre aparece.
  if (!monthOptions.includes(month)) monthOptions.push(month);

  const budgeted = new Set(budgets.data?.items.map((item) => item.categoryId));
  const available = (categories.data ?? [])
    .filter((category) => category.kind === 'expense' && !budgeted.has(category.id))
    .map((category) => ({ value: category.id, label: category.name }));

  function goTo(next: string): void {
    copy.reset();
    create.reset();
    setMonth(next);
  }

  const data = budgets.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Presupuesto</h1>

      <MonthPicker
        month={month}
        options={monthOptions}
        canGoBack={month > FIRST_MONTH}
        onChange={goTo}
      />

      {budgets.isPending && <Loading />}
      <ErrorMessage error={budgets.error} />

      {data !== undefined && (
        <>
          <section
            aria-labelledby="budget-totals"
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <h2 id="budget-totals" className="mb-2 text-lg font-semibold">
              Totales de {formatMonth(month)}
            </h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Cell label="Presupuestado" value={money(data.totals.budgetedCents)} />
              <Cell label="Gastado" value={money(data.totals.spentCents)} />
              <Cell
                label={remainingLabel(data.totals.remainingCents)}
                value={money(Math.abs(data.totals.remainingCents))}
              />
              <Cell label="Sin presupuesto" value={money(data.totals.unbudgetedSpentCents)} />
            </dl>
          </section>

          <section aria-labelledby="budget-lines" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="budget-lines" className="text-lg font-semibold">
                Presupuestos
              </h2>
              <Button
                type="button"
                variant="secondary"
                disabled={copy.isPending}
                onClick={() => copy.mutate(month)}
              >
                Copiar del mes anterior
              </Button>
            </div>
            {copy.isSuccess && <SuccessMessage>{copyResultMessage(copy.data)}</SuccessMessage>}
            <ProblemNotice error={copy.error} />
            {data.items.length === 0 && (
              <p className="text-sm text-slate-600">No hay presupuestos este mes.</p>
            )}
            <ul className="flex flex-col gap-2">
              {data.items.map((item) => (
                <BudgetRow key={item.id} item={item} month={month} />
              ))}
            </ul>
          </section>

          <BudgetForm
            // Al cambiar de mes o tras guardar se vacía el formulario.
            key={`${month}-${String(data.items.length)}`}
            month={month}
            categories={available}
            pending={create.isPending}
            error={create.error}
            onCreate={(body) => create.mutate(body)}
          />

          <section aria-labelledby="budget-unbudgeted" className="flex flex-col gap-2">
            <h2 id="budget-unbudgeted" className="text-lg font-semibold">
              Gastos sin presupuesto
            </h2>
            {data.unbudgeted.length === 0 ? (
              <p className="text-sm text-slate-600">
                Todos los gastos del mes están en categorías con presupuesto.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {data.unbudgeted.map((entry) => (
                  <li
                    key={entry.categoryId ?? 'sin-categoria'}
                    className="flex justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <span>{entry.categoryName ?? 'Sin categoría'}</span>
                    <span className="tabular-nums">{money(entry.spentCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
