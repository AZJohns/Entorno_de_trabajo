/** Alta y edición de una cuenta. Presentacional. */
import {
  ACCOUNT_TYPES,
  type AccountResponse,
  type CreateAccountRequest,
  type UpdateAccountRequest,
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
import { buildAccountPatch, buildCreateAccount, type AccountFormValues } from '../formLogic.ts';
import { useFocusInvalid } from './useFocusInvalid.ts';

export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  checking: 'Cuenta corriente',
  savings: 'Ahorro',
  cash: 'Efectivo',
};

interface Props {
  account?: AccountResponse;
  onCreate: (request: CreateAccountRequest) => void;
  onUpdate: (account: AccountResponse, patch: UpdateAccountRequest) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: unknown;
}

export function AccountForm({ account, onCreate, onUpdate, onCancel, pending, error }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<AccountFormValues>(() =>
    account === undefined
      ? { name: '', type: 'checking', openingBalance: '', openingDate: todayLocal() }
      : {
          name: account.name,
          type: account.type,
          openingBalance: amountToInput(account.openingBalanceCents),
          openingDate: account.openingDate,
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusInvalid(formRef, errors);
  const set = (field: keyof AccountFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (account === undefined) {
      const result = buildCreateAccount(values);
      setErrors(result.ok ? {} : result.errors);
      if (result.ok) onCreate(result.value);
      return;
    }
    const result = buildAccountPatch(values, account);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    if (result.value === null) onCancel();
    else onUpdate(account, result.value);
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label={account === undefined ? 'Nueva cuenta' : 'Editar cuenta'}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">
        {account === undefined ? 'Nueva cuenta' : 'Editar cuenta'}
      </h2>
      <TextField
        label="Nombre"
        value={values.name}
        onChange={set('name')}
        error={errors['name']}
        maxLength={100}
        autoFocus
      />
      <SelectField
        label="Tipo"
        value={values.type}
        onChange={set('type')}
        error={errors['type']}
        options={ACCOUNT_TYPES.map((type) => ({ value: type, label: ACCOUNT_TYPE_LABELS[type] }))}
      />
      <AmountField
        label="Saldo de apertura"
        value={values.openingBalance}
        onChange={set('openingBalance')}
        error={errors['openingBalance']}
        hint="Saldo al inicio de la fecha de apertura; puede ser negativo. Vacío = 0"
      />
      <DateField
        label="Fecha de apertura"
        value={values.openingDate}
        onChange={set('openingDate')}
        error={errors['openingDate']}
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
