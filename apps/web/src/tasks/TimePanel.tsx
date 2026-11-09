/**
 * Tiempo dedicado a una tarea: total, entradas (con borrado) y anotación manual por duración o por
 * inicio y fin. El cronómetro se maneja desde la tarjeta; aquí solo se muestra la entrada en marcha.
 */
import type { CreateTimeEntryRequest, TaskResponse, TimeEntryResponse } from '@backoffice/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../ui/forms.tsx';
import { Loading } from '../ui/forms.tsx';
import { ProblemNotice } from '../ui/finance-forms.tsx';
import {
  buildManualTime,
  formatDuration,
  secondsSince,
  type ManualTimeValues,
} from './boardLogic.ts';
import { timeErrorText, useAddTimeEntry, useDeleteTimeEntry, useTimeEntries } from './queries.ts';

interface Props {
  task: TaskResponse;
  /** Instante actual en ms; lo da la página para que el contador avance. */
  now: number;
  onClose: () => void;
}

const EMPTY: ManualTimeValues = { mode: 'duration', hours: '', minutes: '', start: '', end: '' };

const INPUT =
  'min-w-0 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none aria-[invalid=true]:border-red-500';

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export function TimePanel({ task, now, onClose }: Props) {
  const entries = useTimeEntries(task.id);
  const add = useAddTimeEntry();
  const remove = useDeleteTimeEntry();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ManualTimeValues>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const set = (field: keyof ManualTimeValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function submit(event: FormEvent): void {
    event.preventDefault();
    setNotice('');
    const result = buildManualTime(values, new Date());
    if (!result.ok) {
      setErrors(result.errors);
      // El foco va al primer campo con error para quien usa teclado o lector de pantalla.
      queueMicrotask(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrors({});
    const body: CreateTimeEntryRequest =
      result.endedAt === undefined
        ? { startedAt: result.startedAt, durationSeconds: result.durationSeconds ?? 0 }
        : { startedAt: result.startedAt, endedAt: result.endedAt };
    add.mutate(
      { taskId: task.id, body },
      {
        onSuccess: () => {
          setValues((current) => ({ ...EMPTY, mode: current.mode }));
          setNotice('Tiempo añadido');
        },
      },
    );
  }

  const items = [...(entries.data ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const durationError = errors['duration'];
  return (
    <section
      aria-label={`Tiempo dedicado a ${task.title}`}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Tiempo dedicado: {task.title}</h2>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <p className="text-sm">
        Total: <strong>{formatDuration(task.timeSpentSeconds)}</strong>
        {task.timerStartedAt !== null && ' (incluye el cronómetro en marcha)'}
      </p>

      {entries.isPending && <Loading />}
      {entries.isError && <ProblemNotice error={entries.error} />}
      {entries.isSuccess && items.length === 0 && (
        <p className="text-sm text-slate-600">Todavía no hay tiempo anotado.</p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            now={now}
            pending={remove.isPending}
            onDelete={() => remove.mutate(entry.id)}
          />
        ))}
      </ul>
      {remove.isError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {timeErrorText(remove.error, 'delete')}
        </p>
      )}

      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        aria-label="Añadir tiempo a mano"
        className="flex flex-col gap-3 border-t border-slate-200 pt-4"
      >
        <h3 className="font-semibold">Añadir tiempo a mano</h3>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Cómo indicar el tiempo</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`mode-${task.id}`}
              checked={values.mode === 'duration'}
              onChange={() => setValues((current) => ({ ...current, mode: 'duration' }))}
            />
            Duración
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`mode-${task.id}`}
              checked={values.mode === 'range'}
              onChange={() => setValues((current) => ({ ...current, mode: 'range' }))}
            />
            Inicio y fin
          </label>
        </fieldset>

        {values.mode === 'duration' ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Horas
                <input
                  type="text"
                  inputMode="numeric"
                  value={values.hours}
                  onChange={(event) => set('hours')(event.target.value)}
                  aria-invalid={durationError !== undefined}
                  aria-describedby="duration-hint duration-error"
                  className={`${INPUT} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Minutos
                <input
                  type="text"
                  inputMode="numeric"
                  value={values.minutes}
                  onChange={(event) => set('minutes')(event.target.value)}
                  aria-invalid={durationError !== undefined}
                  aria-describedby="duration-hint duration-error"
                  className={`${INPUT} w-24`}
                />
              </label>
            </div>
            <p id="duration-hint" className="text-xs text-slate-500">
              Se anota como terminado ahora mismo. Para otro momento, usa «Inicio y fin».
            </p>
            {durationError !== undefined && (
              <p id="duration-error" className="text-sm text-red-700">
                {durationError}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Inicio
              <input
                type="datetime-local"
                value={values.start}
                onChange={(event) => set('start')(event.target.value)}
                aria-invalid={errors['start'] !== undefined}
                aria-describedby="start-error"
                className={INPUT}
              />
              {errors['start'] !== undefined && (
                <span id="start-error" className="text-sm font-normal text-red-700">
                  {errors['start']}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Fin
              <input
                type="datetime-local"
                value={values.end}
                onChange={(event) => set('end')(event.target.value)}
                aria-invalid={errors['end'] !== undefined}
                aria-describedby="end-error"
                className={INPUT}
              />
              {errors['end'] !== undefined && (
                <span id="end-error" className="text-sm font-normal text-red-700">
                  {errors['end']}
                </span>
              )}
            </label>
          </div>
        )}

        {add.isError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {timeErrorText(add.error, 'add')}
          </p>
        )}
        {notice !== '' && (
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            {notice}
          </p>
        )}
        <div>
          <Button disabled={add.isPending}>Añadir tiempo</Button>
        </div>
      </form>
    </section>
  );
}

function EntryRow({
  entry,
  now,
  pending,
  onDelete,
}: {
  entry: TimeEntryResponse;
  now: number;
  pending: boolean;
  onDelete: () => void;
}) {
  const { endedAt } = entry;
  const running = endedAt === null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
      <span>
        {formatMoment(entry.startedAt)}
        {running ? ' → en marcha' : ` → ${formatMoment(endedAt ?? entry.startedAt)}`}
      </span>
      <span className="tabular-nums">
        {formatDuration(running ? secondsSince(entry.startedAt, now) : entry.durationSeconds)}
      </span>
      <Button type="button" variant="danger" disabled={pending} onClick={onDelete}>
        Borrar <span className="sr-only">la entrada de {formatMoment(entry.startedAt)}</span>
      </Button>
    </li>
  );
}
