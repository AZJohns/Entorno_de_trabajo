/** Conciliación de una cuenta: crear, historial con el aviso de discrepancia y borrar. */
import type { ReconciliationResponse } from '@backoffice/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ErrorMessage, Loading, SuccessMessage } from '../../ui/forms.tsx';
import { ConfirmBar, ProblemNotice } from '../../ui/finance-forms.tsx';
import { money } from '../amount.ts';
import { formatDate, formatMonth } from '../dates.ts';
import { ReconciliationForm } from '../forms/ReconciliationForm.tsx';
import {
  useAccount,
  useCreateReconciliation,
  useDeleteReconciliation,
  useReconciliations,
} from '../queries.ts';

/** Texto del resultado de una conciliación recién creada. */
function outcomeText(differenceCents: number, computedBalanceCents: number): string {
  if (differenceCents === 0) {
    return `El libro cuadra con el banco (${money(computedBalanceCents)}). No hace falta ningún ajuste.`;
  }
  const direction = differenceCents > 0 ? 'ingreso' : 'gasto';
  return `El libro calculaba ${money(computedBalanceCents)} y el banco dice otra cosa: se ha creado un ajuste (${direction} de ${money(Math.abs(differenceCents))}).`;
}

function HistoryItem({ item }: { item: ReconciliationResponse }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteReconciliation();
  const { discrepancy } = item;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium capitalize">{formatMonth(item.month)}</h3>
        <p className="text-sm text-slate-600">Saldo del banco el {formatDate(item.asOf)}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 text-sm">
        <dt className="text-slate-600">Saldo del banco</dt>
        <dd className="text-right tabular-nums">{money(item.statementBalanceCents)}</dd>
        <dt className="text-slate-600">Calculado al conciliar</dt>
        <dd className="text-right tabular-nums">{money(item.computedBalanceCents)}</dd>
        <dt className="text-slate-600">Ajuste</dt>
        <dd className="text-right tabular-nums">
          {item.adjustmentMovementId === null
            ? 'Sin ajuste'
            : money(item.statementBalanceCents - item.computedBalanceCents)}
        </dd>
      </dl>
      {item.note !== null && <p className="text-sm text-slate-600">{item.note}</p>}
      {discrepancy.hasDiscrepancy && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Ya no cuadra con el banco.</strong> Hoy el libro da{' '}
          {money(discrepancy.currentBalanceCents)} a esa fecha y el banco dijo{' '}
          {money(item.statementBalanceCents)} (diferencia: {money(discrepancy.differenceCents)}). Se
          ha cambiado, añadido o borrado algo de ese periodo después de conciliar; revisa los
          movimientos o rehaz la conciliación.
        </p>
      )}
      <div>
        <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
          Borrar<span className="sr-only"> la conciliación de {formatMonth(item.month)}</span>
        </Button>
      </div>
      {confirming && (
        <>
          <ConfirmBar
            message={`¿Borrar la conciliación de ${formatMonth(item.month)}?${item.adjustmentMovementId === null ? '' : ' También se borrará su ajuste.'}`}
            confirmLabel="Borrar conciliación"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(item.id, { onSuccess: () => setConfirming(false) })}
            onCancel={() => setConfirming(false)}
          />
          <ProblemNotice error={remove.error} />
        </>
      )}
    </li>
  );
}

export function ReconciliationPage() {
  const { id = '' } = useParams();
  const account = useAccount(id);
  const history = useReconciliations(id);
  const create = useCreateReconciliation(id);

  if (account.isPending) return <Loading />;
  if (account.isError) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorMessage error={account.error} />
        <Link to="/cuentas" className="text-sm underline">
          Volver a las cuentas
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/cuentas" className="text-sm text-slate-600 underline">
          ← Cuentas
        </Link>
        <h1 className="text-2xl font-semibold">Conciliar «{account.data.name}»</h1>
        <p className="text-sm text-slate-600">
          Saldo actual en el libro:{' '}
          <strong className="tabular-nums">{money(account.data.balanceCents)}</strong>
        </p>
      </div>

      {account.data.archived ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm">
          La cuenta está archivada: no admite conciliaciones nuevas.
        </p>
      ) : (
        <ReconciliationForm
          onSubmit={(request) => create.mutate(request)}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {create.data !== undefined && (
        <SuccessMessage>
          {outcomeText(create.data.differenceCents, create.data.computedBalanceCents)}
        </SuccessMessage>
      )}

      <section aria-labelledby="history" className="flex flex-col gap-2">
        <h2 id="history" className="text-lg font-semibold">
          Historial
        </h2>
        {history.isPending && <Loading />}
        <ErrorMessage error={history.error} />
        {history.data?.length === 0 && (
          <p className="text-sm text-slate-600">Todavía no hay conciliaciones.</p>
        )}
        <ul className="flex flex-col gap-2">
          {history.data?.map((item) => (
            <HistoryItem key={item.id} item={item} />
          ))}
        </ul>
      </section>
    </div>
  );
}
