/**
 * Barra de progreso de una línea de presupuesto. El estado no depende solo del color: lleva un icono y
 * un texto («Cerca del límite», «Presupuesto superado») y la barra expone `role="progressbar"` con su
 * valor y una descripción para lectores de pantalla.
 */
import { budgetStatus, type BudgetState } from '../budgetLogic.ts';

const STYLES: Record<BudgetState, { bar: string; text: string; icon: string }> = {
  ok: { bar: 'bg-green-600', text: 'text-green-800', icon: '✓' },
  near: { bar: 'bg-amber-500', text: 'text-amber-800', icon: '⚠' },
  over: { bar: 'bg-red-600', text: 'text-red-800', icon: '✕' },
};

interface Props {
  /** Nombre de la categoría, para la etiqueta accesible de la barra. */
  name: string;
  amountCents: number;
  spentCents: number;
}

export function BudgetBar({ name, amountCents, spentCents }: Props) {
  const status = budgetStatus(amountCents, spentCents);
  const style = STYLES[status.state];
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-sm font-medium ${style.text}`}>
        <span aria-hidden="true">{style.icon} </span>
        {status.label} · {String(status.percent)} %
      </p>
      <div
        role="progressbar"
        aria-label={`Gastado de ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status.barPercent}
        aria-valuetext={`${String(status.percent)} % gastado. ${status.label}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          data-state={status.state}
          className={`h-full ${style.bar}`}
          style={{ width: `${String(status.barPercent)}%` }}
        />
      </div>
    </div>
  );
}
