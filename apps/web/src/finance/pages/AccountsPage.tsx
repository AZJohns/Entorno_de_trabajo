/** Cuentas: lista con saldo, alta, edición y archivado. */
import type { AccountResponse } from '@backoffice/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Checkbox, ErrorMessage, Loading } from '../../ui/forms.tsx';
import { ConfirmBar, ProblemNotice } from '../../ui/finance-forms.tsx';
import { money } from '../amount.ts';
import { formatDate } from '../dates.ts';
import { AccountForm, ACCOUNT_TYPE_LABELS } from '../forms/AccountForm.tsx';
import { useAccounts, useArchiveAccount, useCreateAccount, useUpdateAccount } from '../queries.ts';

type Mode = { kind: 'none' } | { kind: 'create' } | { kind: 'edit'; account: AccountResponse };

export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [archiving, setArchiving] = useState<string | null>(null);
  const accounts = useAccounts(showArchived);
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const archive = useArchiveAccount();
  const newButton = useRef<HTMLButtonElement>(null);

  function close(): void {
    setMode({ kind: 'none' });
    create.reset();
    update.reset();
    // El foco vuelve al botón que abrió el formulario.
    queueMicrotask(() => newButton.current?.focus());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Cuentas</h1>
        <button
          ref={newButton}
          type="button"
          onClick={() => setMode({ kind: 'create' })}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Nueva cuenta
        </button>
      </div>

      {mode.kind === 'create' && (
        <AccountForm
          onCreate={(request) => create.mutate(request, { onSuccess: close })}
          onUpdate={() => undefined}
          onCancel={close}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {mode.kind === 'edit' && (
        <AccountForm
          account={mode.account}
          onCreate={() => undefined}
          onUpdate={(account, body) =>
            update.mutate({ id: account.id, body }, { onSuccess: close })
          }
          onCancel={close}
          pending={update.isPending}
          error={update.error}
        />
      )}

      <Checkbox label="Mostrar archivadas" checked={showArchived} onChange={setShowArchived} />

      {accounts.isPending && <Loading />}
      <ErrorMessage error={accounts.error} />
      {accounts.data?.length === 0 && (
        <p className="text-sm text-slate-600">Todavía no hay cuentas.</p>
      )}
      <ul className="flex flex-col gap-3">
        {accounts.data?.map((account) => (
          <li
            key={account.id}
            className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  {account.name}
                  {account.archived && (
                    <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-normal">
                      Archivada
                    </span>
                  )}
                </h2>
                <p className="text-sm text-slate-600">
                  {ACCOUNT_TYPE_LABELS[account.type]} · abierta el {formatDate(account.openingDate)}
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums">
                <span className="sr-only">Saldo: </span>
                {money(account.balanceCents)}
              </p>
            </div>

            {!account.archived && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    update.reset();
                    setMode({ kind: 'edit', account });
                  }}
                >
                  Editar<span className="sr-only"> {account.name}</span>
                </Button>
                <Link
                  to={`/cuentas/${account.id}/conciliacion`}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
                >
                  Conciliar<span className="sr-only"> {account.name}</span>
                </Link>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    archive.reset();
                    setArchiving(account.id);
                  }}
                >
                  Archivar<span className="sr-only"> {account.name}</span>
                </Button>
              </div>
            )}

            {archiving === account.id && (
              <>
                <ConfirmBar
                  message={`¿Archivar «${account.name}»? Quedará congelada: no admitirá movimientos nuevos.`}
                  confirmLabel="Archivar cuenta"
                  pending={archive.isPending}
                  onConfirm={() =>
                    archive.mutate(account.id, { onSuccess: () => setArchiving(null) })
                  }
                  onCancel={() => setArchiving(null)}
                />
                {/* El 409 de la API dice el saldo actual y qué hacer (vaciar con una transferencia). */}
                <ProblemNotice error={archive.error} />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
