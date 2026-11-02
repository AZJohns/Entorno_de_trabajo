/**
 * Configuración de búsqueda de texto completo en español sin acentos (`es_unaccent`).
 *
 * Por qué ahora: la usará la búsqueda de notas (fase 5), pero es infraestructura de la base de
 * datos y sirve para comprobar desde la fase 0 que el ejecutor de migraciones funciona.
 *
 * `unaccent` es una extensión "trusted" desde PostgreSQL 13: la puede crear el propietario de la
 * base sin ser superusuario. Todo lo de esta migración existe desde PostgreSQL 13.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`.execute(db);
  // Copia de la configuración "spanish" con un filtro previo que elimina los acentos, de modo que
  // «acción» y «accion» producen el mismo lexema.
  await sql`CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = spanish)`.execute(db);
  await sql`
    ALTER TEXT SEARCH CONFIGURATION es_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, spanish_stem
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TEXT SEARCH CONFIGURATION IF EXISTS es_unaccent`.execute(db);
  await sql`DROP EXTENSION IF EXISTS unaccent`.execute(db);
}
