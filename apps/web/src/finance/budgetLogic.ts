/**
 * Lógica pura de la pantalla de presupuestos: estado de una línea según lo gastado, formulario de
 * importe y texto del resultado de «Copiar del mes anterior». Sin React ni E/S.
 *
 * Lo gastado y lo que queda los calcula la API; aquí solo se decide cómo se muestran.
 */
import {
  createBudgetRequestSchema,
  updateBudgetRequestSchema,
  type CopyBudgetsResponse,
  type CreateBudgetRequest,
  type UpdateBudgetRequest,
} from '@backoffice/shared';
import { readAmount } from './amount.ts';
import { formatMonth } from './dates.ts';
import type { FormResult } from './formLogic.ts';

/** A partir de este porcentaje gastado se avisa de que te acercas al límite. */
export const NEAR_LIMIT_PERCENT = 80;

export type BudgetState = 'ok' | 'near' | 'over';

export interface BudgetStatus {
  readonly state: BudgetState;
  /** Porcentaje gastado, redondeado hacia abajo. Puede pasar de 100. */
  readonly percent: number;
  /** Ancho de la barra (0–100): una barra nunca se desborda de su contenedor. */
  readonly barPercent: number;
  /** Texto del estado; la barra no depende solo del color. */
  readonly label: string;
}

/**
 * Estado de una línea de presupuesto.
 *
 * - `near`: se ha gastado el 80 % o más (hasta el 100 % inclusive: gastar justo el límite no lo supera).
 * - `over`: se ha gastado más que el presupuesto (> 100 %).
 *
 * Las comparaciones son exactas con enteros (`spent × 100` frente a `amount × 80`), sin pasar por un
 * porcentaje redondeado: 79,99 % no cuenta como 80 %. Un gasto negativo (devolución neta) cuenta como 0.
 *
 * @param amountCents límite del mes, en céntimos (> 0).
 * @param spentCents gasto confirmado del mes, en céntimos (puede ser negativo).
 */
export function budgetStatus(amountCents: number, spentCents: number): BudgetStatus {
  const spent = Math.max(spentCents, 0);
  const percent = amountCents > 0 ? Math.floor((spent * 100) / amountCents) : 0;
  const barPercent = Math.min(percent, 100);
  if (spent > amountCents) {
    return { state: 'over', percent, barPercent, label: 'Presupuesto superado' };
  }
  if (spent * 100 >= amountCents * NEAR_LIMIT_PERCENT) {
    return { state: 'near', percent, barPercent, label: 'Cerca del límite' };
  }
  return { state: 'ok', percent, barPercent, label: 'Dentro del presupuesto' };
}

export interface BudgetFormValues {
  categoryId: string;
  amount: string;
}

const REQUIRED = 'Este campo es obligatorio';

/** Importe de un presupuesto: > 0, con coma para los céntimos (nunca `12,345`: es ambiguo). */
export function buildBudgetAmount(text: string): FormResult<UpdateBudgetRequest> {
  const amount = readAmount(text);
  if (!amount.ok) return { ok: false, errors: { amount: amount.message } };
  const parsed = updateBudgetRequestSchema.safeParse({ amountCents: amount.cents });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: { amount: parsed.error.issues[0]?.message ?? 'Importe no válido' } };
}

/** Alta de un presupuesto en `month` (`YYYY-MM`). */
export function buildCreateBudget(
  values: BudgetFormValues,
  month: string,
): FormResult<CreateBudgetRequest> {
  const errors: Record<string, string> = {};
  const amount = buildBudgetAmount(values.amount);
  if (!amount.ok) Object.assign(errors, amount.errors);
  if (values.categoryId === '') errors['categoryId'] = REQUIRED;
  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors };
  const parsed = createBudgetRequestSchema.safeParse({
    month,
    categoryId: values.categoryId,
    amountCents: amount.value.amountCents,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: { form: parsed.error.issues[0]?.message ?? 'Datos no válidos' } };
}

/**
 * Frase con el resultado de copiar. La API responde siempre 200 con recuentos; aquí se explica cada
 * caso, incluido el de «no había nada que copiar» (todo a cero).
 */
export function copyResultMessage(result: CopyBudgetsResponse): string {
  const { copied, skippedExisting, skippedArchived, sourceMonth } = result;
  if (copied + skippedExisting + skippedArchived === 0) {
    return `${capitalize(formatMonth(sourceMonth))} no tiene presupuestos que copiar.`;
  }
  const parts = [
    copied === 0
      ? 'No se ha copiado ningún presupuesto'
      : copied === 1
        ? 'Se ha copiado 1 presupuesto'
        : `Se han copiado ${String(copied)} presupuestos`,
  ];
  const skipped: string[] = [];
  if (skippedExisting > 0) skipped.push(`${String(skippedExisting)} ya existían`);
  if (skippedArchived > 0) {
    skipped.push(`${String(skippedArchived)} de categorías archivadas`);
  }
  const tail = skipped.length === 0 ? '' : ` (omitidos: ${skipped.join(', ')})`;
  return `${parts[0] ?? ''} de ${formatMonth(sourceMonth)}${tail}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
