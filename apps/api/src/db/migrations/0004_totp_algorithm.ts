/**
 * Algoritmo HMAC de cada credencial TOTP (ASVS 11.4.1, pregunta 36 de docs/plan.md).
 *
 * Las filas existentes se calcularon con HMAC-SHA-1, así que quedan como `SHA1` y siguen
 * funcionando. Las altas nuevas usan `SHA256`, y el código tiene que indicarlo explícitamente: el
 * valor por defecto se quita justo después, para que un INSERT que olvide el algoritmo falle en vez de
 * guardar uno equivocado.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Con el DEFAULT, PostgreSQL rellena las filas existentes con 'SHA1' al añadir la columna.
  await sql`
    ALTER TABLE totp_authenticators
      ADD COLUMN algorithm text NOT NULL DEFAULT 'SHA1'
        CONSTRAINT totp_authenticators_algorithm_check CHECK (algorithm IN ('SHA1', 'SHA256'))
  `.execute(db);
  await sql`ALTER TABLE totp_authenticators ALTER COLUMN algorithm DROP DEFAULT`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Las credenciales SHA256 no se pueden convertir a SHA1: dejarían de funcionar al deshacer.
  await sql`ALTER TABLE totp_authenticators DROP COLUMN IF EXISTS algorithm`.execute(db);
}
