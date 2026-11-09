/**
 * Reglas de negocio de las tareas y del tablero (docs/plan.md §2.6, fase 4a). No conoce `req` ni `res`.
 *
 * Todo lo que cambia posiciones (alta, borrado, movimiento) corre en una transacción que toma antes el
 * bloqueo del tablero (`TaskRepository.lockBoard`), así que los movimientos concurrentes se serializan.
 * Las posiciones son enteros consecutivos 0..n-1 por columna (`domain/ordering.ts`).
 *
 * Códigos de error (la base de datos impone además las restricciones de la migración 0006):
 * - 404: la tarea de la URL no existe.
 * - 422 (`UNPROCESSABLE`): el cuerpo es válido pero incoherente con el tablero: la tarea de referencia de
 *   un movimiento (`beforeId`/`afterId`) es la propia tarea o no está en la columna de destino.
 */
import type { Kysely } from 'kysely';
import type {
  CreateTaskRequest,
  MoveTaskRequest,
  TaskStatus,
  UpdateTaskRequest,
} from '@backoffice/shared';
import { TASK_STATUSES } from '@backoffice/shared';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import {
  placeTask,
  placementChanges,
  removeTask,
  type Anchor,
  type Columns,
} from './domain/ordering.ts';
import { totalSeconds } from './domain/time.ts';
import { TaskRepository, type TaskRecord } from './tasks.repository.ts';
import { TimeEntryRepository, type TimeStats } from './time-entries.repository.ts';

export interface TasksServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Una tarea con su tiempo dedicado, calculado al leer. */
export interface TaskView extends TaskRecord {
  /** Segundos dedicados; si el cronómetro está en marcha, hasta ahora. */
  readonly timeSpentSeconds: number;
  /** Inicio del cronómetro en marcha de esta tarea, o `null`. */
  readonly timerStartedAt: Date | null;
}

export interface ColumnView {
  readonly status: TaskStatus;
  readonly tasks: readonly TaskView[];
}

export interface MoveResult {
  readonly task: TaskView;
  /** Columnas cuyo orden ha cambiado, con su orden nuevo: la de origen y la de destino (una si es la misma). */
  readonly columns: readonly ColumnView[];
}

export function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'La tarea no existe');
}

function unprocessable(path: string, message: string): AppError {
  return new AppError('UNPROCESSABLE', 422, message, [{ path, message }]);
}

function withTime(task: TaskRecord, stats: TimeStats | undefined, now: Date): TaskView {
  return {
    ...task,
    timeSpentSeconds: totalSeconds(stats?.closedSeconds ?? 0, stats?.runningSince ?? null, now),
    timerStartedAt: stats?.runningSince ?? null,
  };
}

export class TasksService {
  readonly #deps: TasksServiceDeps;

  constructor(deps: TasksServiceDeps) {
    this.#deps = deps;
  }

  /** El tablero: las cuatro columnas en orden o, con `status`, solo esa. */
  async board(status?: TaskStatus): Promise<ColumnView[]> {
    const { db, clock } = this.#deps;
    const [tasks, stats] = await Promise.all([
      new TaskRepository(db).list(status),
      new TimeEntryRepository(db).statsByTask(),
    ]);
    const now = clock.now();
    return (status === undefined ? TASK_STATUSES : [status]).map((column) => ({
      status: column,
      tasks: tasks
        .filter((task) => task.status === column)
        .map((task) => withTime(task, stats.get(task.id), now)),
    }));
  }

  async get(id: string): Promise<TaskView> {
    const { db, clock } = this.#deps;
    const task = await new TaskRepository(db).find(id);
    if (task === undefined) throw notFound();
    const stats = await new TimeEntryRepository(db).statsByTask([id]);
    return withTime(task, stats.get(id), clock.now());
  }

  /** Crea la tarea al final de la columna (por defecto, «Por hacer»). */
  async create(input: CreateTaskRequest): Promise<TaskView> {
    const now = this.#deps.clock.now();
    const created = await this.#deps.db.transaction().execute(async (trx) => {
      const tasks = new TaskRepository(trx);
      await tasks.lockBoard();
      return tasks.insert({
        title: input.title,
        descriptionMd: input.descriptionMd ?? null,
        dueOn: input.dueOn ?? null,
        status: input.status,
        position: await tasks.countInColumn(input.status),
        // Una tarea que nace en «Terminado» ya está terminada (CHECK de la tabla).
        completedAt: input.status === 'done' ? now : null,
      });
    });
    return withTime(created, undefined, now);
  }

  /** Edita título, descripción o fecha límite. La columna y la posición solo cambian con `move`. */
  async update(id: string, input: UpdateTaskRequest): Promise<TaskView> {
    const { db, clock } = this.#deps;
    const now = clock.now();
    const updated = await new TaskRepository(db).update(id, input, now);
    if (updated === undefined) throw notFound();
    const stats = await new TimeEntryRepository(db).statsByTask([id]);
    return withTime(updated, stats.get(id), now);
  }

  /** Borra la tarea (y su tiempo, en cascada) y cierra el hueco que deja en su columna. */
  async delete(id: string): Promise<void> {
    const now = this.#deps.clock.now();
    await this.#deps.db.transaction().execute(async (trx) => {
      const tasks = new TaskRepository(trx);
      await tasks.lockBoard();
      const before = await tasks.columns();
      if (!(await tasks.delete(id))) throw notFound();
      await tasks.place(placementChanges(before, removeTask(before, id)), now);
    });
  }

  /**
   * Mueve la tarea a `status`: delante de `beforeId`, detrás de `afterId` o, sin ninguno, al final. Sirve
   * igual dentro de una columna que entre columnas. Renumera solo las filas afectadas, en una
   * transacción y bajo el bloqueo del tablero.
   *
   * Mover a «Terminado» marca `completed_at`; sacarla de «Terminado» lo borra. No toca el cronómetro.
   */
  async move(id: string, input: MoveTaskRequest): Promise<MoveResult> {
    const now = this.#deps.clock.now();
    const anchor: Anchor | undefined =
      input.beforeId !== undefined
        ? { kind: 'before', taskId: input.beforeId }
        : input.afterId !== undefined
          ? { kind: 'after', taskId: input.afterId }
          : undefined;
    const affected = await this.#deps.db.transaction().execute(async (trx) => {
      const tasks = new TaskRepository(trx);
      await tasks.lockBoard();
      const task = await tasks.find(id);
      if (task === undefined) throw notFound();
      const before: Columns = await tasks.columns();
      const placed = placeTask(before, id, input.status, anchor);
      if (!placed.ok) {
        const path = input.beforeId !== undefined ? 'beforeId' : 'afterId';
        throw unprocessable(
          path,
          placed.reason === 'anchor_is_task'
            ? 'La tarea de referencia no puede ser la propia tarea'
            : 'La tarea de referencia no está en la columna de destino',
        );
      }
      await tasks.place(placementChanges(before, placed.columns), now);
      return task.status === input.status ? [input.status] : [task.status, input.status];
    });
    // Se lee después de confirmar: la respuesta es el estado que ya ven las demás peticiones.
    const board = await this.board();
    const columns = board.filter((column) => affected.includes(column.status));
    const task = columns.flatMap((column) => column.tasks).find((candidate) => candidate.id === id);
    // La tarea acaba de moverse y el bloqueo impidió que otra la borrara antes de confirmar; un borrado
    // posterior es posible, aunque improbable: se trata como «no existe».
    if (task === undefined) throw notFound();
    return { task, columns };
  }
}
