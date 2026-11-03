/**
 * Componentes de formulario comunes. Cada campo tiene su etiqueta visible y su `autocomplete`, para que
 * el gestor de contraseñas y la app de códigos funcionen (ASVS 6.2.7: se permite pegar).
 */
import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client.ts';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  autoComplete: string;
  hint?: string;
  inputMode?: 'text' | 'numeric';
  maxLength?: number;
  pattern?: string;
  autoFocus?: boolean;
  required?: boolean;
}

/** Campo de texto con etiqueta. Si es una contraseña, se puede mostrar (ASVS 6.2.6). */
export function Field(props: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = props.type === 'password';
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {props.label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={isPassword && !visible ? 'password' : 'text'}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          maxLength={props.maxLength}
          pattern={props.pattern}
          autoFocus={props.autoFocus}
          required={props.required ?? true}
          spellCheck={false}
          autoCapitalize="none"
          aria-describedby={props.hint === undefined ? undefined : `${id}-hint`}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none"
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            className="rounded-md border border-slate-300 px-3 text-sm text-slate-700"
          >
            {visible ? 'Ocultar' : 'Mostrar'}
          </button>
        )}
      </div>
      {props.hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {props.hint}
        </p>
      )}
    </div>
  );
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

interface ButtonProps {
  children: ReactNode;
  type?: 'submit' | 'button';
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

const VARIANTS = {
  primary: 'bg-slate-800 text-white hover:bg-slate-700',
  secondary: 'border border-slate-300 text-slate-800 hover:bg-slate-100',
  danger: 'border border-red-300 text-red-700 hover:bg-red-50',
} as const;

export function Button({ children, type = 'submit', onClick, disabled, variant }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${VARIANTS[variant ?? 'primary']}`}
    >
      {children}
    </button>
  );
}

/** Texto del error para el usuario. Usa el detalle de la API, que nunca incluye datos internos. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.problem?.errors?.map((e) => e.message).join('. ');
    return fields !== undefined && fields !== '' ? `${error.message}: ${fields}` : error.message;
  }
  return 'Ha ocurrido un error inesperado';
}

/** Mensaje de error anunciado por los lectores de pantalla. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {errorText(error)}
    </p>
  );
}

/** Mensaje de confirmación. */
export function SuccessMessage({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
      {children}
    </p>
  );
}

/** Marco de las pantallas de acceso (login, segundo factor, desbloqueo y reautenticación). */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-800">
      <section className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </section>
    </main>
  );
}

/** Indicador de carga. */
export function Loading() {
  return (
    <p role="status" className="p-6 text-center text-sm text-slate-500">
      Cargando…
    </p>
  );
}
