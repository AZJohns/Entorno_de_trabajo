/**
 * Acceso a la tabla `tasks`. Solo consultas: ninguna decisión de negocio.
 *
 * Recibe un `Kysely` o una transacción, como el resto de repositorios, para que el servicio agrupe las
 * operaciones que reordenan el tablero en una sola transacción.
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import type { TaskStatus } from '@backoffice/shared';
import type { Database, TasksTable } from '../../db/schema.ts';
import { emptyColumns, type Columns, type Placement } from './domain/ordering.ts';

export interface TaskRecord {
  readonly id: string;
  readonly title: string;
  readonly descriptionMd: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  /** Día del calendario (`YYYY-MM-DD`) o `null`. */
  readonly dueOn: string | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Valores de una tarea nueva. */
export interface NewTask {
  readonly title: string;
  readonly descriptionMd: string | null;
  readonly dueOn: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  readonly completedAt: Date | null;
}

/** Campos editables de una tarea (los que no se indican no cambian). */
export interface TaskChanges {
  readonly title?: string;
  readonly descriptionMd?: string | null;
  readonly dueOn?: string | null;
}

type TaskRow = Selectable<TasksTable>;

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    descriptionMd: row.description_md,
    status: row.status,
    position: row.position,
    dueOn: row.due_on,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TaskRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /**
   * Bloqueo consultivo del tablero, hasta el final de la transacción. Todo lo que cambia posiciones
   * (alta, borrado, movimiento) lo toma primero: así dos movimientos a la vez se ejecutan uno tras otro
   * y cada uno ve el orden que dejó el anterior. Sin él, ambos leerían la misma columna y escribirían
   * posiciones incompatibles (la restricción única diferible lo detectaría al confirmar, pero una de las
   * dos peticiones fallaría).
   */
  async lockBoard(): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('tasks.board', 0))`.execute(this.#db);
  }

  /** Tareas ordenadas por columna y posición; con `status`, solo las de esa columna. */
  async list(status?: TaskStatus): Promise<TaskRecord[]> {
    let query = this.#db.selectFrom('tasks').selectAll();
    if (status !== undefined) query = query.where('status', '=', status);
    const rows = await query.orderBy('status').orderBy('position').execute();
    return rows.map(toTask);
  }

  /** Orden actual de todo el tablero: los identificadores de cada columna. */
  async columns(): Promise<Columns> {
    const rows = await this.#db
      .selectFrom('tasks')
      .select(['id', 'status'])
      .orderBy('status')
      .orderBy('position')
      .execute();
    const columns = emptyColumns();
    for (const row of rows) columns[row.status].push(row.id);
    return columns;
  }

  async find(id: string): Promise<TaskRecord | undefined> {
    const row = await this.#db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toTask(row);
  }

  /** Cuántas tareas hay en la columna: la posición que ocupa una tarea nueva al final. */
  async countInColumn(status: TaskStatus): Promise<number> {
    const row = await this.#db
      .selectFrom('tasks')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('status', '=', status)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async insert(values: NewTask): Promise<TaskRecord> {
    const row = await this.#db
      .insertInto('tasks')
      .values({
        title: values.title,
        description_md: values.descriptionMd,
        due_on: values.dueOn,
        status: values.status,
        position: values.position,
        completed_at: values.completedAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toTask(row);
  }

  async update(id: string, changes: TaskChanges, now: Date): Promise<TaskRecord | undefined> {
    const row = await this.#db
      .updateTable('tasks')
      .set({
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.descriptionMd === undefined ? {} : { description_md: changes.descriptionMd }),
        ...(changes.dueOn === undefined ? {} : { due_on: changes.dueOn }),
        updated_at: now,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toTask(row);
  }

  /** @returns `false` si no existía. Sus entradas de tiempo se borran en cascada. */
  async delete(id: string): Promise<boolean> {
    const result = await this.#db.deleteFrom('tasks').where('id', '=', id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /**
   * Escribe de una vez las columnas y posiciones nuevas de varias tareas. Es una sola sentencia: las
   * posiciones intermedias pueden repetirse y la restricción única diferible solo se comprueba al
   * confirmar la transacción.
   *
   * `completed_at` se ajusta en la misma sentencia porque el CHECK `tasks_completed_matches_status` no es
   * diferible: al entrar en «Terminado» se marca `now`; al salir, se borra; si ya estaba en «Terminado» se
   * conserva. `updated_at` solo se toca si cambia la columna: renumerar a las vecinas no es editarlas.
   */
  async place(changes: readonly Placement[], now: Date): Promise<void> {
    if (changes.length === 0) return;
    const ids = changes.map((change) => change.id);
    const statuses = changes.map((change) => change.status);
    const positions = changes.map((change) => change.position);
    await sql`
      UPDATE tasks AS t
      SET status = v.status,
          position = v.position,
          completed_at = CASE WHEN v.status = 'done' THEN COALESCE(t.completed_at, ${now}::timestamptz) END,
          updated_at = CASE WHEN t.status <> v.status THEN ${now}::timestamptz ELSE t.updated_at END
      FROM unnest(${ids}::uuid[], ${statuses}::text[], ${positions}::integer[])
        AS v (id, status, position)
      WHERE t.id = v.id
    `.execute(this.#db);
  }
}
