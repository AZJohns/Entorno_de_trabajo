import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.ts';

describe('loadConfig', () => {
  it('aplica valores por defecto y convierte tipos', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(config).toMatchObject({ NODE_ENV: 'development', PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('falla nombrando la variable, sin mostrar su valor', () => {
    let error: unknown;
    try {
      loadConfig({ DATABASE_URL: 'mysql://usuario:contraseña-secreta@host/db', PORT: 'abc' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.variables).toEqual(expect.arrayContaining(['DATABASE_URL', 'PORT']));
    expect(configError.message).not.toContain('contraseña-secreta');
  });

  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });
});
