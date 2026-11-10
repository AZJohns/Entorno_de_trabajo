/**
 * Editor de una nota (`/notas/nueva` y `/notas/:id`): título, cuerpo en Markdown (un `textarea`, sin
 * editor visual) con pestaña de vista previa, y etiquetas con autocompletado. Avisa antes de salir si
 * hay cambios sin guardar, tanto al navegar dentro de la web como al cerrar o recargar la pestaña.
 */
import {
  MAX_NOTE_BODY,
  MAX_NOTE_TITLE,
  createNoteRequestSchema,
  type NoteResponse,
  type UpdateNoteRequest,
} from '@backoffice/shared';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { isApiError } from '../api/client.ts';
import { ConfirmBar, ProblemNotice, TextField } from '../ui/finance-forms.tsx';
import { Button, ErrorMessage, Loading } from '../ui/forms.tsx';
import { MarkdownPreview } from './markdown.tsx';
import { useCreateNote, useDeleteNote, useNote, useTags, useUpdateNote } from './queries.ts';
import { TagInput } from './TagInput.tsx';
import { mergeTags, sameTags } from './tagLogic.ts';

export function NoteEditorPage() {
  const { id } = useParams();
  const note = useNote(id);
  if (id === undefined) return <NoteEditor key="new" />;
  if (note.isError) {
    return (
      <div className="flex flex-col gap-3">
        {isApiError(note.error, 'NOT_FOUND') ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            La nota no existe o se borró.
          </p>
        ) : (
          <ErrorMessage error={note.error} />
        )}
        <Link to="/notas" className="text-sm underline">
          Volver a las notas
        </Link>
      </div>
    );
  }
  if (note.data === undefined) return <Loading />;
  return <NoteEditor key={note.data.id} note={note.data} />;
}

interface Props {
  /** Sin nota, es un alta. */
  note?: NoteResponse;
}

type Tab = 'write' | 'preview';

