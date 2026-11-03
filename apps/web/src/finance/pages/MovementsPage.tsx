/**
 * Movimientos: lista con los filtros de la API (paginada por cursor), alta, edición, borrado con
 * confirmación y confirmación de los borradores pendientes.
 */
import { listMovementsQuerySchema, type MovementResponse } from '@backoffice/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button, ErrorMessage, Loading } from '../../ui/forms.tsx';
import {
  ConfirmBar,
  DateField,
  ProblemNotice,
  SelectField,
  TextField,
} from '../../ui/finance-forms.tsx';
import { money } from '../amount.ts';
import { formatDate } from '../dates.ts';
import { MovementForm } from '../forms/MovementForm.tsx';
import {
  NO_MOVEMENT_FILTERS,
  useAccounts,
  useCategories,
  useConfirmMovement,
  useCreateMovement,
  useDeleteMovement,
  useMovements,
  useUpdateMovement,
  type MovementFilters,
} from '../queries.ts';

type Mode = { kind: 'none' } | { kind: 'create' } | { kind: 'edit'; movement: MovementResponse };

export function MovementsPage() {
  const [draft, setDraft] = useState<MovementFilters>(NO_MOVEMENT_FILTERS);
  const [filters, setFilters] = useState<MovementFilters>(NO_MOVEMENT_FILTERS);
  const [filterError, setFilterError] = useState<string | undefined>();
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [deleting, setDeleting] = useState<string | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);

  const allAccounts = useAccounts(true);
  const allCategories = useCategories(true);
  const movements = useMovements(filters);
  const create = useCreateMovement();
  const update = useUpdateMovement();
  const remove = useDeleteMovement();
  const confirm = useConfirmMovement();

  const accountName = new Map(allAccounts.data?.map((a) => [a.id, a.name]));
  const categoryName = new Map(allCategories.data?.map((c) => [c.id, c.name]));
  const activeAccounts = allAccounts.data?.filter((account) => !account.archived) ?? [];
  const activeCategories = allCategories.data?.filter((category) => !category.archived) ?? [];

  function close(): void {
    setMode({ kind: 'none' });
    create.reset();
    update.reset();
    queueMicrotask(() => newButton.current?.focus());
  }

  function applyFilters(event: FormEvent): void {
    event.preventDefault();
    // Mismas reglas que la API (p. ej. «desde» no posterior a «hasta»), con el mensaje en español.
    if (draft.from !== '' && draft.to !== '' && draft.from > draft.to) {
      setFilterError('La fecha «desde» no puede ser posterior a «hasta»');
      return;
    }
    const check = listMovementsQuerySchema.safeParse(
      Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== '')),
    );
    if (!check.success) {
      setFilterError('Alguno de los filtros no es válido');
      return;
    }
    setFilterError(undefined);
    setFilters(draft);
  }

  const setField = (field: keyof MovementFilters) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const rows = movements.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Movimientos</h1>
        <button
          ref={newButton}
          type="button"
          onClick={() => setMode({ kind: 'create' })}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Nuevo movimiento
        </button>
      </div>

      {mode.kind === 'create' && (
        <MovementForm
          accounts={activeAccounts}
          categories={activeCategories}
          onCreate={(request) => create.mutate(request, { onSuccess: close })}
          onUpdate={() => undefined}
          onCancel={close}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {mode.kind === 'edit' && (
        <MovementForm
          accounts={activeAccounts}
          categories={activeCategories}
          movement={mode.movement}
          onCreate={() => undefined}
          onUpdate={(movement, body) =>
            update.mutate({ id: movement.id, body }, { onSuccess: close })
          }
          onCancel={close}
          pending={update.isPending}
          error={update.error}
        />
      )}

      <form
        onSubmit={applyFilters}
        noValidate
        aria-label="Filtros de movimientos"
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
      >
        <DateField label="Desde" value={draft.from} onChange={setField('from')} required={false} />
        <DateField label="Hasta" value={draft.to} onChange={setField('to')} required={false} />
        <SelectField
          label="Cuenta"
          value={draft.accountId}
          onChange={setField('accountId')}
          emptyLabel="Todas"
          options={(allAccounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <SelectField
          label="Categoría"
          value={draft.categoryId}
          onChange={setField('categoryId')}
          emptyLabel="Todas"
          options={(allCategories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <SelectField
          label="Tipo"
          value={draft.kind}
          onChange={setField('kind')}
          emptyLabel="Todos"
          options={[
            { value: 'expense', label: 'Gastos' },
            { value: 'income', label: 'Ingresos' },
          ]}
        />
        <SelectField
          label="Estado"
          value={draft.status}
          onChange={setField('status')}
          emptyLabel="Todos"
          options={[
            { value: 'confirmed', label: 'Confirmados' },
            { value: 'pending', label: 'Pendientes' },
          ]}
        />
        <SelectField
          label="Origen"
          value={draft.source}
          onChange={setField('source')}
          emptyLabel="Todos"
          options={[
            { value: 'manual', label: 'Manuales' },
            { value: 'reconciliation', label: 'Ajustes de conciliación' },
          ]}
        />
        <TextField
          label="Buscar en concepto y comercio"
          value={draft.q}
          onChange={setField('q')}
          maxLength={100}
        />
        {filterError !== undefined && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {filterError}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button>Filtrar</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(NO_MOVEMENT_FILTERS);
              setFilters(NO_MOVEMENT_FILTERS);
              setFilterError(undefined);
            }}
          >
            Quitar filtros
          </Button>
        </div>
      </form>

      {movements.isPending && <Loading />}
      <ErrorMessage error={movements.error} />
      {movements.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-600">No hay movimientos con estos filtros.</p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((movement) => {
          const adjustment = movement.source === 'reconciliation';
          const sign = movement.kind === 'income' ? '+' : '−';
          const title = movement.description ?? movement.merchant ?? 'Sin concepto';
          return (
            <li
              key={movement.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {title}
                    {movement.status === 'pending' && (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs">
                        Pendiente
                      </span>
                    )}
                    {adjustment && (
                      <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs">
                        Ajuste de conciliación
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-600">
                    {formatDate(movement.bookedOn)} ·{' '}
                    {movement.accountId === null
                      ? 'Sin cuenta'
                      : (accountName.get(movement.accountId) ?? 'Cuenta')}
                    {movement.categoryId !== null &&
                      ` · ${categoryName.get(movement.categoryId) ?? 'Categoría'}`}
                  </p>
                </div>
                <p
                  className={`text-lg font-semibold tabular-nums ${movement.kind === 'income' ? 'text-green-700' : 'text-slate-900'}`}
                >
                  <span className="sr-only">
                    {movement.kind === 'income' ? 'Ingreso: ' : 'Gasto: '}
                  </span>
                  {sign}
                  {money(movement.amountCents)}
                </p>
              </div>

              {adjustment ? (
                <p className="text-xs text-slate-500">
                  Se borra junto con su conciliación (en la pantalla de conciliación de la cuenta).
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {movement.status === 'pending' && (
                    <Button
                      type="button"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate(movement.id)}
                    >
                      Confirmar<span className="sr-only"> {title}</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      update.reset();
                      setMode({ kind: 'edit', movement });
                    }}
                  >
                    Editar<span className="sr-only"> {title}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => {
                      remove.reset();
                      setDeleting(movement.id);
                    }}
                  >
                    Borrar<span className="sr-only"> {title}</span>
                  </Button>
                </div>
              )}
              {confirm.isError && confirm.variables === movement.id && (
                <ProblemNotice error={confirm.error} />
              )}
              {deleting === movement.id && (
                <>
                  <ConfirmBar
                    message={`¿Borrar el movimiento «${title}» de ${sign}${money(movement.amountCents)}? No se puede deshacer.`}
                    confirmLabel="Borrar movimiento"
                    pending={remove.isPending}
                    onConfirm={() =>
                      remove.mutate(movement.id, { onSuccess: () => setDeleting(null) })
                    }
                    onCancel={() => setDeleting(null)}
                  />
                  <ProblemNotice error={remove.error} />
                </>
              )}
            </li>
          );
        })}
      </ul>

      {movements.hasNextPage && (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={movements.isFetchingNextPage}
            onClick={() => void movements.fetchNextPage()}
          >
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}
