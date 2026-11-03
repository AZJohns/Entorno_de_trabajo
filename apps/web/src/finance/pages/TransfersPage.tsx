/** Transferencias entre cuentas propias: lista con filtros, alta, edición y borrado con confirmación. */
import { listTransfersQuerySchema, type TransferResponse } from '@backoffice/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button, ErrorMessage, Loading } from '../../ui/forms.tsx';
import { ConfirmBar, DateField, ProblemNotice, SelectField } from '../../ui/finance-forms.tsx';
import { money } from '../amount.ts';
import { formatDate } from '../dates.ts';
import { TransferForm } from '../forms/TransferForm.tsx';
import {
  NO_TRANSFER_FILTERS,
  useAccounts,
  useCreateTransfer,
  useDeleteTransfer,
  useTransfers,
  useUpdateTransfer,
  type TransferFilters,
} from '../queries.ts';

type Mode = { kind: 'none' } | { kind: 'create' } | { kind: 'edit'; transfer: TransferResponse };

export function TransfersPage() {
  const [draft, setDraft] = useState<TransferFilters>(NO_TRANSFER_FILTERS);
  const [filters, setFilters] = useState<TransferFilters>(NO_TRANSFER_FILTERS);
  const [filterError, setFilterError] = useState<string | undefined>();
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [deleting, setDeleting] = useState<string | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);

  const allAccounts = useAccounts(true);
  const transfers = useTransfers(filters);
  const create = useCreateTransfer();
  const update = useUpdateTransfer();
  const remove = useDeleteTransfer();

  const accountName = new Map(allAccounts.data?.map((a) => [a.id, a.name]));
  const activeAccounts = allAccounts.data?.filter((account) => !account.archived) ?? [];

  function close(): void {
    setMode({ kind: 'none' });
    create.reset();
    update.reset();
    queueMicrotask(() => newButton.current?.focus());
  }

  function applyFilters(event: FormEvent): void {
    event.preventDefault();
    const check = listTransfersQuerySchema.safeParse(
      Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== '')),
    );
    if (!check.success) {
      setFilterError('La fecha «desde» no puede ser posterior a «hasta»');
      return;
    }
    setFilterError(undefined);
    setFilters(draft);
  }
  const setField = (field: keyof TransferFilters) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const rows = transfers.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Transferencias</h1>
        <button
          ref={newButton}
          type="button"
          onClick={() => setMode({ kind: 'create' })}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Nueva transferencia
        </button>
      </div>
      <p className="text-sm text-slate-600">
        Mover dinero entre tus cuentas no es un gasto ni un ingreso: solo cambia el saldo de cada
        una.
      </p>

      {mode.kind === 'create' && (
        <TransferForm
          accounts={activeAccounts}
          onCreate={(request) => create.mutate(request, { onSuccess: close })}
          onUpdate={() => undefined}
          onCancel={close}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {mode.kind === 'edit' && (
        <TransferForm
          accounts={activeAccounts}
          transfer={mode.transfer}
          onCreate={() => undefined}
          onUpdate={(transfer, body) =>
            update.mutate({ id: transfer.id, body }, { onSuccess: close })
          }
          onCancel={close}
          pending={update.isPending}
          error={update.error}
        />
      )}

      <form
        onSubmit={applyFilters}
        noValidate
        aria-label="Filtros de transferencias"
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
      >
        <DateField label="Desde" value={draft.from} onChange={setField('from')} required={false} />
        <DateField label="Hasta" value={draft.to} onChange={setField('to')} required={false} />
        <SelectField
          label="Cuenta (origen o destino)"
          value={draft.accountId}
          onChange={setField('accountId')}
          emptyLabel="Todas"
          options={(allAccounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        {filterError !== undefined && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-3">
            {filterError}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-3">
          <Button>Filtrar</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(NO_TRANSFER_FILTERS);
              setFilters(NO_TRANSFER_FILTERS);
              setFilterError(undefined);
            }}
          >
            Quitar filtros
          </Button>
        </div>
      </form>

      {transfers.isPending && <Loading />}
      <ErrorMessage error={transfers.error} />
      {transfers.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-600">No hay transferencias con estos filtros.</p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((transfer) => {
          const from = accountName.get(transfer.fromAccountId) ?? 'Cuenta';
          const to = accountName.get(transfer.toAccountId) ?? 'Cuenta';
          return (
            <li
              key={transfer.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {from} → {to}
                  </p>
                  <p className="text-sm text-slate-600">
                    {formatDate(transfer.bookedOn)}
                    {transfer.note !== null && ` · ${transfer.note}`}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums">{money(transfer.amountCents)}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    update.reset();
                    setMode({ kind: 'edit', transfer });
                  }}
                >
                  Editar
                  <span className="sr-only">
                    {' '}
                    transferencia de {from} a {to}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    remove.reset();
                    setDeleting(transfer.id);
                  }}
                >
                  Borrar
                  <span className="sr-only">
                    {' '}
                    transferencia de {from} a {to}
                  </span>
                </Button>
              </div>
              {deleting === transfer.id && (
                <>
                  <ConfirmBar
                    message={`¿Borrar la transferencia de ${money(transfer.amountCents)} de ${from} a ${to}? No se puede deshacer.`}
                    confirmLabel="Borrar transferencia"
                    pending={remove.isPending}
                    onConfirm={() =>
                      remove.mutate(transfer.id, { onSuccess: () => setDeleting(null) })
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

      {transfers.hasNextPage && (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={transfers.isFetchingNextPage}
            onClick={() => void transfers.fetchNextPage()}
          >
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}
