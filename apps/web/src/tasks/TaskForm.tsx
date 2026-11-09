/**
 * Alta y edición de una tarea: título, descripción y fecha límite. Valida con los esquemas compartidos
 * antes de enviar; la edición solo envía los campos que cambian.
 */
import {
  createTaskRequestSchema,
  updateTaskRequestSchema,
  type CreateTaskRequest,
  type TaskResponse,
  type UpdateTaskRequest,
} from '@backoffice/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../ui/forms.tsx';
import { DateField, ProblemNotice, TextField } from '../ui/finance-forms.tsx';
import { useFocusInvalid } from '../finance/forms/useFocusInvalid.ts';

interface Props {
  /** Sin tarea, es un alta. */
  task?: TaskResponse;
  onCreate: (request: CreateTaskRequest) => void;
  onUpdate: (task: TaskResponse, patch: UpdateTaskRequest) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: unknown;
}

const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  title: 'Escribe un título de hasta 200 caracteres',
  descriptionMd: 'La descripción no puede superar los 10.000 caracteres',
  dueOn: 'La fecha límite no es válida',
};

/** Errores de campo de un `safeParse`, con el mensaje en español de cada campo. */
function fieldErrors(issues: readonly { path: readonly PropertyKey[] }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    errors[field] = FIELD_MESSAGES[field] ?? 'Revisa este campo';
  }
  return errors;
}

export function TaskForm({ task, onCreate, onUpdate, onCancel, pending, error }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const descriptionId = useId();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.descriptionMd ?? '');
  const [dueOn, setDueOn] = useState(task?.dueOn ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useFocusInvalid(formRef, errors);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const text = description.trim();
    if (task === undefined) {
      const request = {
        title,
        status: 'todo' as const,
        ...(text === '' ? {} : { descriptionMd: text }),
        ...(dueOn === '' ? {} : { dueOn }),
      };
      const check = createTaskRequestSchema.safeParse(request);
      setErrors(check.success ? {} : fieldErrors(check.error.issues));
      if (check.success) onCreate(check.data);
      return;
    }
    const patch: Record<string, string | null> = {};
    if (title.trim() !== task.title) patch['title'] = title;
    if ((text === '' ? null : text) !== task.descriptionMd) {
      patch['descriptionMd'] = text === '' ? null : text;
    }
    if ((dueOn === '' ? null : dueOn) !== task.dueOn) patch['dueOn'] = dueOn === '' ? null : dueOn;
    if (Object.keys(patch).length === 0) {
      // Nada que guardar, pero un título vacío sigue siendo un error.
      const check = createTaskRequestSchema.shape.title.safeParse(title);
      if (check.success) onCancel();
      else setErrors({ title: FIELD_MESSAGES['title'] ?? 'Revisa este campo' });
      return;
    }
    const check = updateTaskRequestSchema.safeParse(patch);
    setErrors(check.success ? {} : fieldErrors(check.error.issues));
    if (check.success) onUpdate(task, check.data);
  }

  const heading = task === undefined ? 'Nueva tarea' : 'Editar tarea';
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label={heading}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">{heading}</h2>
      <TextField
        label="Título"
        value={title}
        onChange={setTitle}
        error={errors['title']}
        maxLength={200}
        autoFocus
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={descriptionId} className="text-sm font-medium text-slate-700">
          Descripción (opcional)
        </label>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={10_000}
          aria-invalid={errors['descriptionMd'] !== undefined}
          className="rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none aria-[invalid=true]:border-red-500"
        />
        {errors['descriptionMd'] !== undefined && (
          <p className="text-sm text-red-700">{errors['descriptionMd']}</p>
        )}
      </div>
      <DateField
        label="Fecha límite (opcional)"
        value={dueOn}
        onChange={setDueOn}
        error={errors['dueOn']}
        required={false}
        hint="Para quitarla, borra la fecha."
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
