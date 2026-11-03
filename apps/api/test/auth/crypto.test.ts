import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_ARGON2,
  RECOVERY_CODE_ARGON2,
  hashSecret,
  needsRehash,
  verifySecret,
} from '../../src/modules/auth/crypto/password-hash.ts';
import { open, seal } from '../../src/modules/auth/crypto/secret-box.ts';
import {
  csrfTokenFor,
  hashSessionToken,
  newSessionToken,
  safeEqual,
} from '../../src/modules/auth/crypto/tokens.ts';

describe('Argon2id (formato PHC)', () => {
  it('verifica la contraseña correcta y rechaza otra, sin modificarla', async () => {
    const hash = await hashSecret(' contraseña con espacios ', PASSWORD_ARGON2);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifySecret(' contraseña con espacios ', hash)).toBe(true);
    // Sin recortar (ASVS 6.2.8) ni cambiar mayúsculas.
    expect(await verifySecret('contraseña con espacios', hash)).toBe(false);
    expect(await verifySecret(' CONTRASEÑA CON ESPACIOS ', hash)).toBe(false);
  });

  it('usa una sal aleatoria distinta en cada hash', async () => {
    const [a, b] = await Promise.all([
      hashSecret('misma', RECOVERY_CODE_ARGON2),
      hashSecret('misma', RECOVERY_CODE_ARGON2),
    ]);
    expect(a).not.toBe(b);
  });

  it('detecta hashes con parámetros antiguos y rechaza formatos inválidos', async () => {
    const weak = await hashSecret('x', RECOVERY_CODE_ARGON2);
    expect(needsRehash(weak, PASSWORD_ARGON2)).toBe(true);
    expect(needsRehash(weak, RECOVERY_CODE_ARGON2)).toBe(false);
    expect(await verifySecret('x', '$2b$10$bcrypt-no-admitido')).toBe(false);
  });
});

describe('AES-256-GCM', () => {
  const key = randomBytes(32);

  it('descifra lo cifrado con nonce distinto cada vez', () => {
    const secret = randomBytes(20);
    const a = seal(key, secret);
    const b = seal(key, secret);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(open(key, a).equals(secret)).toBe(true);
  });

  it('detecta una modificación del texto cifrado o una clave incorrecta', () => {
    const sealed = seal(key, randomBytes(20));
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    expect(() => open(key, { ...sealed, ciphertext: tampered })).toThrow();
    expect(() => open(randomBytes(32), sealed)).toThrow();
  });
});

describe('tokens', () => {
  it('token de sesión de 256 bits; se guarda su SHA-256', () => {
    const token = newSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashSessionToken(token)).toHaveLength(32);
    expect(newSessionToken()).not.toBe(token);
  });

  it('el token CSRF depende del de sesión y es estable para la misma sesión', () => {
    const token = newSessionToken();
    expect(csrfTokenFor(token)).toBe(csrfTokenFor(token));
    expect(csrfTokenFor(newSessionToken())).not.toBe(csrfTokenFor(token));
  });

  it('comparación en tiempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
