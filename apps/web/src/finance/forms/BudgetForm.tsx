/** Alta y edición del importe de un presupuesto. Presentacional. */
import type { CreateBudgetRequest, UpdateBudgetRequest } from '@backoffice/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../ui/forms.tsx';
import { AmountField, ProblemNotice, SelectField, type Option } from '../../ui/finance-forms.tsx';
import { amountToInput } from '../amount.ts';
import { buildBudgetAmount, buildCreateBudget } from '../budgetLogic.ts';
import { useFocusInvalid } from './useFocusInvalid.ts';

interface Props {
  /** Mes `YYYY-MM` al que se añade el presupuesto. */
  month: string;
  /** Si se pasa, se edita su importe (la categoría y el mes no cambian). */
  budget?: { categoryName: string; amountCents: number };
  /** Categorías de gasto que aún no tienen presupuesto este mes (solo al crear). */
  categories?: readonly Option[];
  onCreate?: (request: CreateBudgetRequest) => void;
  onUpdate?: (request: UpdateBudgetRequest) => void;
  onCancel?: () => void;
  pending?: boolean;
  error?: unknown;
}

export function BudgetForm({
  month,
  budget,
  categories = [],
  onCreate,
  onUpdate,
  onCancel,
  pending,
  error,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState(
    budget === undefined ? '' : amountToInput(budget.amountCents),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusInvalid(formRef, errors);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (budget !== undefined) {
      const result = buildBudgetAmount(amount);
      setErrors(result.ok ? {} : result.errors);
      if (!result.ok) return;
      // Sin cambios no se llama a la API.
      if (result.value.amountCents === budget.amountCents) onCancel?.();
      else onUpdate?.(result.value);
      return;
    }
    const result = buildCreateBudget({ categoryId, amount }, month);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) onCreate?.(result.value);
  }

  const title =
    budget === undefined ? 'Nuevo presupuesto' : `Editar presupuesto de ${budget.categoryName}`;
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label={title}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      {budget === undefined && (
        <SelectField
          label="Categoría de gasto"
          value={categoryId}
          onChange={setCategoryId}
          error={errors['categoryId']}
          emptyLabel="Elige una categoría"
          options={categories}
        />
      )}
      <AmountField
        label="Importe presupuestado"
        value={amount}
        onChange={setAmount}
        error={errors['amount']}
        autoFocus={budget !== undefined}
      />
      {errors['form'] !== undefined && (
        <p role="alert" className="text-sm text-red-700">
          {errors['form']}
        </p>
      )}
      <ProblemNotice error={error} />
      <div className="flex gap-2">
        <Button disabled={pending === true}>Guardar</Button>
        {budget !== undefined && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
