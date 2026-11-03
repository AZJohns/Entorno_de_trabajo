/** Alta y edición de una transferencia entre cuentas propias. Presentacional. */
import type {
  AccountResponse,
  CreateTransferRequest,
  TransferResponse,
  UpdateTransferRequest,
} from '@backoffice/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../ui/forms.tsx';
import {
  AmountField,
  DateField,
  ProblemNotice,
  SelectField,
  TextField,
} from '../../ui/finance-forms.tsx';
import { amountToInput } from '../amount.ts';
import { todayLocal } from '../dates.ts';
import { buildCreateTransfer, buildTransferPatch, type TransferFormValues } from '../formLogic.ts';
import { useFocusInvalid } from './useFocusInvalid.ts';

interface Props {
  /** Cuentas activas. */
  accounts: readonly AccountResponse[];
  transfer?: TransferResponse;
  onCreate: (request: CreateTransferRequest) => void;
  onUpdate: (transfer: TransferResponse, patch: UpdateTransferRequest) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: unknown;
}

export function TransferForm({
  accounts,
  transfer,
  onCreate,
  onUpdate,
  onCancel,
  pending,
  error,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<TransferFormValues>(() =>
    transfer === undefined
      ? { fromAccountId: '', toAccountId: '', amount: '', bookedOn: todayLocal(), note: '' }
      : {
          fromAccountId: transfer.fromAccountId,
          toAccountId: transfer.toAccountId,
          amount: amountToInput(transfer.amountCents),
          bookedOn: transfer.bookedOn,
          note: transfer.note ?? '',
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusInvalid(formRef, errors);
  const set = (field: keyof TransferFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (transfer === undefined) {
      const result = buildCreateTransfer(values);
      setErrors(result.ok ? {} : result.errors);
      if (result.ok) onCreate(result.value);
      return;
    }
    const result = buildTransferPatch(values, transfer);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    if (result.value === null) onCancel();
    else onUpdate(transfer, result.value);
  }

  const options = accounts.map((account) => ({ value: account.id, label: account.name }));
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label={transfer === undefined ? 'Nueva transferencia' : 'Editar transferencia'}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">
        {transfer === undefined ? 'Nueva transferencia' : 'Editar transferencia'}
      </h2>
      <SelectField
        label="Cuenta de origen"
        value={values.fromAccountId}
        onChange={set('fromAccountId')}
        error={errors['fromAccountId']}
        emptyLabel="Elige la cuenta de origen"
        required={false}
        options={options}
      />
      <SelectField
        label="Cuenta de destino"
        value={values.toAccountId}
        onChange={set('toAccountId')}
        error={errors['toAccountId']}
        emptyLabel="Elige la cuenta de destino"
        required={false}
        options={options}
      />
      <AmountField
        label="Importe"
        value={values.amount}
        onChange={set('amount')}
        error={errors['amount']}
      />
      <DateField
        label="Fecha"
        value={values.bookedOn}
        onChange={set('bookedOn')}
        error={errors['bookedOn']}
      />
      <TextField
        label="Nota (opcional)"
        value={values.note}
        onChange={set('note')}
        error={errors['note']}
        maxLength={500}
      />
      <ProblemNotice error={error} />
      <div className="flex gap-2">
        <Button disabled={pending === true}>Guardar</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
