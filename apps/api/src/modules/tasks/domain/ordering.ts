/**
 * Orden de las tareas en el tablero: lógica pura, sin E/S (docs/plan.md §2.6).
 *
 * Cada columna es una lista de identificadores y la posición de una tarea es su índice (0..n-1, sin
 * huecos ni repetidos). Mover una tarea es sacarla de su lista e insertarla en otra (o en la misma) y
 * volver a numerar. Estas funciones calculan el resultado; el repositorio solo escribe las filas que
 * cambian.
 */
import { TASK_STATUSES, type TaskStatus } from '@backoffice/shared';

/** Identificadores de las tareas de cada columna, en orden. */
export type Columns = Readonly<Record<TaskStatus, readonly string[]>>;

/** Dónde colocar la tarea dentro de la columna de destino. Sin ancla, al final. */
export type Anchor =
  | { readonly kind: 'before'; readonly taskId: string }
  | { readonly kind: 'after'; readonly taskId: string };

/** Tarea que cambia de columna o de posición. */
export interface Placement {
  readonly id: string;
  readonly status: TaskStatus;
  readonly position: number;
}

export type MoveResult =
  | { readonly ok: true; readonly columns: Columns }
  | { readonly ok: false; readonly reason: 'anchor_is_task' | 'anchor_not_in_column' };

/** Tablero vacío. */
export function emptyColumns(): Record<TaskStatus, string[]> {
  return { todo: [], in_progress: [], testing: [], done: [] };
}

/**
 * Coloca `taskId` en la columna `target`, delante o detrás de `anchor` o al final.
 *
 * La tarea se saca primero de su columna actual (sea cual sea) y después se inserta, de modo que mover
 * dentro de la misma columna y entre columnas es la misma operación. El ancla se busca en la columna de
 * destino **sin** la tarea movida: así «detrás de la tarea que ahora está justo antes» deja el orden
 * como estaba, sin desplazarla por error.
 *
 * @returns `anchor_is_task` si el ancla es la propia tarea; `anchor_not_in_column` si el ancla no está en
 *   la columna de destino (no existe, o está en otra columna).
 */
export function placeTask(
  columns: Columns,
  taskId: string,
  target: TaskStatus,
  anchor?: Anchor,
): MoveResult {
  if (anchor?.taskId === taskId) return { ok: false, reason: 'anchor_is_task' };
  const next = emptyColumns();
  for (const status of TASK_STATUSES) {
    next[status] = columns[status].filter((id) => id !== taskId);
  }
  const destination = next[target];
  let index = destination.length;
  if (anchor !== undefined) {
    const at = destination.indexOf(anchor.taskId);
    if (at === -1) return { ok: false, reason: 'anchor_not_in_column' };
    index = anchor.kind === 'before' ? at : at + 1;
  }
  destination.splice(index, 0, taskId);
  return { ok: true, columns: next };
}

/**
 * Posiciones que hay que escribir para pasar de `before` a `after`: solo las tareas cuya columna o
 * posición cambian. Una tarea que se queda donde estaba no se toca.
 */
export function placementChanges(before: Columns, after: Columns): Placement[] {
  const previous = new Map<string, { status: TaskStatus; position: number }>();
  for (const status of TASK_STATUSES) {
    before[status].forEach((id, position) => previous.set(id, { status, position }));
  }
  const changes: Placement[] = [];
  for (const status of TASK_STATUSES) {
    after[status].forEach((id, position) => {
      const old = previous.get(id);
      if (old === undefined || old.status !== status || old.position !== position) {
        changes.push({ id, status, position });
      }
    });
  }
  return changes;
}

/** Quita `taskId` de su columna y cierra el hueco (borrado de una tarea). */
export function removeTask(columns: Columns, taskId: string): Columns {
  const next = emptyColumns();
  for (const status of TASK_STATUSES) {
    next[status] = columns[status].filter((id) => id !== taskId);
  }
  return next;
}
