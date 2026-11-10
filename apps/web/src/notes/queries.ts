/**
 * Consultas y mutaciones de las notas y las etiquetas. Todas cuelgan de la clave `['notes']`, así que
 * cualquier cambio invalida listas, notas y etiquetas a la vez (los recuentos de las etiquetas cambian
 * al editar una nota). Las respuestas se validan con los esquemas de `@backoffice/shared`.
 */
import {
  noteListResponseSchema,
  noteResponseSchema,
  tagListResponseSchema,
  tagResponseSchema,
  type CreateNoteRequest,
  type UpdateNoteRequest,
} from '@backoffice/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, ApiError } from '../api/client.ts';

const ROOT = 'notes';
const PAGE_SIZE = 20;

const segment = (value: string) => encodeURIComponent(value);

function invalidate(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [ROOT] });
}

interface ListFilters {
  /** Texto de búsqueda ya recortado; vacío = sin búsqueda. */
  q: string;
  /** Nombre de la etiqueta; vacío = todas. */
  tag: string;
}

/** Lista paginada con el cursor de la API. Con `q` va por relevancia; sin él, por última edición. */
export function useNotes({ q, tag }: ListFilters) {
  return useInfiniteQuery({
    queryKey: [ROOT, 'list', q, tag],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (q !== '') params.set('q', q);
      if (tag !== '') params.set('tag', tag);
      if (pageParam !== null) params.set('cursor', pageParam);
      return api(`/notes?${params.toString()}`, { schema: noteListResponseSchema });
    },
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: [ROOT, 'note', id],
    queryFn: () => api(`/notes/${segment(id ?? '')}`, { schema: noteResponseSchema }),
    enabled: id !== undefined,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNoteRequest) =>
      api('/notes', { method: 'POST', body, schema: noteResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateNoteRequest }) =>
      api(`/notes/${segment(input.id)}`, {
        method: 'PATCH',
        body: input.body,
        schema: noteResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/notes/${segment(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useTags() {
  return useQuery({
    queryKey: [ROOT, 'tags'],
    queryFn: () => api('/tags', { schema: tagListResponseSchema }).then((result) => result.items),
  });
}

export function useRenameTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api(`/tags/${segment(input.id)}`, {
        method: 'PATCH',
        body: { name: input.name },
        schema: tagResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

/** Mensaje en español de un fallo al renombrar: el 409 (nombre repetido) tiene texto propio. */
export function renameErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'Ya existe otra etiqueta con ese nombre (no se distinguen mayúsculas). Elige otro.';
  }
  if (error instanceof ApiError && error.status === 404) return 'La etiqueta ya no existe.';
  if (error instanceof ApiError && error.status === 400) return 'El nombre no es válido.';
  return 'No se pudo renombrar la etiqueta. Inténtalo de nuevo.';
}
