import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH } from '@backoffice/shared';
import { loadCommonPasswords } from '../../src/modules/auth/infra/common-passwords.ts';

describe('lista local de contraseñas comunes (ASVS 6.2.4)', () => {
  const list = loadCommonPasswords();

  it('tiene 3.000 contraseñas, todas de 15 o más caracteres', () => {
    expect(list.size).toBe(3000);
    for (const password of list)
      expect([...password].length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
  });

  it('no contiene entradas con «@» (repositorio público: nada derivado de un correo)', () => {
    expect([...list].filter((password) => password.includes('@'))).toEqual([]);
  });
});
