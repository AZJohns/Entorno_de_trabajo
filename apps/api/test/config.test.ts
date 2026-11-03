import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.ts';

/** Variables mínimas válidas (valores ficticios). */
const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  PUBLIC_ORIGIN: 'http://localhost:5173',
  TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

function errorVariables(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.variables;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('aplica valores por defecto y convierte tipos', () => {
    expect(loadConfig(base)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      HOST: '127.0.0.1',
      TRUST_PROXY_HOPS: 0,
      TOTP_ENCRYPTION_KEY_VERSION: 1,
    });
  });

  it('HOST: por defecto 127.0.0.1 (no accesible desde la red local); acepta IP explícitas', () => {
    expect(loadConfig({ ...base, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
    expect(loadConfig({ ...base, HOST: '::1' }).HOST).toBe('::1');
    expect(errorVariables({ ...base, HOST: 'mi-servidor.example' })).toEqual(['HOST']);
  });

  it('TRUST_PROXY_HOPS: entero entre 0 y 5, desactivado (0) por defecto', () => {
    expect(loadConfig({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    expect(errorVariables({ ...base, TRUST_PROXY_HOPS: 'true' })).toEqual(['TRUST_PROXY_HOPS']);
    expect(errorVariables({ ...base, TRUST_PROXY_HOPS: '9' })).toEqual(['TRUST_PROXY_HOPS']);
  });

  it('PUBLIC_ORIGIN: solo un origen, y https en producción', () => {
    expect(errorVariables({ ...base, PUBLIC_ORIGIN: 'http://localhost:5173/app' })).toEqual([
      'PUBLIC_ORIGIN',
    ]);
    expect(errorVariables({ ...base, NODE_ENV: 'production' })).toEqual(['PUBLIC_ORIGIN']);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://backoffice.example' })
        .NODE_ENV,
    ).toBe('production');
  });

  it('TOTP_ENCRYPTION_KEY: exactamente 32 bytes en base64', () => {
    expect(
      errorVariables({ ...base, TOTP_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    ).toEqual(['TOTP_ENCRYPTION_KEY']);
    expect(errorVariables({ ...base, TOTP_ENCRYPTION_KEY: 'no es base64!' })).toEqual([
      'TOTP_ENCRYPTION_KEY',
    ]);
  });

  it('falla nombrando la variable, sin mostrar su valor', () => {
    let error: unknown;
    try {
      loadConfig({
        ...base,
        DATABASE_URL: 'mysql://usuario:contraseña-secreta@host/db',
        PORT: 'abc',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.variables).toEqual(expect.arrayContaining(['DATABASE_URL', 'PORT']));
    expect(configError.message).not.toContain('contraseña-secreta');
  });

  it('exige DATABASE_URL, PUBLIC_ORIGIN y TOTP_ENCRYPTION_KEY', () => {
    expect(errorVariables({})).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'PUBLIC_ORIGIN', 'TOTP_ENCRYPTION_KEY']),
    );
  });
});
