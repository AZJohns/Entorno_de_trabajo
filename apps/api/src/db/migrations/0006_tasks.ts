/**
 * Tareas y tiempo dedicado (docs/plan.md §2.6, fase 4a). Los recordatorios (`task_reminders`) llegan en
 * la fase 4c con su propia migración.
 *
 * `tasks`
 * - `due_on` es un `date`, no un `timestamptz`: la fecha límite es un día del calendario («para el
 *   viernes»), sin hora ni zona. Un instante se movería de día al cambiar la zona o el horario de verano;
 *   un `date` no. El instante exacto en que avisar es cosa del recordatorio (`timestamptz`, 4c).
 * - Orden: `position` son enteros consecutivos 0..n-1 dentro de cada columna. La restricción única
 *   `(status, position)` es DIFERIBLE (INITIALLY DEFERRED): al mover una tarea se renumeran varias filas
 *   en una transacción y la unicidad se comprueba al confirmarla, no fila a fila. Sin ello, un
 *   `UPDATE … SET position = position + 1` choca consigo mismo según el orden en que PostgreSQL visite
 *   las filas. Que sean *consecutivas* no lo impone la base de datos (solo que no se repitan): lo mantiene
 *   el servicio bajo un bloqueo y lo comprueban los tests.
 * - `completed_at` existe si y solo si la tarea está en «Terminado» (CHECK).
 *
 * `task_time_entries` (tiempo dedicado)
 * - Cada entrada es un intervalo `[started_at, ended_at)`; `ended_at IS NULL` es el cronómetro en marcha.
 *   El cronómetro y la anotación manual se guardan igual. El total NO se guarda: se calcula al leer.
 * - Un único cronómetro en marcha en toda la aplicación: índice único parcial sobre una constante.
 * - Sin solapes entre ninguna pareja de entradas, de cualquier tarea: restricción de exclusión sobre el
 *   rango. Una persona no dedica el mismo minuto a dos tareas y así el total no cuenta tiempo dos veces.
 *   Un cronómetro en marcha es un rango sin fin, así que también impide anotar tiempo posterior a su inicio.
 *   `[)` hace que dos entradas contiguas (el fin de una es el inicio de la otra) no se consideren solape.
 *   `&&` sobre rangos lo resuelve GiST sin la extensión `btree_gist`.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      description_md text CHECK (char_length(description_md) <= 10000),
      status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'testing', 'done')),
      position integer NOT NULL CHECK (position >= 0),
      due_on date,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tasks_completed_matches_status CHECK ((status = 'done') = (completed_at IS NOT NULL)),
      CONSTRAINT tasks_status_position_key UNIQUE (status, position) DEFERRABLE INITIALLY DEFERRED
    )
  `.execute(db);
  // Tareas con fecha límite aún abiertas (las que pueden estar vencidas).
  await sql`CREATE INDEX tasks_open_due_on_idx ON tasks (due_on) WHERE status <> 'done'`.execute(
    db,
  );

  await sql`
    CREATE TABLE task_time_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      started_at timestamptz NOT NULL,
      -- NULL mientras el cronómetro está en marcha.
      ended_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT task_time_entries_interval_check CHECK (ended_at IS NULL OR ended_at > started_at),
      CONSTRAINT task_time_entries_no_overlap
        EXCLUDE USING gist (tstzrange(started_at, ended_at, '[)') WITH &&)
    )
  `.execute(db);
  await sql`CREATE INDEX task_time_entries_task_id_idx ON task_time_entries (task_id)`.execute(db);
  await sql`
    CREATE UNIQUE INDEX task_time_entries_one_running_idx
      ON task_time_entries ((true)) WHERE ended_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS task_time_entries`.execute(db);
  await sql`DROP TABLE IF EXISTS tasks`.execute(db);
}
