import { describe, expect, it } from 'vitest';
import { isReferencedRowError } from '../src/db/errors.ts';

describe('isReferencedRowError', () => {
  it.each(['23503', '23001'])('reconoce el código %s (según la versión de PostgreSQL)', (code) => {
    expect(isReferencedRowError({ code, constraint: 'movements_account_id_fkey' })).toBe(true);
  });

  it('con una restricción indicada, exige que sea esa', () => {
    const error = { code: '23001', constraint: 'movements_account_id_fkey' };
    expect(isReferencedRowError(error, 'movements_account_id_fkey')).toBe(true);
    expect(isReferencedRowError(error, 'transfers_to_account_id_fkey')).toBe(false);
  });

  it.each([
    { code: '23505', constraint: 'x' },
    { code: '23514' },
    { code: 23503 },
    {},
    null,
    undefined,
    'error',
    new Error('otro'),
  ])('rechaza %j', (error) => {
    expect(isReferencedRowError(error)).toBe(false);
  });
});
