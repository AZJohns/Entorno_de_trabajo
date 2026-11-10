import type { SnippetFragment } from '@backoffice/shared';

/**
 * Fragmento de una búsqueda. Cada tramo llega de la API como TEXTO: se pinta como nodo de texto (React
 * lo escapa) y las coincidencias van en `<mark>`. Nunca se inserta como HTML: un `<script>` escrito en
 * la nota se ve como tal.
 */
export function Snippet({ fragments }: { fragments: readonly SnippetFragment[] }) {
  return (
    <p className="text-sm text-slate-600">
      {fragments.map((fragment, index) =>
        fragment.match ? (
          <mark key={index} className="rounded bg-yellow-200 px-0.5">
            {fragment.text}
          </mark>
        ) : (
          fragment.text
        ),
      )}
    </p>
  );
}
