/**
 * Migración 0004 (algoritmo del TOTP): las credenciales existentes quedan en SHA1, la base de datos
 * solo admite SHA1 y SHA256 y el algoritmo hay que indicarlo siempre. PostgreSQL real.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigrator, migrateToLatest } from '../../src/db/migrator.ts';
import { DB_TIMEOUT_MS, createTestDatabase, type TestDatabase } from '../support/database.ts';

describe('migración 0004_totp_algorithm', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, DB_TIMEOUT_MS);

  afterAll(async () => {
    await database.drop();
  }, DB_TIMEOUT_MS);

  it('las filas anteriores quedan como SHA1 y la columna ya no tiene valor por defecto', async () => {
    const db = database.db;
    // Se vuelve al esquema anterior a la migración y se inserta una credencial «de entonces».
    const down = await createMigrator(db).migrateTo('0003_ledger');
    expect(down.error).toBeUndefined();
    const { rows: users } = await sql<{ id: string }>`
      INSERT INTO users (username, password_hash) VALUES ('usuario-de-prueba', 'hash-ficticio')
      RETURNING id
    `.execute(db);
    const userId = users[0]?.id;
    await sql`
      INSERT INTO totp_authenticators (user_id, secret_ciphertext, secret_nonce, key_version, confirmed_at)
      VALUES (${userId}, ${randomBytes(36)}, ${randomBytes(12)}, 1, now())
    `.execute(db);

    await migrateToLatest(db);
    const rows = await db.selectFrom('totp_authenticators').select('algorithm').execute();
    expect(rows).toEqual([{ algorithm: 'SHA1' }]);

    // Sin DEFAULT, un INSERT que olvide el algoritmo falla en vez de asumir uno.
    await expect(
      sql`
        INSERT INTO totp_authenticators (user_id, secret_ciphertext, secret_nonce, key_version)
        VALUES (${userId}, ${randomBytes(36)}, ${randomBytes(12)}, 1)
      `.execute(db),
    ).rejects.toThrow(/algorithm/);
  });

  it('el CHECK solo admite SHA1 y SHA256', async () => {
    const db = database.db;
    const { rows } = await sql<{ id: string }>`SELECT id FROM users LIMIT 1`.execute(db);
    const userId = rows[0]?.id;
    for (const algorithm of ['SHA512', 'sha256', '']) {
      await expect(
        sql`
          INSERT INTO totp_authenticators
            (user_id, secret_ciphertext, secret_nonce, key_version, algorithm)
          VALUES (${userId}, ${randomBytes(36)}, ${randomBytes(12)}, 1, ${algorithm})
        `.execute(db),
      ).rejects.toThrow(/totp_authenticators_algorithm_check/);
    }
    await sql`
      INSERT INTO totp_authenticators
        (user_id, secret_ciphertext, secret_nonce, key_version, algorithm)
      VALUES (${userId}, ${randomBytes(36)}, ${randomBytes(12)}, 1, 'SHA256')
    `.execute(db);
  });
});
