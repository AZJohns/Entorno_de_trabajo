/**
 * Consultas y mutaciones de las tareas y del tiempo dedicado. Las respuestas se validan con los
 * esquemas de `@backoffice/shared`. El tablero se guarda como `['tasks', 'board']`; mover una tarjeta
 * actualiza la caché al instante y la deshace si el servidor lo rechaza.
 */
import {
  reminderListResponseSchema,
  reminderResponseSchema,
  taskBoardResponseSchema,
  taskResponseSchema,
  timeEntryListResponseSchema,
  timeEntryResponseSchema,
  type CreateReminderRequest,
  type CreateTaskRequest,
  type CreateTimeEntryRequest,
  type TaskBoardResponse,
  type TaskStatus,
  type UpdateTaskRequest,
} from '@backoffice/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client.ts';
import { moveInColumns, moveRequest, normalizeColumns } from './boardLogic.ts';

const ROOT = 'tasks';
export const BOARD_KEY = [ROOT, 'board'] as const;

const segment = (value: string) => encodeURIComponent(value);

function invalidate(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [ROOT] });
}

export function useBoard() {
  return useQuery({
    queryKey: BOARD_KEY,
    queryFn: () => api('/tasks', { schema: taskBoardResponseSchema }),
    select: (board) => normalizeColumns(board.columns),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskRequest) =>
      api('/tasks', { method: 'POST', body, schema: taskResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateTaskRequest }) =>
      api(`/tasks/${segment(input.id)}`, {
        method: 'PATCH',
        body: input.body,
        schema: taskResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

/** Borrar una tarea borra también su tiempo dedicado (cascada en la base de datos). */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/tasks/${segment(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient),
  });
}

interface MoveInput {
  id: string;
  status: TaskStatus;
  /** Lugar en la columna de destino, sin contar la propia tarea. */
  index: number;
}

/**
 * Mueve una tarea. Optimista: la tarjeta cambia de sitio en la caché al momento; si el servidor lo
 * rechaza (o no hay red), se restaura el tablero anterior y el error llega a quien llamó. Al terminar
 * se recarga el tablero, que es la fuente de verdad (el servidor renumera las posiciones).
 */
export function useMoveTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, index }: MoveInput) => {
      const board = queryClient.getQueryData<TaskBoardResponse>(BOARD_KEY);
      // Se calcula con el tablero previo al movimiento optimista, que ya se aplicó en `onMutate`:
      // las vecinas de destino son las mismas porque el índice no cuenta la propia tarea.
      const columns = normalizeColumns(board?.columns ?? []);
      return api(`/tasks/${segment(id)}/move`, {
        method: 'POST',
        body: moveRequest(columns, id, status, index),
      });
    },
    onMutate: async ({ id, status, index }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<TaskBoardResponse>(BOARD_KEY);
      if (previous !== undefined) {
        queryClient.setQueryData<TaskBoardResponse>(BOARD_KEY, {
          columns: moveInColumns(normalizeColumns(previous.columns), id, status, index),
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(BOARD_KEY, context.previous);
    },
    onSettled: () => invalidate(queryClient),
  });
}

// --- tiempo dedicado -----------------------------------------------------------------------------

export function useTimeEntries(taskId: string) {
  return useQuery({
    queryKey: [ROOT, 'time', taskId],
    queryFn: () =>
      api(`/tasks/${segment(taskId)}/time-entries`, { schema: timeEntryListResponseSchema }).then(
        (result) => result.items,
      ),
  });
}

export function useStartTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api(`/tasks/${segment(taskId)}/timer/start`, {
        method: 'POST',
        schema: timeEntryResponseSchema,
      }),
    // También tras un 409 se recarga: el tablero dirá qué cronómetro está en marcha.
    onSettled: () => invalidate(queryClient),
  });
}

export function useStopTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api(`/tasks/${segment(taskId)}/timer/stop`, {
        method: 'POST',
        schema: timeEntryResponseSchema,
      }),
    onSettled: () => invalidate(queryClient),
  });
}

export function useAddTimeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; body: CreateTimeEntryRequest }) =>
      api(`/tasks/${segment(input.taskId)}/time-entries`, {
        method: 'POST',
        body: input.body,
        schema: timeEntryResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api(`/time-entries/${segment(entryId)}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient),
  });
}

// --- recordatorios --------------------------------------------------------------------------------

export function useReminders(taskId: string) {
  return useQuery({
    queryKey: [ROOT, 'reminders', taskId],
    queryFn: () =>
      api(`/tasks/${segment(taskId)}/reminders`, { schema: reminderListResponseSchema }).then(
        (result) => result.items,
      ),
  });
}

export function useAddReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string } & CreateReminderRequest) =>
      api(`/tasks/${segment(input.taskId)}/reminders`, {
        method: 'POST',
        body: { remindAtLocal: input.remindAtLocal },
        schema: reminderResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; reminderId: string }) =>
      api(`/tasks/${segment(input.taskId)}/reminders/${segment(input.reminderId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

/** Qué se intentaba al fallar: decide el texto del 409, que depende de la acción y no del mensaje. */
export type TimeAction = 'start' | 'stop' | 'add' | 'delete';

const OVERLAP =
  'Ese tiempo se solapa con otra anotación o con el cronómetro en marcha. Cambia el inicio o el fin.';

/** Explica que ya hay un cronómetro y en qué tarea, si se sabe. */
export function timerRunningText(running?: string): string {
  return running === undefined
    ? 'Ya hay un cronómetro en marcha en otra tarea. Páralo antes de iniciar este.'
    : `Ya hay un cronómetro en marcha en «${running}». Páralo antes de iniciar este.`;
}

/**
 * Mensaje en español de un error de tiempo. El 409 significa cosas distintas según la acción (ya hay un
 * cronómetro, no hay ninguno que parar, solape) y se elige por ella, no leyendo el texto del servidor.
 * `running` es el título de la tarea con el cronómetro en marcha, si se conoce, para decir cuál es.
 */
export function timeErrorText(error: unknown, action: TimeAction, running?: string): string {
  if (!(error instanceof ApiError)) return 'Ha ocurrido un error inesperado';
  if (error.status === 409) {
    if (action === 'add') return OVERLAP;
    if (action === 'stop')
      return 'Esta tarea no tiene un cronómetro en marcha. Se ha actualizado el tablero.';
    // Iniciar: el servidor también da 409 si el cronómetro empezaría dentro de otra anotación.
    if (error.message.includes('dentro de otra anotación')) return OVERLAP;
    return timerRunningText(running);
  }
  if (error.status === 422) {
    return 'El tiempo no puede terminar en el futuro. Revisa el inicio y el fin.';
  }
  return error.message;
}

/** Mensaje de un movimiento rechazado. */
export function moveErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return 'La tarea ya no existe. Se ha recargado el tablero.';
  }
  if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
    return `No se pudo mover la tarea: ${error.message}. Se ha devuelto a su sitio.`;
  }
  if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
    return 'No se pudo mover la tarea: sin conexión con el servidor. Se ha devuelto a su sitio.';
  }
  return 'No se pudo mover la tarea. Se ha devuelto a su sitio.';
}
