/**
 * Lógica pura del tablero de tareas (sin E/S ni React): colocar una tarjeta en otra columna, traducirlo
 * a la petición `move`, vencidas, ventana de «Terminado» y formato de duraciones. Se prueba aparte.
 */
import {
  TASK_STATUSES,
  type MoveTaskRequest,
  type TaskColumnResponse,
  type TaskResponse,
  type TaskStatus,
} from '@backoffice/shared';

/** Nombre de cada columna, en español. */
export const COLUMN_LABEL: Readonly<Record<TaskStatus, string>> = {
  todo: 'Por hacer',
  in_progress: 'En curso',
  testing: 'En prueba',
  done: 'Terminado',
};

/** Cuántas tareas terminadas se muestran de primeras y cuántas más añade cada «Ver más». */
export const DONE_PAGE_SIZE = 10;

/** Las cuatro columnas en orden; una que falte en la respuesta se trata como vacía. */
export function normalizeColumns(columns: readonly TaskColumnResponse[]): TaskColumnResponse[] {
  return TASK_STATUSES.map((status) => ({
    status,
    tasks: columns.find((column) => column.status === status)?.tasks ?? [],
  }));
}

/** Busca una tarea en el tablero. */
export function findTask(
  columns: readonly TaskColumnResponse[],
  id: string,
): TaskResponse | undefined {
  return columns.flatMap((column) => column.tasks).find((task) => task.id === id);
}

/**
 * Coloca la tarea en la columna `status`, en el lugar `index` (0 = el primero; fuera de rango = al
 * final). El índice se cuenta **sin** la propia tarea, como lo entiende el servidor. Devuelve columnas
 * nuevas; las de entrada no se tocan. Si la tarea no existe, devuelve las mismas columnas.
 */
export function moveInColumns(
  columns: readonly TaskColumnResponse[],
  id: string,
  status: TaskStatus,
  index: number,
): TaskColumnResponse[] {
  const task = findTask(columns, id);
  if (task === undefined) return [...columns];
  return columns.map((column) => {
    const rest = column.tasks.filter((candidate) => candidate.id !== id);
    if (column.status !== status) return { ...column, tasks: rest };
    const at = Math.max(0, Math.min(index, rest.length));
    return { ...column, tasks: [...rest.slice(0, at), { ...task, status }, ...rest.slice(at)] };
  });
}

/**
 * Petición `move` equivalente a dejar la tarea en el lugar `index` de `status`: detrás de la tarea
 * anterior o, si es la primera, delante de la siguiente; sin vecinas, al final. `index` se cuenta sin la
 * propia tarea.
 */
export function moveRequest(
  columns: readonly TaskColumnResponse[],
  id: string,
  status: TaskStatus,
  index: number,
): MoveTaskRequest {
  const rest = (columns.find((column) => column.status === status)?.tasks ?? []).filter(
    (task) => task.id !== id,
  );
  const at = Math.max(0, Math.min(index, rest.length));
  const previous = rest[at - 1];
  if (previous !== undefined) return { status, afterId: previous.id };
  const next = rest[at];
  if (next !== undefined) return { status, beforeId: next.id };
  return { status };
}

/** Lugar actual de la tarea: su columna y su índice dentro de ella. */
export function locate(
  columns: readonly TaskColumnResponse[],
  id: string,
): { status: TaskStatus; index: number } | undefined {
  for (const column of columns) {
    const index = column.tasks.findIndex((task) => task.id === id);
    if (index !== -1) return { status: column.status, index };
  }
  return undefined;
}

/**
 * Indica si dos tableros dejan cada tarea en el mismo lugar. Sirve para no pedir al servidor un
 * movimiento que no cambia nada.
 */
export function samePlacement(
  a: readonly TaskColumnResponse[],
  b: readonly TaskColumnResponse[],
): boolean {
  return TASK_STATUSES.every((status) => {
    const left = a.find((column) => column.status === status)?.tasks ?? [];
    const right = b.find((column) => column.status === status)?.tasks ?? [];
    return left.length === right.length && left.every((task, i) => task.id === right[i]?.id);
  });
}

/**
 * Una tarea está vencida si tiene fecha límite anterior a hoy y no está terminada. `today` es
 * `YYYY-MM-DD` en la zona del navegador; las fechas con ese formato se ordenan como texto.
 */
