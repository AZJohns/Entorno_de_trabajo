/**
 * Pantalla «Notas»: lista (las más recientes primero) con «Cargar más», buscador con fragmentos
 * resaltados, filtro por etiqueta y gestión (renombrado) de etiquetas. Ver `README.md`.
 */
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ErrorMessage, Loading } from '../ui/forms.tsx';
import { formatMadridMoment } from '../ui/moment.ts';
import { useNotes, useTags } from './queries.ts';
import { Snippet } from './Snippet.tsx';
import { TagsPanel } from './TagsPanel.tsx';

/** La API rechaza (400) un texto sin ninguna letra o cifra: no se envía. */
const SEARCHABLE = /[\p{L}\p{N}]/u;

export function NotesPage() {
  const searchId = useId();
  const tagFilterId = useId();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [managing, setManaging] = useState(false);

  const notes = useNotes({ q, tag });
  const tags = useTags();

  function search(event: FormEvent): void {
    event.preventDefault();
    const text = draft.trim();
    setQ(SEARCHABLE.test(text) ? text : '');
  }

  function clearSearch(): void {
    setDraft('');
    setQ('');
  }

  const items = notes.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Notas</h1>
        <Link
          to="/notas/nueva"
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Nueva nota
        </Link>
      </div>

      <form
        onSubmit={search}
        role="search"
        aria-label="Buscar notas"
        className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor={searchId} className="text-sm font-medium text-slate-700">
              Buscar
            </label>
            <input
              id={searchId}
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              autoComplete="off"
              aria-describedby={`${searchId}-help`}
              className="rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-600 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={tagFilterId} className="text-sm font-medium text-slate-700">
              Etiqueta
            </label>
            <select
              id={tagFilterId}
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-base"
            >
              <option value="">Todas</option>
              {(tags.data ?? []).map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name} ({item.noteCount})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Buscar
          </button>
          {q !== '' && (
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Quitar búsqueda
            </button>
          )}
        </div>
        <p id={`${searchId}-help`} className="text-xs text-slate-500">
          La búsqueda encuentra palabras completas o su principio («presup» encuentra
          «presupuesto»), sin distinguir mayúsculas ni acentos. No encuentra un trozo del medio de
          una palabra ni tolera erratas.
        </p>
      </form>

      <div>
        <button
          type="button"
          onClick={() => setManaging((open) => !open)}
          aria-expanded={managing}
          className="text-sm underline"
        >
          {managing ? 'Ocultar etiquetas' : 'Gestionar etiquetas'}
        </button>
        {managing && <TagsPanel tags={tags.data ?? []} />}
      </div>

      {notes.isPending && <Loading />}
      {notes.isError && <ErrorMessage error={notes.error} />}
      {notes.isSuccess && items.length === 0 && (
        <p className="text-sm text-slate-600">
          {q !== '' || tag !== ''
            ? 'Ninguna nota coincide con la búsqueda.'
            : 'Aún no hay notas. Crea la primera con «Nueva nota».'}
        </p>
      )}
      {items.length > 0 && (
        <ul aria-label="Notas" className="flex flex-col gap-2">
          {items.map((note) => (
            <li key={note.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  <Link to={`/notas/${note.id}`} className="underline-offset-2 hover:underline">
                    {note.title}
                  </Link>
                </h2>
                <time dateTime={note.updatedAt} className="text-xs text-slate-500">
                  {formatMadridMoment(note.updatedAt)}
                </time>
              </div>
              {note.snippet !== null ? (
                <Snippet fragments={note.snippet} />
              ) : (
                note.preview !== '' && (
                  <p className="line-clamp-2 whitespace-pre-line text-sm text-slate-600">
                    {note.preview}
                  </p>
                )
              )}
              {note.tags.length > 0 && (
                <ul aria-label="Etiquetas" className="mt-2 flex flex-wrap gap-1">
                  {note.tags.map((item) => (
                    <li key={item.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                      {item.name}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {notes.hasNextPage && (
        <div>
          <button
            type="button"
            onClick={() => void notes.fetchNextPage()}
            disabled={notes.isFetchingNextPage}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {notes.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
      {notes.isFetchNextPageError && <ErrorMessage error={notes.error} />}
    </div>
  );
}
