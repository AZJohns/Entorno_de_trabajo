/**
 * Reglas del tiempo dedicado: cronómetro y anotación manual (docs/plan.md §2.6, fase 4a). Las dos
 * formas se guardan como intervalos en `task_time_entries`; el total se calcula al leer.
 *
 * Códigos de error (la base de datos impone además todas las restricciones de la migración 0006):
 * - 404: la tarea o la entrada de la URL no existe.
 * - 422 (`UNPROCESSABLE`): el cuerpo es válido pero incoherente con el reloj: una anotación manual que
 *   termina en el futuro.
 * - 409 (`CONFLICT`): el estado actual lo impide: ya hay un cronómetro en marcha, no hay ninguno que
 *   parar en esa tarea o la anotación se solapa con otra entrada (o con el cronómetro en marcha).
 *
 * Los dos conflictos de la base de datos (el índice único del cronómetro y la exclusión de solapes) se
 * comprueban antes para dar un mensaje preciso, y se traducen también si saltan por una carrera: dos
 * peticiones a la vez no pueden dejar dos cronómetros ni dos entradas que se pisen.
 */
import type { Kysely } from 'kysely';
import type { CreateTimeEntryRequest } from '@backoffice/shared';
import { isUniqueViolation } from '../../db/errors.ts';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { elapsedSeconds, stopInstant } from './domain/time.ts';
import { TaskRepository } from './tasks.repository.ts';
import { notFound } from './tasks.service.ts';
import { TimeEntryRepository, type TimeEntryRecord } from './time-entries.repository.ts';

export interface TimeEntriesServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Una entrada de tiempo con su duración (hasta ahora si está en marcha). */
export interface TimeEntryView extends TimeEntryRecord {
  readonly durationSeconds: number;
}

const ONE_RUNNING = 'task_time_entries_one_running_idx';
const NO_OVERLAP = 'task_time_entries_no_overlap';
/** SQLSTATE `exclusion_violation`. */
const EXCLUSION_VIOLATION = '23P01';

function conflict(message: string): AppError {
  return new AppError('CONFLICT', 409, message);
}

function isOverlap(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === EXCLUSION_VIOLATION && constraint === NO_OVERLAP;
}

export class TimeEntriesService {
  readonly #deps: TimeEntriesServiceDeps;

  constructor(deps: TimeEntriesServiceDeps) {
    this.#deps = deps;
  }

  #view(entry: TimeEntryRecord): TimeEntryView {
    return {
      ...entry,
      durationSeconds: elapsedSeconds(entry.startedAt, entry.endedAt, this.#deps.clock.now()),
    };
  }

  async #assertTask(taskId: string): Promise<void> {
    if ((await new TaskRepository(this.#deps.db).find(taskId)) === undefined) throw notFound();
  }

  /** Entradas de una tarea, de la más reciente a la más antigua. */
  async list(taskId: string): Promise<TimeEntryView[]> {
    await this.#assertTask(taskId);
    const entries = await new TimeEntryRepository(this.#deps.db).listByTask(taskId);
    return entries.map((entry) => this.#view(entry));
  }

  /**
   * Anota tiempo a mano: inicio y fin, o inicio y duración. No puede terminar en el futuro (422) ni
   * pisar otra entrada ni el cronómetro en marcha (409). Las entradas contiguas no se pisan.
   */
  async addManual(taskId: string, input: CreateTimeEntryRequest): Promise<TimeEntryView> {
    await this.#assertTask(taskId);
    const startedAt = new Date(input.startedAt);
    const endedAt =
      input.endedAt === undefined
        ? // El esquema garantiza que hay fin o duración.
          new Date(startedAt.getTime() + (input.durationSeconds ?? 0) * 1000)
        : new Date(input.endedAt);
    if (endedAt.getTime() > this.#deps.clock.now().getTime()) {
      throw new AppError('UNPROCESSABLE', 422, 'La anotación no puede terminar en el futuro', [
        { path: 'endedAt', message: 'La anotación no puede terminar en el futuro' },
      ]);
    }
    try {
      return this.#view(
        await new TimeEntryRepository(this.#deps.db).insert(taskId, startedAt, endedAt),
      );
    } catch (error) {
      if (isOverlap(error)) {
        throw conflict('El intervalo se solapa con otra anotación o con el cronómetro en marcha');
      }
      throw error;
    }
  }

  /** Pone en marcha el cronómetro de la tarea. Solo puede haber uno en toda la aplicación. */
  async start(taskId: string): Promise<TimeEntryView> {
    await this.#assertTask(taskId);
    const entries = new TimeEntryRepository(this.#deps.db);
    const running = await entries.findRunning();
    if (running !== undefined) throw conflict('Ya hay un cronómetro en marcha');
    try {
      return this.#view(await entries.insert(taskId, this.#deps.clock.now(), null));
    } catch (error) {
      // Carrera con otro inicio (índice único), o inicio dentro de una entrada que acaba después (el
      // reloj del servidor retrocedió): en ambos casos, el estado actual lo impide.
      if (isUniqueViolation(error, ONE_RUNNING)) throw conflict('Ya hay un cronómetro en marcha');
      if (isOverlap(error)) {
        throw conflict('El cronómetro empezaría dentro de otra anotación de tiempo');
      }
      throw error;
    }
  }

  /** Para el cronómetro de la tarea. 409 si esa tarea no lo tiene en marcha. */
  async stop(taskId: string): Promise<TimeEntryView> {
    await this.#assertTask(taskId);
    const entries = new TimeEntryRepository(this.#deps.db);
    const running = await entries.findRunning();
    if (running === undefined) throw conflict('No hay ningún cronómetro en marcha');
    if (running.taskId !== taskId) {
      throw conflict('El cronómetro en marcha es de otra tarea');
    }
    const closed = await entries.close(
      running.id,
      stopInstant(running.startedAt, this.#deps.clock.now()),
    );
    // Otra parada se adelantó entre la lectura y la escritura.
    if (closed === undefined) throw conflict('No hay ningún cronómetro en marcha');
    return this.#view(closed);
  }

  /** Borra una entrada; si es el cronómetro en marcha, lo descarta. */
  async delete(entryId: string): Promise<void> {
    if (!(await new TimeEntryRepository(this.#deps.db).delete(entryId))) {
      throw new AppError('NOT_FOUND', 404, 'La entrada de tiempo no existe');
    }
  }
}
