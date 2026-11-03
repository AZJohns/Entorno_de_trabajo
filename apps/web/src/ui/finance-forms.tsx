/**
 * Componentes de formulario del libro: importe, fecha, selector, aviso de error de la API y
 * confirmación en línea. Cada control tiene su etiqueta visible y enlaza su error con `aria-describedby`.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ApiError } from '../api/client.ts';
import { Button } from './forms.tsx';

const INPUT_CLASS =
  'min-w-0 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none aria-[invalid=true]:border-red-500';

interface ControlProps {
  label: string;
  /** Mensaje de validación del campo, ya en español. */
  error?: string | undefined;
  hint?: string | undefined;
}

/** Etiqueta, control y mensajes de un campo; `render` recibe los atributos de accesibilidad. */
function Control({
  label,
  error,
  hint,
  render,
}: ControlProps & {
  render: (attrs: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy =
    [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`]
      .filter((part): part is string => part !== null)
      .join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {render({ id, 'aria-invalid': error !== undefined, 'aria-describedby': describedBy })}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextInputProps extends ControlProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}

/** Texto libre (concepto, comercio, nota, nombre). */
export function TextField(props: TextInputProps) {
  return (
    <Control
      {...props}
      render={(attrs) => (
        <input
          {...attrs}
          type="text"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          required={props.required ?? false}
          maxLength={props.maxLength}
          autoFocus={props.autoFocus}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      )}
    />
  );
}

/** Importe en euros como texto: se convierte a céntimos con `readAmount` al enviar. */
export function AmountField(props: TextInputProps) {
  return (
    <Control
      {...props}
      hint={
        props.hint ??
        'En euros. Ejemplos: 12,50 · 1.234,56. Ojo: con tres cifras tras el separador (12,345) se leen como miles'
      }
      render={(attrs) => (
        <input
          {...attrs}
          type="text"
          inputMode="decimal"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          autoComplete="off"
          autoFocus={props.autoFocus}
          className={`${INPUT_CLASS} text-right tabular-nums`}
        />
      )}
    />
  );
}

/** Fecha con el selector del navegador (`YYYY-MM-DD`). */
export function DateField(props: TextInputProps) {
  return (
    <Control
      {...props}
      render={(attrs) => (
        <input
          {...attrs}
          type="date"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          required={props.required ?? true}
          className={INPUT_CLASS}
        />
      )}
    />
  );
}

export interface Option {
  readonly value: string;
  readonly label: string;
}

interface SelectProps extends ControlProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  /** Texto de la opción vacía; sin él, no hay opción vacía (el campo es obligatorio). */
  emptyLabel?: string;
  required?: boolean;
}

export function SelectField(props: SelectProps) {
  return (
    <Control
      {...props}
      render={(attrs) => (
        <select
          {...attrs}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          required={props.required ?? props.emptyLabel === undefined}
          className={INPUT_CLASS}
        >
          {props.emptyLabel !== undefined && <option value="">{props.emptyLabel}</option>}
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    />
  );
}

/**
 * Aviso de un error de la API, con el mensaje en español que envía. Distingue los dos casos de un
 * formulario válido que el servidor no acepta:
 * - 409: el estado actual lo impide (cuenta archivada, nombre repetido, saldo distinto de 0…).
 * - 422: los datos son incoherentes con lo ya guardado (fecha anterior a la apertura, categoría de
 *   otro tipo…). Hay que cambiar el formulario.
 * El resto (400, red, 5xx) usa el mismo texto que las pantallas de acceso.
 */
export function ProblemNotice({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  const message = error instanceof ApiError ? problemMessage(error) : null;
  const title =
    error instanceof ApiError && error.status === 409
      ? 'No se puede hacer ahora'
      : error instanceof ApiError && error.status === 422
        ? 'Revisa los datos'
        : null;
  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {title !== null && <p className="font-semibold">{title}</p>}
      <p>{message ?? 'Ha ocurrido un error inesperado'}</p>
    </div>
  );
}

/** Mensaje de la API, con los de campo si añaden algo que el principal no dice. */
export function problemMessage(error: ApiError): string {
  const extra = (error.problem?.errors ?? [])
    .map((field) => field.message)
    .filter((text) => text !== error.message);
  return extra.length === 0 ? error.message : `${error.message}: ${extra.join('. ')}`;
}

interface ConfirmBarProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}

/**
 * Confirmación en línea de una acción destructiva. Al aparecer lleva el foco a «Cancelar» (la opción
 * segura) y Escape la cancela; al cerrarse, el llamador devuelve el foco al botón que la abrió.
 */
export function ConfirmBar({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  pending,
}: ConfirmBarProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-label={message}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
      className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
    >
      <span className="flex-1">{message}</span>
      <Button type="button" variant="danger" onClick={onConfirm} disabled={pending === true}>
        {confirmLabel}
      </Button>
      <button
        ref={cancelRef}
        type="button"
        onClick={onCancel}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
      >
        Cancelar
      </button>
    </div>
  );
}
