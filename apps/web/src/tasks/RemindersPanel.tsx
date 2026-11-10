/**
 * Recordatorios de una tarea: lista (pendientes y entregados) con borrado y alta con fecha y hora LOCALES
 * de Madrid. La hora se envía tal cual (`remindAtLocal`); la API la convierte en un instante, rechaza las
 * que no existen (cambio de horario de marzo) y las del pasado, y esas razones se muestran aquí. Las horas
 * se enseñan con CET/CEST para que se vea cuál de las dos «02:30» de octubre se ha elegido.
 */
import { REMINDER_TIME_ZONE, type TaskResponse } from '@backoffice/shared';
import { useState, type FormEvent } from 'react';
import { ProblemNotice } from '../ui/finance-forms.tsx';
import { Button, Loading } from '../ui/forms.tsx';
import { formatMadridMoment, madridNowLocal } from '../ui/moment.ts';
import { useAddReminder, useDeleteReminder, useReminders } from './queries.ts';

interface Props {
  task: TaskResponse;
  onClose: () => void;
}

export function RemindersPanel({ task, onClose }: Props) {
  const reminders = useReminders(task.id);
  const add = useAddReminder();
  const remove = useDeleteReminder();
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [notice, setNotice] = useState('');

  function submit(event: FormEvent): void {
    event.preventDefault();
    setNotice('');
    if (value === '') {
      setFieldError('Indica la fecha y la hora del recordatorio');
      return;
    }
    setFieldError('');
    add.mutate(
      { taskId: task.id, remindAtLocal: value },
      {
        onSuccess: () => {
          setValue('');
          setNotice('Recordatorio añadido');
        },
      },
    );
  }

  const items = reminders.data ?? [];
  return (
    <section
      aria-label={`Recordatorios de ${task.title}`}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Recordatorios: {task.title}</h2>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      {reminders.isPending && <Loading />}
      {reminders.isError && <ProblemNotice error={reminders.error} />}
      {reminders.isSuccess && items.length === 0 && (
        <p className="text-sm text-slate-600">Esta tarea no tiene recordatorios.</p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((reminder) => (
          <li
            key={reminder.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <span>
              {formatMadridMoment(reminder.remindAt)}
              {' · '}
              <strong>
                {reminder.sentAt === null
                  ? 'Pendiente'
                  : `Entregado el ${formatMadridMoment(reminder.sentAt)}`}
              </strong>
            </span>
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ taskId: task.id, reminderId: reminder.id })}
            >
              Borrar{' '}
              <span className="sr-only">
                el recordatorio del {formatMadridMoment(reminder.remindAt)}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {remove.isError && <ProblemNotice error={remove.error} />}

      <form
        onSubmit={submit}
        noValidate
        aria-label="Añadir recordatorio"
        className="flex flex-col gap-3 border-t border-slate-200 pt-4"
      >
        <h3 className="font-semibold">Añadir recordatorio</h3>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Fecha y hora (hora de Madrid)
          <input
            type="datetime-local"
            value={value}
            min={madridNowLocal()}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={fieldError !== ''}
            aria-describedby="reminder-hint reminder-error"
            className="min-w-0 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none aria-[invalid=true]:border-red-500 sm:w-64"
          />
        </label>
        <p id="reminder-hint" className="text-xs text-slate-500">
          La hora se interpreta en {REMINDER_TIME_ZONE}, aunque tu dispositivo esté en otra zona.
          Las horas que no existen por el cambio de horario se rechazan; si una hora se repite, vale
          la primera.
        </p>
        {fieldError !== '' && (
          <p id="reminder-error" className="text-sm text-red-700">
            {fieldError}
          </p>
        )}
        {add.isError && <ProblemNotice error={add.error} />}
        {notice !== '' && (
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            {notice}
          </p>
        )}
        <div>
          <Button disabled={add.isPending}>Añadir recordatorio</Button>
        </div>
      </form>
    </section>
  );
}
