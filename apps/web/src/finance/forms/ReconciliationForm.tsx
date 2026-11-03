/**
 * Formulario de conciliación mensual: el saldo que muestra el banco en una fecha del mes. Presentacional:
 * recibe un callback y el error de la API del último envío (409 si ese mes ya está conciliado, 422 si la
 * fecha es anterior a la apertura de la cuenta).
 */
import type { CreateReconciliationRequest } from '@backoffice/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../ui/forms.tsx';
import { AmountField, DateField, ProblemNotice, TextField } from '../../ui/finance-forms.tsx';
import { formatMonth, monthOf, todayLocal } from '../dates.ts';
import { buildReconciliation, type ReconciliationFormValues } from '../formLogic.ts';
import { useFocusInvalid } from './useFocusInvalid.ts';

interface Props {
  onSubmit: (request: CreateReconciliationRequest) => void;
  pending?: boolean;
  error?: unknown;
  /** Para probar con una fecha fija; por defecto, hoy. */
  today?: string;
}

/** Mes y fecha propuestos: el mes actual, y hoy como fecha del saldo. */
function initialValues(today: string): ReconciliationFormValues {
  return { month: monthOf(today), asOf: today, statementBalance: '', note: '' };
}

export function ReconciliationForm({ onSubmit, pending, error, today }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => initialValues(today ?? todayLocal()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusInvalid(formRef, errors);

  const set = (field: keyof ReconciliationFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  /** Al cambiar la fecha, el mes la sigue: el caso normal es conciliar el mes de esa fecha. */
  function changeAsOf(value: string): void {
    setValues((current) => ({
      ...current,
      asOf: value,
      month: value === '' ? current.month : monthOf(value),
    }));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const result = buildReconciliation(values);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) onSubmit(result.value);
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label="Nueva conciliación"
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">Nueva conciliación</h2>
      <DateField
        label="Fecha del saldo del banco"
        value={values.asOf}
        onChange={changeAsOf}
        error={errors['asOf']}
        hint={`Se concilia ${formatMonth(values.month)}, el mes de esa fecha.`}
      />
      <AmountField
        label="Saldo según el banco"
        rules={{ allowNegative: true, allowZero: true }}
        value={values.statementBalance}
        onChange={set('statementBalance')}
        error={errors['statementBalance']}
        hint="El saldo que muestra el banco en esa fecha. Admite negativos. Ejemplo: 1.234,56"
        autoFocus
      />
      {errors['month'] !== undefined && (
        <p role="alert" className="text-sm text-red-700">
          {errors['month']}
        </p>
      )}
      <TextField
        label="Nota (opcional)"
        value={values.note}
        onChange={set('note')}
        error={errors['note']}
        maxLength={500}
      />
      <ProblemNotice error={error} />
      <div>
        <Button disabled={pending === true}>Conciliar</Button>
      </div>
    </form>
  );
}
