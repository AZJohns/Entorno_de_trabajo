/**
 * Lotes de importación (docs/plan.md §2.5, fase 3b.1): cada subida del Excel del plan crea un lote con la
 * vista previa (lo extraído y los problemas) hasta que se confirma, se descarta o caduca.
 *
 * - **No se guarda el archivo** [RESUELTO]: solo su tamaño y su SHA-256 (auditoría). Las entradas ya
 *   quedan en `extracted` y, al confirmar (fase 3b.1, PR 2), en las tablas del plan.
 * - `content_hash` es el SHA-256 de la serialización canónica de las entradas (no del archivo): sirve para
 *   la idempotencia, porque Excel cambia metadatos al guardar aunque los datos no cambien. Es NULL en los
 *   lotes `failed` (no hay entradas que resumir).
 * - `extracted` solo existe mientras dura la vista previa: se vacía al confirmar, descartar o caducar. Un
 *   `CHECK` impide un lote `preview` sin entradas, y otro, uno `confirmed` con `confirmed_at` vacío.
 * - `month` es el primer día del mes (`EXTRACT(DAY …) = 1`, no `date_trunc`: ver `account_reconciliations`).
 * - `UNIQUE (kind, month, content_hash) WHERE status = 'confirmed'`: el mismo contenido no se confirma dos
 *   veces en el mismo mes. El índice `(status, expires_at)` es para el trabajo de caducidad (PR 2).
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE import_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('plan_excel')),
      month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
      file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
      file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0),
      file_sha256 bytea NOT NULL CHECK (octet_length(file_sha256) = 32),
      content_hash bytea CHECK (content_hash IS NULL OR octet_length(content_hash) = 32),
      template_version smallint,
      status text NOT NULL CHECK (status IN ('preview', 'confirmed', 'discarded', 'failed', 'expired')),
      extracted jsonb,
      issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
      decisions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(decisions) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      confirmed_at timestamptz,
      CONSTRAINT import_batches_preview_has_content CHECK (
        status <> 'preview' OR (extracted IS NOT NULL AND content_hash IS NOT NULL)
      ),
      CONSTRAINT import_batches_confirmed_at CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
      CONSTRAINT import_batches_expires_after_creation CHECK (expires_at > created_at)
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX import_batches_confirmed_content_key
      ON import_batches (kind, month, content_hash) WHERE status = 'confirmed'
  `.execute(db);
  await sql`CREATE INDEX import_batches_status_expires_idx ON import_batches (status, expires_at)`.execute(
    db,
  );
  await sql`CREATE INDEX import_batches_month_idx ON import_batches (month, created_at DESC)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS import_batches`.execute(db);
}
