import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  timeStep,
  verifyTotp,
} from '../../src/modules/auth/domain/totp.ts';

// Semilla de los vectores de prueba oficiales de RFC 6238 (apéndice B), variante SHA-1.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP (RFC 6238)', () => {
  // Valores de 8 cifras del RFC; con 6 cifras se toman las 6 últimas.
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ])('vector oficial: t=%i → %s', (seconds, expected) => {
    expect(hotp(RFC_SECRET, timeStep(new Date(seconds * 1000)))).toBe(expected);
  });

  const now = new Date(1_111_111_111 * 1000);
  const current = timeStep(now);

  it('acepta el código del paso actual y devuelve el paso', () => {
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current), now, null)).toEqual({
      ok: true,
      step: current,
    });
  });

  it('acepta el paso anterior (desfase de reloj) y rechaza dos pasos atrás y el siguiente', () => {
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current - 1), now, null)).toEqual({
      ok: true,
      step: current - 1,
    });
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current - 2), now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current + 1), now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rechaza reutilizar un código ya aceptado (un solo uso, ASVS 6.5.1)', () => {
    const code = hotp(RFC_SECRET, current);
    expect(verifyTotp(RFC_SECRET, code, now, current)).toEqual({ ok: false, reason: 'reused' });
    // Tampoco vale un código anterior al último usado.
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, current - 1), now, current)).toEqual({
      ok: false,
      reason: 'reused',
    });
  });

  it('rechaza formatos no válidos', () => {
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('base32 (RFC 4648)', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('"%s" ↔ "%s" (sin relleno)', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });

  it('rechaza caracteres fuera del alfabeto', () => {
    expect(() => base32Decode('MZ1W')).toThrow();
  });
});

describe('otpauthUri', () => {
  it('codifica el emisor y la cuenta y declara los parámetros por defecto', () => {
    const uri = otpauthUri({ secret: RFC_SECRET, issuer: 'Backoffice', account: 'yo mismo' });
    expect(uri).toBe(
      'otpauth://totp/Backoffice:yo%20mismo?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Backoffice&algorithm=SHA1&digits=6&period=30',
    );
  });
});
