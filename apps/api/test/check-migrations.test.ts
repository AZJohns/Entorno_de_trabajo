import { describe, expect, it } from 'vitest';
import { findForbiddenMigrationChanges } from '../scripts/check-migrations-immutable.ts';

describe('findForbiddenMigrationChanges', () => {
  it('permite solo migraciones añadidas', () => {
    const diff = [
      'A\tapps/api/src/db/migrations/0002_nueva.ts',
      'M\tapps/api/src/db/migrations/0001_spanish_text_search.ts',
      'D\tapps/api/src/db/migrations/0000_borrada.ts',
      '',
    ].join('\n');
    expect(findForbiddenMigrationChanges(diff)).toEqual([
      'M\tapps/api/src/db/migrations/0001_spanish_text_search.ts',
      'D\tapps/api/src/db/migrations/0000_borrada.ts',
    ]);
  });

  it('sin cambios no hay nada prohibido', () => {
    expect(findForbiddenMigrationChanges('')).toEqual([]);
  });
});
