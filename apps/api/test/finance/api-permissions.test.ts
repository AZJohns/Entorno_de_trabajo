/**
 * Permisos de las rutas del libro (docs/plan.md §6.2): denegar por defecto. Se recorren TODAS las rutas
 * registradas y la lista se compara con las rutas reales del router, así que una ruta nueva sin
 * probar hace fallar este test.
 */
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.ts';
import { createFinanceModule } from '../../src/modules/finance/index.ts';
import { systemClock } from '../../src/lib/clock.ts';
import { useAuthTestContext } from '../support/auth.ts';
import { PASSWORD, USERNAME } from '../support/auth.ts';
import { expectProblem } from '../support/ledger.ts';

const getCtx = useAuthTestContext();

const ID = '00000000-0000-4000-8000-000000000000';
const BASE = '/api/v1';

/** Todas las rutas del libro: método y ruta con un UUID de relleno. */
const ROUTES: readonly (readonly [method: 'get' | 'post' | 'patch' | 'delete', path: string])[] = [
  ['get', '/accounts'],
  ['post', '/accounts'],
  ['get', `/accounts/${ID}`],
  ['patch', `/accounts/${ID}`],
  ['post', `/accounts/${ID}/archive`],
  ['get', `/accounts/${ID}/reconciliations`],
  ['post', `/accounts/${ID}/reconciliations`],
  ['delete', `/reconciliations/${ID}`],
  ['get', '/categories'],
  ['post', '/categories'],
  ['patch', `/categories/${ID}`],
  ['post', `/categories/${ID}/archive`],
  ['get', '/movements'],
  ['post', '/movements'],
  ['get', '/movements/pending/count'],
  ['get', `/movements/${ID}`],
  ['patch', `/movements/${ID}`],
  ['delete', `/movements/${ID}`],
  ['post', `/movements/${ID}/confirm`],
  ['get', '/transfers'],
  ['post', '/transfers'],
  ['get', `/transfers/${ID}`],
  ['patch', `/transfers/${ID}`],
  ['delete', `/transfers/${ID}`],
];

const MUTATING = ROUTES.filter(([method]) => method !== 'get');

/** Pasa a la forma «MÉTODO /ruta/:id» de las rutas registradas. */
const asPattern = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path.replaceAll(ID, ':id')}`;

describe('rutas del libro', () => {
  it('la lista de este test coincide con las rutas registradas en el router', () => {
    const { router } = createFinanceModule({
      db: createDatabase('postgres://nadie:nada@127.0.0.1:1/ninguna'),
      clock: systemClock,
    });
    const stack = (router as unknown as { stack: { route?: { path: string; methods: object } }[] })
      .stack;
    const registered = stack.flatMap((layer) =>
      layer.route === undefined
        ? []
        : Object.keys(layer.route.methods).map(
            (method) => `${method.toUpperCase()} ${layer.route?.path ?? ''}`,
          ),
    );
    expect(registered.sort()).toEqual(ROUTES.map(([m, p]) => asPattern(m, p)).sort());
  });

  it.each(ROUTES)('sin sesión: %s %s → 401', async (method, path) => {
    const client = getCtx().client();
    expectProblem(await client[method](`${BASE}${path}`), 401, 'UNAUTHENTICATED');
  });

  it.each(ROUTES)(
    'con la sesión a medias (falta el segundo factor): %s %s → 401',
    async (method, path) => {
      const client = getCtx().client();
      const login = await client.post(`${BASE}/auth/login`, {
        username: USERNAME,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
      expectProblem(await client[method](`${BASE}${path}`), 401, 'UNAUTHENTICATED');
    },
  );

  it.each(MUTATING)('sin token CSRF: %s %s → 403', async (method, path) => {
    const client = await getCtx().loggedIn();
    client.sendCsrf = false;
    expectProblem(await client[method](`${BASE}${path}`, {}), 403, 'CSRF_FAILED');
  });

  it.each(MUTATING)('desde otro origen: %s %s → 403', async (method, path) => {
    const client = await getCtx().loggedIn();
    client.origin = 'http://otra-web.invalid';
    expect((await client[method](`${BASE}${path}`, {})).status).toBe(403);
  });

  it('con la sesión bloqueada por inactividad no se accede a los datos', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    ctx.t.clock.advance(61 * 60 * 1000);
    expectProblem(await client.get(`${BASE}/accounts`), 401, 'SESSION_LOCKED');
  });
});
