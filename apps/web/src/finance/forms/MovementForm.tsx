/** Alta y edición de un movimiento. Presentacional: no conoce react-query, solo recibe callbacks. */
import type {
  AccountResponse,
  CategoryResponse,
  CreateMovementRequest,
  MovementResponse,
  UpdateMovementRequest,
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
import { buildCreateMovement, buildMovementPatch, type MovementFormValues } from '../formLogic.ts';
import { useFocusInvalid } from './useFocusInvalid.ts';

interface Props {
  /** Cuentas y categorías activas (las archivadas no admiten movimientos nuevos). */
  accounts: readonly AccountResponse[];
  categories: readonly CategoryResponse[];
  /** Si se pasa, es una edición. */
  movement?: MovementResponse;
  onCreate: (request: CreateMovementRequest) => void;
  onUpdate: (movement: MovementResponse, patch: UpdateMovementRequest) => void;
  onCancel: () => void;
  pending?: boolean;
  /** Error de la API del último envío. */
  error?: unknown;
}

function initialValues(movement: MovementResponse | undefined): MovementFormValues {
  if (movement === undefined) {
    return {
      kind: 'expense',
      amount: '',
      accountId: '',
      categoryId: '',
      bookedOn: todayLocal(),
      description: '',
      merchant: '',
    };
  }
  return {
    kind: movement.kind,
    amount: amountToInput(movement.amountCents),
    accountId: movement.accountId ?? '',
    categoryId: movement.categoryId ?? '',
    bookedOn: movement.bookedOn,
    description: movement.description ?? '',
    merchant: movement.merchant ?? '',
  };
}

export function MovementForm({
  accounts,
  categories,
  movement,
  onCreate,
  onUpdate,
  onCancel,
  pending,
  error,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => initialValues(movement));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusInvalid(formRef, errors);

  const set = (field: keyof MovementFormValues) => (value: string) =>
    setValues((current) => {
      const next = { ...current, [field]: value };
      // La categoría debe ser del mismo tipo que el movimiento: al cambiar el tipo se descarta la
      // elegida si ya no encaja.
      if (field === 'kind') {
        const chosen = categories.find((category) => category.id === current.categoryId);
        if (chosen !== undefined && chosen.kind !== value) next.categoryId = '';
      }
      return next;
    });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (movement === undefined) {
      const result = buildCreateMovement(values);
      setErrors(result.ok ? {} : result.errors);
      if (result.ok) onCreate(result.value);
      return;
    }
    const result = buildMovementPatch(values, movement);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    if (result.value === null) onCancel();
    else onUpdate(movement, result.value);
  }

  const categoryOptions = categories
    .filter((category) => category.kind === values.kind || category.id === values.categoryId)
    .map((category) => ({ value: category.id, label: category.name }));
  const pendingDraft = movement?.status === 'pending';

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label={movement === undefined ? 'Nuevo movimiento' : 'Editar movimiento'}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">
        {movement === undefined ? 'Nuevo movimiento' : 'Editar movimiento'}
      </h2>
      <SelectField
        label="Tipo"
        value={values.kind}
        onChange={set('kind')}
        options={[
          { value: 'expense', label: 'Gasto' },
          { value: 'income', label: 'Ingreso' },
        ]}
      />
      <AmountField
        label="Importe"
        rules={{ allowZero: pendingDraft === true }}
        value={values.amount}
        onChange={set('amount')}
        error={errors['amount']}
        hint={
          pendingDraft
            ? 'Borrador pendiente: puede quedarse en 0 hasta completarlo. Ejemplo: 12,50'
            : undefined
        }
        autoFocus
      />
      <SelectField
        label="Cuenta"
        value={values.accountId}
        onChange={set('accountId')}
        error={errors['accountId']}
        emptyLabel="Elige una cuenta"
        required={false}
        options={accounts.map((account) => ({ value: account.id, label: account.name }))}
      />
      <SelectField
        label="Categoría"
        value={values.categoryId}
        onChange={set('categoryId')}
        error={errors['categoryId']}
        emptyLabel="Elige una categoría"
        required={false}
        options={categoryOptions}
      />
      <DateField
        label="Fecha"
        value={values.bookedOn}
        onChange={set('bookedOn')}
        error={errors['bookedOn']}
      />
      <TextField
        label="Concepto (opcional)"
        value={values.description}
        onChange={set('description')}
        error={errors['description']}
        maxLength={500}
      />
      <TextField
        label="Comercio (opcional)"
        value={values.merchant}
        onChange={set('merchant')}
        error={errors['merchant']}
        maxLength={200}
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