export function isOverdue(task: Pick<TaskResponse, 'dueOn' | 'status'>, today: string): boolean {
  return task.dueOn !== null && task.status !== 'done' && task.dueOn < today;
}

/**
 * Las tareas de «Terminado» que se muestran: las más recientes primero (por fecha de cierre) y solo
 * las `limit` primeras. Una sin fecha de cierre (la que acaba de llegar con un movimiento optimista, a
 * la espera de la respuesta del servidor) cuenta como la más reciente.
 */
export function recentDone(tasks: readonly TaskResponse[], limit: number): TaskResponse[] {
  const key = (task: TaskResponse) => task.completedAt ?? '9999';
  return [...tasks].sort((a, b) => key(b).localeCompare(key(a))).slice(0, limit);
}

/** La tarea con el cronómetro en marcha, si hay alguna (solo puede haber una). */
export function runningTask(columns: readonly TaskColumnResponse[]): TaskResponse | undefined {
  return columns.flatMap((column) => column.tasks).find((task) => task.timerStartedAt !== null);
}

/** `3725` → `1 h 02 min 05 s`; menos de una hora, `2 min 05 s`; menos de un minuto, `5 s`. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  if (h > 0) return `${String(h)} h ${two(m)} min ${two(s)} s`;
  if (m > 0) return `${String(m)} min ${two(s)} s`;
  return `${String(s)} s`;
}

/** Segundos desde `startedAt` hasta `now`, sin bajar de 0 por si el reloj del navegador va atrasado. */
export function secondsSince(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
}

/** Resultado de leer el formulario de tiempo manual. */
export type ManualTime =
  | { ok: true; startedAt: string; endedAt?: string; durationSeconds?: number }
  | { ok: false; errors: Record<string, string> };

export interface ManualTimeValues {
  mode: 'duration' | 'range';
  hours: string;
  minutes: string;
  /** `datetime-local`: `YYYY-MM-DDTHH:mm` en la hora del navegador. */
  start: string;
  end: string;
}

/**
 * Convierte el formulario de tiempo manual en la petición de la API.
 *
 * - Duración: se anota como terminada **ahora** (`startedAt = ahora − duración`), así que no hace falta
 *   pedir un inicio. Para otro día, está el modo «Inicio y fin».
 * - Inicio y fin: los `datetime-local` se interpretan en la zona del navegador y se envían como
 *   instante ISO 8601 (con `Z`).
 * Las mismas reglas que el servidor (fin posterior al inicio, máximo 7 días) se avisan aquí antes de
 * enviar; las que dependen de otras filas (solapes) las responde el servidor.
 */
export function buildManualTime(values: ManualTimeValues, now: Date): ManualTime {
  const week = 7 * 24 * 60 * 60;
  if (values.mode === 'duration') {
    const hours = values.hours.trim() === '' ? 0 : Number(values.hours);
    const minutes = values.minutes.trim() === '' ? 0 : Number(values.minutes);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0) {
      return { ok: false, errors: { duration: 'Indica horas y minutos como números enteros' } };
    }
    const seconds = hours * 3600 + minutes * 60;
    if (seconds <= 0)
      return { ok: false, errors: { duration: 'La duración debe ser mayor que 0' } };
    if (seconds > week) {
      return { ok: false, errors: { duration: 'Una anotación no puede durar más de 7 días' } };
    }
    return {
      ok: true,
      startedAt: new Date(now.getTime() - seconds * 1000).toISOString(),
      durationSeconds: seconds,
    };
  }
  const errors: Record<string, string> = {};
  const start = values.start === '' ? Number.NaN : new Date(values.start).getTime();
  const end = values.end === '' ? Number.NaN : new Date(values.end).getTime();
  if (Number.isNaN(start)) errors['start'] = 'Indica el inicio';
  if (Number.isNaN(end)) errors['end'] = 'Indica el fin';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (end <= start) return { ok: false, errors: { end: 'El fin debe ser posterior al inicio' } };
  if ((end - start) / 1000 > week) {
    return { ok: false, errors: { end: 'Una anotación no puede durar más de 7 días' } };
  }
  return {
    ok: true,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
  };
}
