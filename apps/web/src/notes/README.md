# Pantalla «Notas» (web)

Interfaz de `apps/api/src/modules/notes`. Diseño y API: `docs/plan.md` §2.8 y §2.10. Rutas: `/notas` (lista y
búsqueda), `/notas/nueva` y `/notas/:id` (editor).

| Archivo | Contenido |
|---|---|
| `NotesPage.tsx` | Lista (las más recientes primero) con «Cargar más», buscador, filtro por etiqueta y gestión de etiquetas |
| `NoteEditorPage.tsx` | Editor: título, `textarea` en Markdown con pestaña «Vista previa», etiquetas, borrado con confirmación y aviso de cambios sin guardar |
| `markdown.tsx` | Vista previa segura: tokens de `marked.lexer` → elementos de React. Exporta `safeHref` |
| `Snippet.tsx` | Fragmento de una búsqueda: tramos `{ text, match }` pintados como texto, con `<mark>` en las coincidencias |
| `TagInput.tsx` | Etiquetas con autocompletado (combobox accesible con teclado) |
| `TagsPanel.tsx` | Lista de etiquetas con renombrado en línea y el 409 en español |
| `tagLogic.ts` | Lógica pura: unir etiquetas que solo difieren en mayúsculas, sugerencias, comparación |
| `queries.ts` | react-query: lista paginada con el cursor de la API, nota, alta, edición, borrado, etiquetas |

## Decisiones

### Vista previa del Markdown: nada pasa por HTML

`marked` solo se usa para analizar (`marked.lexer`); nunca se llama a `marked.parse()`. Cada token se convierte
en un elemento de React, de modo que React escapa todo el texto y no hay `dangerouslySetInnerHTML` (ESLint lo
prohíbe). La comparación con `react-markdown` y `markdown-to-jsx` está en `docs/dependencias.md`.

- **HTML escrito en la nota** (`<script>`, `<img onerror>`, `<div onclick>`…): se muestra como texto.
- **Enlaces**: solo `http`, `https` y `mailto`, con esquema explícito (`safeHref`, que usa `new URL` como el
  navegador, así que `JaVaScRiPt:` o `java<tab>script:` quedan fuera). Con `rel="noopener noreferrer"` y
  `target="_blank"`. Los demás se muestran como texto, sin enlace.
- **Imágenes**: no se cargan, para que una nota no avise a un tercero de que se abre. Se muestra
  «[Imagen no cargada: texto alternativo]` y, si la dirección es segura, un enlace que el propietario decide abrir.
- **Títulos**: empiezan en `h3` (la pantalla ya usa `h1` y `h2`).
- Un `&amp;` escrito se ve literal; no se decodifican entidades. Compatibilidad CommonMark parcial a propósito.
- Sin extensiones: no hay notas al pie, matemáticas ni resaltado de código.

**CSP**: no cambia. La de la API ya envía `img-src 'self' data:` (`apps/api/src/http/security.ts`) y la vista previa
no crea ningún `<img>`; si algún día lo hiciera, la CSP bloquearía las imágenes externas.

### Búsqueda y resaltado

La API devuelve el fragmento como tramos de texto (ver el README del módulo `notes`). `Snippet` los pinta como
nodos de texto, con `<mark>` si `match`, también cuando el texto contiene HTML. La búsqueda se envía al pulsar
«Buscar» (no al teclear): así no se lanzan consultas a medias, y un texto sin letras ni cifras no se envía (la API
lo rechazaría con 400). La pantalla explica que encuentra palabras completas o su principio.

### Cambios sin guardar

El editor sabe qué es lo último guardado y compara título, cuerpo y etiquetas (estas sin distinguir mayúsculas ni
orden). Con diferencias: `useBlocker` de React Router detiene la navegación interna y muestra «Salir sin guardar» /
«Seguir editando» (el foco va a la opción segura), y `beforeunload` avisa al cerrar o recargar la pestaña. Tras
guardar o borrar se baja el aviso antes de navegar.

### Etiquetas

El autocompletado es un combobox con lista (ARIA): ↓/↑ recorren, Enter elige o crea, coma añade, Escape cierra,
Retroceso con el campo vacío quita la última. Lo escrito y no confirmado se añade al salir del campo. Las
repetidas que solo difieren en mayúsculas se unen en pantalla (`tagLogic.ts`) y la API las deduplica de nuevo; una
etiqueta existente conserva su grafía. Renombrar a un nombre ya usado da un 409 que se explica en español; cambiar
solo las mayúsculas de la propia etiqueta es válido.

## Pendiente

- Archivar notas y borrar etiquetas: no están en la API (ver el README del módulo `notes`).
- Sin tests de extremo a extremo en un navegador real: las pantallas se prueban con jsdom y la API simulada.
