import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  timeStep,
  verifyTotp,
} from '../../src/modules/auth/domain/totp.ts';

// Semillas de los vectores de prueba oficiales de RFC 6238 (apéndice B): 20 bytes para SHA-1 y 32
// bytes para SHA-256 (el RFC repite la misma cadena hasta la longitud del hash).
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii');

describe('TOTP (RFC 6238)', () => {
  // Valores de 8 cifras del RFC; con 6 cifras se toman las 6 últimas.
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ])('vector oficial SHA-1: t=%i → %s', (seconds, expected) => {
    expect(hotp(RFC_SECRET, timeStep(new Date(seconds * 1000)), 'SHA1')).toBe(expected);
  });

  // Mismos instantes, apéndice B de RFC 6238, columna HMAC-SHA-256 (94287082 → 46119246, etc.).
  it.each([
    [59, '119246'],
    [1_111_111_109, '084774'],
    [1_111_111_111, '062674'],
    [1_234_567_890, '819424'],
    [2_000_000_000, '698825'],
    [20_000_000_000, '737706'],
  ])('vector oficial SHA-256: t=%i → %s', (seconds, expected) => {
    expect(hotp(RFC_SECRET_SHA256, timeStep(new Date(seconds * 1000)), 'SHA256')).toBe(expected);
  });

  const now = new Date(1_111_111_111 * 1000);
  const current = timeStep(now);

  it.each([
    ['SHA1', RFC_SECRET],
    ['SHA256', RFC_SECRET_SHA256],
  ] as const)('%s: acepta el código del paso actual y devuelve el paso', (algorithm, secret) => {
    expect(verifyTotp(secret, algorithm, hotp(secret, current, algorithm), now, null)).toEqual({
      ok: true,
      step: current,
    });
  });

  it('una credencial SHA-1 anterior a la migración sigue verificándose con SHA-1', () => {
    // Un código de los vectores oficiales de SHA-1 (t = 1111111111 → 050471) valida con SHA1...
    expect(verifyTotp(RFC_SECRET, 'SHA1', '050471', now, null)).toEqual({
      ok: true,
      step: current,
    });
    // ...y no con SHA256 (el algoritmo es el de la credencial, no el de las altas nuevas).
    expect(verifyTotp(RFC_SECRET, 'SHA256', '050471', now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rechaza un código calculado con el algoritmo equivocado, en los dos sentidos', () => {
    const seed = RFC_SECRET_SHA256;
    expect(hotp(seed, current, 'SHA1')).not.toBe(hotp(seed, current, 'SHA256'));
    expect(verifyTotp(seed, 'SHA256', hotp(seed, current, 'SHA1'), now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(verifyTotp(seed, 'SHA1', hotp(seed, current, 'SHA256'), now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('acepta el paso anterior (desfase de reloj) y rechaza dos pasos atrás y el siguiente', () => {
    const algorithm = 'SHA256';
    const code = (step: number) => hotp(RFC_SECRET_SHA256, step, algorithm);
    expect(verifyTotp(RFC_SECRET_SHA256, algorithm, code(current - 1), now, null)).toEqual({
      ok: true,
      step: current - 1,
    });
    expect(verifyTotp(RFC_SECRET_SHA256, algorithm, code(current - 2), now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(verifyTotp(RFC_SECRET_SHA256, algorithm, code(current + 1), now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rechaza reutilizar un código ya aceptado (un solo uso, ASVS 6.5.1)', () => {
    const algorithm = 'SHA256';
    const code = hotp(RFC_SECRET_SHA256, current, algorithm);
    expect(verifyTotp(RFC_SECRET_SHA256, algorithm, code, now, current)).toEqual({
      ok: false,
      reason: 'reused',
    });
    // Tampoco vale un código anterior al último usado.
    expect(
      verifyTotp(
        RFC_SECRET_SHA256,
        algorithm,
        hotp(RFC_SECRET_SHA256, current - 1, algorithm),
        now,
        current,
      ),
    ).toEqual({ ok: false, reason: 'reused' });
  });

  it('rechaza formatos no válidos', () => {
    expect(verifyTotp(RFC_SECRET, 'SHA1', '12345', now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(verifyTotp(RFC_SECRET, 'SHA1', 'abcdef', now, null)).toEqual({
      ok: false,
      reason: 'invalid',
    });
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
  it('codifica el emisor y la cuenta y declara el algoritmo SHA256 de las altas nuevas', () => {
    const uri = otpauthUri({
      secret: RFC_SECRET,
      algorithm: 'SHA256',
      issuer: 'Backoffice',
      account: 'yo mismo',
    });
    expect(uri).toBe(
      'otpauth://totp/Backoffice:yo%20mismo?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Backoffice&algorithm=SHA256&digits=6&period=30',
    );
  });

  it('declara SHA1 para una credencial SHA-1', () => {
    const uri = otpauthUri({
      secret: RFC_SECRET,
      algorithm: 'SHA1',
      issuer: 'Backoffice',
      account: 'yo',
    });
    expect(new URL(uri).searchParams.get('algorithm')).toBe('SHA1');
  });
});
