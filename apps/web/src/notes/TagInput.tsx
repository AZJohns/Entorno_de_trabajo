/**
 * Campo de etiquetas con autocompletado (patrón «combobox» de WAI-ARIA con lista):
 * - Escribir filtra las etiquetas existentes; ↓/↑ recorren las sugerencias, Enter elige la activa (o crea
 *   la escrita) y Escape cierra la lista. La coma también añade lo escrito.
 * - Retroceso con el campo vacío quita la última etiqueta; cada etiqueta tiene su botón «Quitar».
 * - Las repetidas que solo difieren en mayúsculas se unen (ver `tagLogic.ts`).
 */
import { MAX_TAG_NAME, MAX_TAGS_PER_NOTE } from '@backoffice/shared';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { addTag, suggestTags } from './tagLogic.ts';

interface Props {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** Nombres de las etiquetas que ya existen. */
  known: readonly string[];
}

export function TagInput({ value, onChange, known }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const suggestions = open ? suggestTags(known, value, typed) : [];
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${String(index)}`;
  const full = value.length >= MAX_TAGS_PER_NOTE;

  function commit(name: string): void {
    onChange(addTag(value, name, known));
    setTyped('');
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (suggestions.length === 0 ? -1 : (index + 1) % suggestions.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) =>
        suggestions.length === 0 ? -1 : (index <= 0 ? suggestions.length : index) - 1,
      );
    } else if (event.key === 'Enter') {
      // Enter nunca envía el formulario desde este campo: añade la etiqueta.
      event.preventDefault();
      const chosen = active >= 0 ? suggestions[active] : undefined;
      commit(chosen ?? typed);
    } else if (event.key === ',') {
      event.preventDefault();
      commit(typed);
    } else if (event.key === 'Escape') {
      if (open) event.stopPropagation();
      setOpen(false);
      setActive(-1);
    } else if (event.key === 'Backspace' && typed === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-slate-700">
        Etiquetas
      </label>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 px-2 py-1.5 focus-within:border-slate-600">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-sm"
            >
              {tag}
              <button
                type="button"
                aria-label={`Quitar la etiqueta ${tag}`}
                onClick={() => {
                  onChange(value.filter((other) => other !== tag));
                  inputRef.current?.focus();
                }}
                className="rounded px-1 text-slate-500 hover:text-slate-900"
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${id}-input`}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-describedby={`${id}-hint`}
            value={typed}
            maxLength={MAX_TAG_NAME}
            disabled={full}
            autoComplete="off"
            onChange={(event) => {
              setTyped(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Lo escrito y no confirmado se añade al salir del campo: no se pierde en silencio.
              if (typed.trim() !== '') commit(typed);
              setOpen(false);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-base focus:outline-none"
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Etiquetas existentes"
          hidden={suggestions.length === 0}
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-300 bg-white shadow"
        >
          {suggestions.map((tag, index) => (
            <li
              key={tag}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // `mouseDown` y no `click`: el campo pierde el foco antes del clic y cerraría la lista.
              onMouseDown={(event) => {
                event.preventDefault();
                commit(tag);
              }}
              className={`cursor-pointer px-3 py-1.5 text-sm ${index === active ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
            >
              {tag}
            </li>
          ))}
        </ul>
      </div>
      <p id={`${id}-hint`} className="text-xs text-slate-500">
        Enter o coma para añadir; ↓ para ver las existentes. Máximo {MAX_TAGS_PER_NOTE}. No se
        distinguen mayúsculas.
      </p>
    </div>
  );
}
