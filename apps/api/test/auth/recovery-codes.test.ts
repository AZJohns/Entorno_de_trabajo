import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_BYTES,
  formatRecoveryCode,
  normalizeRecoveryCode,
} from '../../src/modules/auth/domain/recovery-codes.ts';

describe('códigos de recuperación', () => {
  it('10 bytes (80 bits) → 16 caracteres de base32 de Crockford en grupos de 4', () => {
    const code = formatRecoveryCode(Buffer.alloc(RECOVERY_CODE_BYTES, 0xff));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(formatRecoveryCode(Buffer.alloc(RECOVERY_CODE_BYTES, 0))).toBe('0000-0000-0000-0000');
  });

  it('exige exactamente 10 bytes', () => {
    expect(() => formatRecoveryCode(Buffer.alloc(9))).toThrow(RangeError);
  });

  it('normaliza lo que escribe el usuario: mayúsculas, guiones, espacios y letras confundibles', () => {
    const code = formatRecoveryCode(Buffer.from('0123456789', 'ascii'));
    const canonical = normalizeRecoveryCode(code);
    expect(canonical).toHaveLength(16);
    expect(normalizeRecoveryCode(code.toLowerCase().replaceAll('-', ' '))).toBe(canonical);
    // Crockford: I y L se leen como 1; O como 0.
    expect(normalizeRecoveryCode('OOOO-IIII-LLLL-0000')).toBe('0000111111110000');
  });

  it('rechaza longitudes o caracteres no válidos', () => {
    expect(normalizeRecoveryCode('ABC')).toBeNull();
    expect(normalizeRecoveryCode('UUUU-UUUU-UUUU-UUUU')).toBeNull();
    expect(normalizeRecoveryCode('A'.repeat(200))).toBeNull();
  });
});
