import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BreachCheckUnavailableError,
  createHibpChecker,
} from '../../src/modules/auth/infra/hibp.ts';

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex').toUpperCase();
}

/** `fetch` falso que registra la petición y devuelve la respuesta indicada. Nunca sale a la red. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return respond();
  }) as typeof fetch;
  return { fn, calls };
}

describe('HIBP: API de rangos (k-anonimato)', () => {
  const password = 'una contraseña filtrada cualquiera';
  const hash = sha1(password);

  it('solo envía los 5 primeros caracteres del SHA-1 y pide relleno', async () => {
    const { fn, calls } = fakeFetch(() => new Response('ABCDEF:3\n'));
    await createHibpChecker({ fetchFn: fn }).isBreached(password);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(calls[0]?.url).not.toContain(hash.slice(5));
    expect(new Headers(calls[0]?.init?.headers).get('Add-Padding')).toBe('true');
    expect(calls[0]?.init?.redirect).toBe('error');
  });

  it('detecta una contraseña filtrada', async () => {
    const { fn } = fakeFetch(() => new Response(`00000:1\r\n${hash.slice(5)}:42\r\n`));
    expect(await createHibpChecker({ fetchFn: fn }).isBreached(password)).toBe(true);
  });

  it('ignora las entradas de relleno (recuento 0)', async () => {
    const { fn } = fakeFetch(() => new Response(`${hash.slice(5)}:0\r\n`));
    expect(await createHibpChecker({ fetchFn: fn }).isBreached(password)).toBe(false);
  });

  it('falla cerrado si la API responde con error o no responde', async () => {
    const error = fakeFetch(() => new Response('', { status: 503 }));
    await expect(createHibpChecker({ fetchFn: error.fn }).isBreached(password)).rejects.toThrow(
      BreachCheckUnavailableError,
    );
    const network = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(createHibpChecker({ fetchFn: network.fn }).isBreached(password)).rejects.toThrow(
      BreachCheckUnavailableError,
    );
  });
});
