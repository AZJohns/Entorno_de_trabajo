/**
 * Notas con etiquetas y búsqueda de texto completo (docs/plan.md §2.8, fase 5a).
 *
 * `notes`
 * - `body_md` ≤ 100 000 caracteres (CHECK). El plan decía 1 MiB, pero un `tsvector` no puede pasar de 1 MiB
 *   y la API rechaza cuerpos JSON de más de 100 kB, así que un tope mayor nunca se alcanzaría y, con
 *   texto muy denso, haría fallar la inserción con un error del índice en vez de un 400. Los dos topes se
 *   mantienen alineados con `MAX_NOTE_BODY` de `@backoffice/shared`.
 * - `search_vector` es una columna GENERADA y ALMACENADA: PostgreSQL la recalcula al insertar o editar, así
 *   que no puede quedar desfasada del título y el cuerpo (es un dato derivado, pero lo mantiene la propia
 *   base de datos, no la aplicación). Pondera el título (A) por encima del cuerpo (B). Usa `es_unaccent`
 *   (migración 0001: «presupuestos» y «presupuesto» dan el mismo lexema; «acción» y «accion», también).
 *   `to_tsvector(regconfig, text)` es IMMUTABLE, requisito de las columnas generadas.
 * - GIN sobre `search_vector` para `@@`, incluidas las búsquedas por prefijo (`término:*`).
 *
 * `tags`: únicas SIN distinguir mayúsculas mediante un índice único sobre `lower(name)` en lugar de `citext`:
 * no añade una extensión ni un tipo, la columna conserva la grafía con la que se creó («Presupuesto») y las
 * consultas comparan con `lower(name) = lower($1)`. Límite conocido: `lower()` depende de la configuración
 * regional de la base de datos; con una `C` no plegaría «Ñ» y «ñ» (con la de producción, UTF-8, sí).
 *
 * `note_tags` (N:M): clave primaria `(note_id, tag_id)` (una etiqueta no se repite en una nota) e índice
 * inverso `(tag_id, note_id)` para filtrar por etiqueta y contar. Borrar una nota o una etiqueta borra sus
 * enlaces (CASCADE): el enlace no tiene sentido sin sus dos extremos.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      body_md text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('es_unaccent', title), 'A') ||
        setweight(to_tsvector('es_unaccent', body_md), 'B')
      ) STORED,
      CONSTRAINT notes_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
      CONSTRAINT notes_title_not_blank CHECK (btrim(title) <> ''),
      CONSTRAINT notes_body_length CHECK (char_length(body_md) <= 100000)
    )
  `.execute(db);
  await sql`CREATE INDEX notes_search_vector_idx ON notes USING gin (search_vector)`.execute(db);
  // Orden de la lista sin búsqueda: más recientes primero; `id` desempata para que el cursor sea estable.
  await sql`CREATE INDEX notes_updated_at_idx ON notes (updated_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tags_name_length CHECK (char_length(name) BETWEEN 1 AND 40),
      CONSTRAINT tags_name_not_blank CHECK (btrim(name) <> '')
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX tags_name_lower_key ON tags (lower(name))`.execute(db);

  await sql`
    CREATE TABLE note_tags (
      note_id uuid NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      tag_id uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    )
  `.execute(db);
  await sql`CREATE INDEX note_tags_tag_id_idx ON note_tags (tag_id, note_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS note_tags`.execute(db);
  await sql`DROP TABLE IF EXISTS tags`.execute(db);
  await sql`DROP TABLE IF EXISTS notes`.execute(db);
}
