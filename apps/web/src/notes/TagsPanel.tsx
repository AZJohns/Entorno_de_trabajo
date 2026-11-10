import { MAX_TAG_NAME, type TagResponse } from '@backoffice/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { cleanTagName } from './tagLogic.ts';
import { renameErrorText, useRenameTag } from './queries.ts';

/**
 * Lista de etiquetas con su recuento y el renombrado en línea. Si el nuevo nombre ya es de otra
 * etiqueta, la API responde 409 y aquí se explica en español; cambiar solo las mayúsculas de la propia
 * etiqueta es válido.
 */
export function TagsPanel({ tags }: { tags: readonly TagResponse[] }) {
  const rename = useRenameTag();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const inputId = useId();
  const opener = useRef<HTMLElement | null>(null);

  function begin(tag: TagResponse): void {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(tag.id);
    setName(tag.name);
    setProblem('');
    rename.reset();
  }

  function stop(): void {
    setEditing(null);
    setProblem('');
    queueMicrotask(() => opener.current?.focus());
  }

  function submit(event: FormEvent, tag: TagResponse): void {
    event.preventDefault();
    const next = cleanTagName(name);
    if (next === '' || next.length > MAX_TAG_NAME) {
      setProblem(`Escribe un nombre de hasta ${String(MAX_TAG_NAME)} caracteres.`);
      return;
    }
    if (next === tag.name) {
      stop();
      return;
    }
    rename.mutate(
      { id: tag.id, name: next },
      { onSuccess: stop, onError: (error) => setProblem(renameErrorText(error)) },
    );
  }

  if (tags.length === 0) {
    return <p className="mt-2 text-sm text-slate-600">Todavía no hay etiquetas.</p>;
  }
  return (
    <ul aria-label="Etiquetas existentes" className="mt-2 flex flex-col gap-2">
      {tags.map((tag) => (
        <li
          key={tag.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
        >
          {editing === tag.id ? (
            <form
              onSubmit={(event) => submit(event, tag)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') stop();
              }}
              noValidate
              className="flex flex-1 flex-wrap items-start gap-2"
            >
              <div className="flex min-w-40 flex-1 flex-col gap-1">
                <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
                  Nuevo nombre de «{tag.name}»
                </label>
                <input
                  id={inputId}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_TAG_NAME}
                  autoFocus
                  autoComplete="off"
                  aria-invalid={problem !== ''}
                  aria-describedby={problem === '' ? undefined : `${inputId}-error`}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-base focus:border-slate-600 focus:outline-none aria-[invalid=true]:border-red-500"
                />
                {problem !== '' && (
                  <p id={`${inputId}-error`} role="alert" className="text-sm text-red-700">
                    {problem}
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-6">
                <button
                  type="submit"
                  disabled={rename.isPending}
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <>
              <span className="flex-1 text-sm">
                {tag.name} <span className="text-slate-500">({tag.noteCount})</span>
              </span>
              <button
                type="button"
                onClick={() => begin(tag)}
                aria-label={`Renombrar la etiqueta ${tag.name}`}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
              >
                Renombrar
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
