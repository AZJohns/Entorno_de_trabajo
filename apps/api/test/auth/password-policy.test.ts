import { describe, expect, it } from 'vitest';
import {
  checkPasswordPolicy,
  originContextWords,
} from '../../src/modules/auth/domain/password-policy.ts';

const policy = {
  commonPasswords: new Set(['qwertyuiopasdfgh', '123456789012345']),
  contextWords: ['backoffice', 'Usuario'],
};

describe('política de contraseñas (NIST 800-63B-4, ASVS 6.2)', () => {
  it('acepta una contraseña larga sin reglas de composición (ASVS 6.2.5)', () => {
    expect(checkPasswordPolicy('caballo correcto pila grapa', policy)).toBeNull();
    expect(checkPasswordPolicy('solo minusculas y espacios', policy)).toBeNull();
  });

  it('exige 15 caracteres, contando puntos de código y no unidades UTF-16', () => {
    expect(checkPasswordPolicy('a'.repeat(14), policy)).toBe('too_short');
    expect(checkPasswordPolicy('a'.repeat(15), policy)).toBeNull();
    // 14 emojis = 28 unidades UTF-16, pero 14 caracteres.
    expect(checkPasswordPolicy('🔑'.repeat(14), policy)).toBe('too_short');
  });

  it('admite al menos 64 caracteres (ASVS 6.2.9) y como mucho 256', () => {
    expect(checkPasswordPolicy('x'.repeat(64), policy)).toBeNull();
    expect(checkPasswordPolicy('x'.repeat(256), policy)).toBeNull();
    expect(checkPasswordPolicy('x'.repeat(257), policy)).toBe('too_long');
  });

  it('rechaza las contraseñas comunes, sin distinguir mayúsculas (ASVS 6.2.4)', () => {
    expect(checkPasswordPolicy('QWERTYUIOPASDFGH', policy)).toBe('common');
  });

  it('rechaza las que contienen palabras del contexto (ASVS 6.2.11)', () => {
    expect(checkPasswordPolicy('mi-BACKOFFICE-seguro-2026', policy)).toBe('context_word');
    expect(checkPasswordPolicy('el usuario manda mucho', policy)).toBe('context_word');
  });

  it('el dominio del origen público aporta sus etiquetas como palabras del contexto (ASVS 6.1.2)', () => {
    expect(originContextWords('https://finanzas.ejemplo.test:8443')).toEqual([
      'finanzas',
      'ejemplo',
      'test',
    ]);
    const withDomain = {
      ...policy,
      contextWords: originContextWords('https://finanzas.ejemplo.test'),
    };
    expect(checkPasswordPolicy('mis FINANZAS personales 2026', withDomain)).toBe('context_word');
    expect(checkPasswordPolicy('una frase larga sin el dominio', withDomain)).toBeNull();
  });

  it('no modifica la contraseña: los espacios iniciales y finales cuentan (ASVS 6.2.8)', () => {
    expect(checkPasswordPolicy(' '.repeat(10) + 'abcde', policy)).toBeNull();
  });
});
