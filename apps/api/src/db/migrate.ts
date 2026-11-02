/**
 * CLI: aplica las migraciones pendientes contra `DATABASE_URL`.
 *
 * Uso: `pnpm db:migrate` (lee `.env` de la raíz si existe).
 */
import { loadConfig } from '../config/env.ts';
import { createDatabase } from './database.ts';
import { migrateToLatest } from './migrator.ts';

const config = loadConfig(process.env);
const db = createDatabase(config.DATABASE_URL);
try {
  const { results = [] } = await migrateToLatest(db);
  for (const result of results) {
    console.log(`${result.status}: ${result.migrationName}`);
  }
  if (results.length === 0) console.log('Sin migraciones pendientes.');
} finally {
  await db.destroy();
}