function NoteEditor({ note }: Props) {
  const navigate = useNavigate();
  const tags = useTags();
  const create = useCreateNote();
  const update = useUpdateNote();
  const remove = useDeleteNote();

  // Lo último guardado: sirve para saber si hay cambios y para enviar solo lo que cambia.
  const [saved, setSaved] = useState(() => ({
    title: note?.title ?? '',
    bodyMd: note?.bodyMd ?? '',
    tags: note?.tags.map((tag) => tag.name) ?? [],
  }));
  const [title, setTitle] = useState(saved.title);
  const [body, setBody] = useState(saved.bodyMd);
  const [tagNames, setTagNames] = useState<string[]>(saved.tags);
  const [tab, setTab] = useState<Tab>('write');
  const [titleError, setTitleError] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = title !== saved.title || body !== saved.bodyMd || !sameTags(tagNames, saved.tags);
  // El bloqueo consulta este valor al navegar; se baja a mano justo antes de salir tras guardar o borrar.
  const guard = useRef(false);
  useEffect(() => {
    guard.current = dirty;
  }, [dirty]);

  const blocker = useBlocker(() => guard.current);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const formRef = useRef<HTMLFormElement>(null);
  const bodyId = useId();
  const panelId = useId();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function submit(event: FormEvent): void {
    event.preventDefault();
    setJustSaved(false);
    const names = mergeTags(tagNames);
    const check = createNoteRequestSchema.safeParse({ title, bodyMd: body, tags: names });
    if (!check.success) {
      const onTitle = check.error.issues.some((issue) => issue.path[0] === 'title');
      setTitleError(
        onTitle ? `Escribe un título de hasta ${String(MAX_NOTE_TITLE)} caracteres` : undefined,
      );
      if (onTitle) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setTitleError(undefined);
    const after = { title: check.data.title, bodyMd: check.data.bodyMd, tags: check.data.tags };

    if (note === undefined) {
      create.mutate(check.data, {
        onSuccess: (created) => {
          guard.current = false;
          void navigate(`/notas/${created.id}`, { replace: true });
        },
      });
      return;
    }
    const patch: UpdateNoteRequest = {};
    if (after.title !== saved.title) patch.title = after.title;
    if (after.bodyMd !== saved.bodyMd) patch.bodyMd = after.bodyMd;
    if (!sameTags(after.tags, saved.tags)) patch.tags = after.tags;
    if (Object.keys(patch).length === 0) return;
    update.mutate(
      { id: note.id, body: patch },
      {
        onSuccess: (result) => {
          const now = {
            title: result.title,
            bodyMd: result.bodyMd,
            tags: result.tags.map((tag) => tag.name),
          };
          setSaved(now);
          setTitle(now.title);
          setBody(now.bodyMd);
          setTagNames(now.tags);
          setJustSaved(true);
        },
      },
    );
  }

  function leave(): void {
    void navigate('/notas');
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next: Tab = tab === 'write' ? 'preview' : 'write';
      setTab(next);
      document.getElementById(`${panelId}-tab-${next}`)?.focus();
    }
  }

  const tabClass = (current: Tab) =>
    `rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${tab === current ? 'border-slate-300 bg-white font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {note === undefined ? 'Nueva nota' : 'Editar nota'}
        </h1>
        <Link to="/notas" className="text-sm underline">
          Volver a las notas
        </Link>
      </div>

      {blocker.state === 'blocked' && (
        <div
          role="alertdialog"
          aria-label="Cambios sin guardar"
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
        >
          <span className="flex-1">Tienes cambios sin guardar. Si sales, se perderán.</span>
          <Button type="button" variant="danger" onClick={() => blocker.proceed()}>
            Salir sin guardar
          </Button>
          <AutoFocusButton onClick={() => blocker.reset()}>Seguir editando</AutoFocusButton>
        </div>
      )}

      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        aria-label={note === undefined ? 'Nueva nota' : 'Editar nota'}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <TextField
          label="Título"
          value={title}
          onChange={(value) => {
            setTitle(value);
            setJustSaved(false);
          }}
          error={titleError}
          maxLength={MAX_NOTE_TITLE}
          autoFocus={note === undefined}
        />

        <div className="flex flex-col">
          <div role="tablist" aria-label="Cuerpo de la nota" className="flex gap-1">
            <button
              type="button"
              role="tab"
              id={`${panelId}-tab-write`}
              aria-selected={tab === 'write'}
              aria-controls={panelId}
              tabIndex={tab === 'write' ? 0 : -1}
              onClick={() => setTab('write')}
              onKeyDown={onTabKeyDown}
              className={tabClass('write')}
            >
              Escribir
            </button>
            <button
              type="button"
              role="tab"
              id={`${panelId}-tab-preview`}
              aria-selected={tab === 'preview'}
              aria-controls={panelId}
              tabIndex={tab === 'preview' ? 0 : -1}
              onClick={() => setTab('preview')}
              onKeyDown={onTabKeyDown}
              className={tabClass('preview')}
            >
              Vista previa
            </button>
          </div>
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${panelId}-tab-${tab}`}
            className="rounded-b-md rounded-tr-md border border-slate-300 p-2"
          >
            {tab === 'write' ? (
              <>
                <label htmlFor={bodyId} className="sr-only">
                  Texto en Markdown
                </label>
                <textarea
                  id={bodyId}
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    setJustSaved(false);
                  }}
                  rows={14}
                  maxLength={MAX_NOTE_BODY}
                  spellCheck
                  className="w-full resize-y rounded-md px-2 py-1 font-mono text-sm focus:outline-none"
                />
                <p className="text-xs text-slate-500">
                  Markdown. El HTML no se interpreta y las imágenes externas no se cargan.
                </p>
              </>
            ) : (
              <div className="min-h-32 px-2">
                <MarkdownPreview source={body} />
              </div>
            )}
          </div>
        </div>

        <TagInput
          value={tagNames}
          onChange={(next) => {
            setTagNames(next);
            setJustSaved(false);
          }}
          known={(tags.data ?? []).map((tag) => tag.name)}
        />

        <ProblemNotice error={error} />
        {justSaved && (
          <p role="status" className="text-sm text-green-800">
            Nota guardada.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || (note !== undefined && !dirty)}>Guardar</Button>
          <Button type="button" variant="secondary" onClick={leave}>
            Cerrar
          </Button>
          {note !== undefined && (
            <Button type="button" variant="danger" onClick={() => setConfirmingDelete(true)}>
              Borrar
            </Button>
          )}
        </div>
      </form>

      {confirmingDelete && note !== undefined && (
        <>
          <ConfirmBar
            message={`¿Borrar «${note.title}»? No se puede deshacer.`}
            confirmLabel="Borrar la nota"
            pending={remove.isPending}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() =>
              remove.mutate(note.id, {
                onSuccess: () => {
                  guard.current = false;
                  void navigate('/notas', { replace: true });
                },
              })
            }
          />
          <ProblemNotice error={remove.error} />
        </>
      )}
    </div>
  );
}

/** Botón secundario que toma el foco al aparecer (la opción segura del aviso). */
function AutoFocusButton({ onClick, children }: { onClick: () => void; children: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
    >
      {children}
    </button>
  );
}
