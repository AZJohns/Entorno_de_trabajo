/**
 * Recordatorios de tareas y notificaciones dentro de la app (docs/plan.md §2.6 y §2.7, fase 4c).
 *
 * `task_reminders`
 * - `remind_at` es un `timestamptz`: el instante exacto del aviso. La hora local de Madrid que escribe el
 *   usuario se convierte en la API (`tasks/domain/local-time.ts`), no aquí ni en el navegador.
 * - `sent_at IS NULL` significa «pendiente». El planificador lo rellena en la MISMA transacción que crea la
 *   notificación, así que no existe un estado «reclamado pero no entregado»: si el proceso muere a mitad,
 *   la transacción se deshace y el aviso sigue pendiente.
 * - `UNIQUE (task_id, remind_at)`: dos avisos idénticos de la misma tarea serían dos notificaciones
 *   iguales; un doble clic no debe producirlas.
 * - `attempts` y `last_error` son solo diagnóstico de los fallos del planificador; no hay tope de
 *   intentos (un aviso nunca se abandona).
 * - El índice parcial `(remind_at) WHERE sent_at IS NULL` es el que recorre el planificador cada minuto.
 *
 * `notifications` (canal «dentro de la app»; el push de la fase 2 se añade sin tocar esta tabla)
 * - `reference_id` apunta al origen (p. ej. el recordatorio) pero SIN clave ajena: el origen es de otro
 *   módulo y la notificación debe sobrevivir al borrado de la tarea.
 * - Índice único `(kind, reference_id)`: segunda barrera de «una sola vez». Aunque dos procesos
 *   reclamaran el mismo aviso, solo una notificación puede existir por origen.
 * - `kind` se valida por formato y no con una lista cerrada: cada fase nueva añadiría un tipo y
 *   obligaría a una migración solo para ampliar un CHECK.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE task_reminders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      remind_at timestamptz NOT NULL,
      sent_at timestamptz,
      attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error text CHECK (char_length(last_error) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT task_reminders_task_remind_at_key UNIQUE (task_id, remind_at)
    )
  `.execute(db);
  await sql`
    CREATE INDEX task_reminders_pending_idx ON task_reminders (remind_at) WHERE sent_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{0,39}$'),
      reference_id uuid,
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX notifications_kind_reference_key
      ON notifications (kind, reference_id) WHERE reference_id IS NOT NULL
  `.execute(db);
  await sql`CREATE INDEX notifications_created_at_idx ON notifications (created_at DESC, id)`.execute(
    db,
  );
  // Para el contador de la campana: solo recorre las no leídas.
  await sql`CREATE INDEX notifications_unread_idx ON notifications (id) WHERE read_at IS NULL`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS notifications`.execute(db);
  await sql`DROP TABLE IF EXISTS task_reminders`.execute(db);
}
