// @vitest-environment jsdom
/**
 * Pantalla de la importación del Excel con la API simulada: subida, vista previa, decisiones de categoría,
 * confirmación (201 frente a 200) y los errores de la API. Todo inventado: ningún archivo ni dato real.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../src/api/client.ts';
import { ImportPreviewPage } from '../src/imports/ImportPreviewPage.tsx';
import { ImportUploadPage } from '../src/imports/ImportUploadPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCsrfToken(null);
  delete (window as unknown as Record<string, unknown>)['__pwned'];
});

const ID = '11111111-1111-4111-8111-111111111111';
const FOOD = '33333333-3333-4333-8333-333333333333';
const FUN = '44444444-4444-4444-8444-444444444444';
const SALARY = '55555555-5555-4555-8555-555555555555';
const ARCHIVED = '66666666-6666-4666-8666-666666666666';

/** Texto que sería peligroso si se interpretara como HTML. */
const EVIL = '<img src=x onerror="window.__pwned=true">';

const categories = {
  items: [
    { id: FOOD, name: 'Comida', kind: 'expense', archived: false },
    { id: FUN, name: 'Ocio', kind: 'expense', archived: false },
    { id: SALARY, name: 'Nómina', kind: 'income', archived: false },
    { id: ARCHIVED, name: 'Viajes antiguos', kind: 'expense', archived: true },
  ],
};

interface DetailOptions {
  status?: string;
  errors?: number;
  canConfirm?: boolean;
  issues?: unknown[];
  fileName?: string;
  concept?: string;
  categoryLabel?: string;
  categoryId?: string | null;
}

function detail(options: DetailOptions = {}) {
  const errors = options.errors ?? 0;
  return {
    id: ID,
    status: options.status ?? 'preview',
    month: '2026-10',
    fileName: options.fileName ?? 'plan-ficticio.xlsx',
    fileSizeBytes: 20_480,
    templateVersion: 2,
    issues: options.issues ?? [],
    summary: {
      items: 3,
      budgetLines: 2,
      events: 1,
      goals: 1,
      scenarios: 0,
      errors,
      warnings: 0,
      infos: 0,
      canConfirm: options.canConfirm ?? errors === 0,
    },
    extracted:
      options.status === 'expired'
        ? null
        : {
            items: [
              {
                sourceRow: 6,
                recordType: null,
                groupLabel: 'Hogar',
                concept: 'Compra semanal',
                unit: null,
                amountCents: 12_345,
                quantityHundredths: null,
                nature: null,
                status: null,
                sourceNote: null,
                note: null,
              },
            ],
            budgetLines: [
              {
                sourceRow: 8,
                categoryLabel: options.categoryLabel ?? 'Supermercado',
                categoryKey: 'supermercado',
                categoryId: options.categoryId === undefined ? null : options.categoryId,
                concept: options.concept ?? 'Compra semanal',
                costType: null,
                essential: null,
                itemRow: 6,
                statusItemRow: 6,
              },
            ],
            events: [],
            goals: [],
            scenarios: [],
          },
    decisions: { categoryMappings: {} },
    createdAt: '2026-10-15T10:00:00.000Z',
    expiresAt: '2026-10-16T10:00:00.000Z',
    confirmedAt: options.status === 'confirmed' ? '2026-10-15T10:05:00.000Z' : null,
  };
}

const problem = (status: number, code: string, detailText: string, errors?: unknown[]) => ({
  type: 'about:blank',
  title: detailText,
  status,
  detail: detailText,
  code,
  ...(errors === undefined ? {} : { errors }),
});

interface Reply {
  status: number;
  body?: unknown;
}
type Handler = (method: string, path: string, init: RequestInit | undefined) => Reply | undefined;

function stubApi(handler: Handler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const reply =
      handler(method, path, init) ??
      (path.startsWith('/categories') ? { status: 200, body: categories } : undefined);
    if (reply === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      reply.body === undefined
        ? new Response(null, { status: reply.status })
        : new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: {
              'Content-Type': reply.status >= 400 ? 'application/problem+json' : 'application/json',
            },
          }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/importar" element={<ImportUploadPage />} />
          <Route path="/importar/:id" element={<ImportPreviewPage />} />
          <Route path="/presupuesto" element={<p>Pantalla de presupuesto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const confirmButton = () =>
  screen.queryByRole('button', { name: /Confirmar importación|Confirmando/u });

describe('subida', () => {
  const xlsx = (name = 'plan.xlsx', size = 2_000) =>
    new File([new Uint8Array(size)], name, { type: '' });

  it('más de 5 MB se avisa antes de subir y no se envía nada', async () => {
    const fetchMock = stubApi(() => undefined);
    renderApp('/importar');
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/Archivo de Excel/u),
      xlsx('grande.xlsx', 5 * 1024 * 1024 + 1),
    );

    expect((await screen.findByRole('alert')).textContent).toContain('el máximo es 5 MB');
    const submit = screen.getByRole('button', { name: 'Subir y ver la vista previa' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('otra extensión se avisa antes de subir y recomienda .xlsx', async () => {
    const fetchMock = stubApi(() => undefined);
    renderApp('/importar');
    // applyAccept: false imita elegir «Todos los archivos» en el diálogo del sistema.
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText(/Archivo de Excel/u), xlsx('datos.csv'));

    expect((await screen.findByRole('alert')).textContent).toContain('recomendado: .xlsx');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Subir y ver la vista previa' })
        .disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un .xlsm avisa («se recomienda .xlsx») pero se puede subir', async () => {
    stubApi(() => undefined);
    renderApp('/importar');
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Archivo de Excel/u), xlsx('plan.xlsm'));
    expect((await screen.findByRole('status')).textContent).toContain('Se recomienda .xlsx');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Subir y ver la vista previa' })
        .disabled,
    ).toBe(false);
  });

  it('envía el archivo en binario con el mes, el tipo por extensión y el token CSRF, y abre la vista previa (201)', async () => {
    setCsrfToken('token-de-prueba');
    const fetchMock = stubApi((method, path) => {
      if (method === 'POST' && path.startsWith('/imports/plan-excel')) {
        const { id, status, issues, summary } = detail();
        return { status: 201, body: { id, status, issues, summary } };
      }
      if (method === 'GET' && path === `/imports/${ID}`) return { status: 200, body: detail() };
      return undefined;
    });
    renderApp('/importar');
    const user = userEvent.setup();
    const month = screen.getByLabelText<HTMLSelectElement>('Mes del plan').value;
    const file = xlsx('plan de prueba.xlsx');
    await user.upload(screen.getByLabelText(/Archivo de Excel/u), file);
    await user.click(screen.getByRole('button', { name: 'Subir y ver la vista previa' }));

    expect(
      await screen.findByRole('heading', { name: /Importación de octubre de 2026/u }),
    ).toBeTruthy();
    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    const [url, init] = post as [string, RequestInit];
    const query = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/api/v1/imports/plan-excel?')).toBe(true);
    expect(query.get('month')).toBe(month);
    expect(query.get('fileName')).toBe('plan de prueba.xlsx');
    expect(init.body).toBe(file);
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(headers['X-CSRF-Token']).toBe('token-de-prueba');
  });

  it('200: ese contenido ya es el plan vigente, se dice y no se abre ninguna vista previa', async () => {
    stubApi((method, path) => {
      if (method === 'POST' && path.startsWith('/imports/plan-excel')) {
        const { id, issues, summary } = detail({ status: 'confirmed' });
        return { status: 200, body: { id, status: 'confirmed', issues, summary } };
      }
      return undefined;
    });
    renderApp('/importar');
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Archivo de Excel/u), xlsx());
    await user.click(screen.getByRole('button', { name: 'Subir y ver la vista previa' }));

    expect((await screen.findByRole('status')).textContent).toContain('ya es el plan vigente');
    expect(screen.getByRole('status').textContent).toContain('no se ha creado nada');
    expect(screen.getByRole('heading', { name: 'Importar el plan desde Excel' })).toBeTruthy();
  });

  it.each([
    [413, 'PAYLOAD_TOO_LARGE', 'El archivo es demasiado grande'],
    [415, 'UNSUPPORTED_MEDIA_TYPE', 'No es un libro de Excel'],
    [422, 'UNPROCESSABLE', 'El archivo contiene macros'],
    [400, 'VALIDATION_ERROR', 'La petición no es válida'],
  ])('la API responde %i: mensaje en español anunciado', async (status, code, title) => {
    stubApi((method, path) =>
      method === 'POST' && path.startsWith('/imports/plan-excel')
        ? {
            status,
            body: problem(
              status,
              code,
              'detalle de la API',
              status === 422 ? [{ path: 'FILE_HAS_MACROS', message: 'macros' }] : undefined,
            ),
          }
        : undefined,
    );
    renderApp('/importar');
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Archivo de Excel/u), xlsx());
    await user.click(screen.getByRole('button', { name: 'Subir y ver la vista previa' }));
    expect((await screen.findByRole('alert')).textContent).toContain(title);
  });
});

describe('seguridad: el texto del Excel se muestra literal', () => {
  it('un <img onerror> en el nombre del archivo, la hoja, la celda, el concepto y la categoría no se ejecuta', async () => {
    stubApi((_method, path) =>
      path === `/imports/${ID}`
        ? {
            status: 200,
            body: detail({
              fileName: EVIL,
              concept: EVIL,
              categoryLabel: EVIL,
              errors: 1,
              issues: [
                {
                  code: 'CELL_TYPE',
                  severity: 'error',
                  sheet: EVIL,
                  cell: 'C7',
                  message: `Texto: ${EVIL}`,
                  expected: EVIL,
                  found: EVIL,
                },
                {
                  code: 'EXPENSE_NOT_BUDGETED',
                  severity: 'warning',
                  sheet: null,
                  cell: null,
                  message: EVIL,
                },
              ],
            }),
          }
        : undefined,
    );
    const { container } = renderApp(`/importar/${ID}`);
    await screen.findByRole('heading', { name: /Importación de octubre de 2026/u });

    // Se ve como texto…
    expect(screen.getAllByText(EVIL, { exact: false }).length).toBeGreaterThan(3);
    // …y no se ha creado ningún elemento, ni se ha ejecutado el manejador.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });
});

describe('vista previa', () => {
  it('con errores sin resolver, confirmar está desactivado y se explica por qué', async () => {
    stubApi((_method, path) =>
      path === `/imports/${ID}`
        ? {
            status: 200,
            body: detail({
              errors: 1,
              issues: [
                {
                  code: 'CATEGORY_UNMAPPED',
                  severity: 'error',
                  sheet: 'Presupuesto',
                  cell: 'B8',
                  message: 'La categoría no tiene correspondencia',
                },
              ],
            }),
          }
        : undefined,
    );
    renderApp(`/importar/${ID}`);
    const button = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Confirmar importación',
    });
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Hay 1 error sin resolver: no se puede confirmar.')).toBeTruthy();
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    // Los errores aparecen agrupados bajo su severidad y su hoja.
    const errors = screen.getByRole('region', { name: 'Errores (1)' });
    expect(within(errors).getByRole('heading', { name: 'Presupuesto' })).toBeTruthy();
    expect(within(errors).getByText('La categoría no tiene correspondencia')).toBeTruthy();
  });

  it('sin errores, confirmar está activo; el importe sale de céntimos', async () => {
    stubApi((_method, path) =>
      path === `/imports/${ID}` ? { status: 200, body: detail() } : undefined,
    );
    renderApp(`/importar/${ID}`);
    const button = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Confirmar importación',
    });
    expect(button.disabled).toBe(false);
    expect(screen.getByText(/123,45/u)).toBeTruthy();
  });

  it('las categorías ofrecen solo las de gasto no archivadas y cada cambio envía PATCH y refresca', async () => {
    let current = detail({ errors: 1, canConfirm: false });
    const fetchMock = stubApi((method, path, init) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: current };
      if (path === `/imports/${ID}/decisions` && method === 'PATCH') {
        expect(JSON.parse(init?.body as string)).toEqual({
          categoryMappings: [{ categoryKey: 'supermercado', categoryId: FOOD }],
        });
        current = detail({ categoryId: FOOD });
        return { status: 200, body: current };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: 'Supermercado' });
    await waitFor(() => {
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
    });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Sin elegir', 'Comida', 'Ocio']);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Confirmar importación' }).disabled,
    ).toBe(true);

    await user.selectOptions(select, FOOD);

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Confirmar importación' }).disabled,
      ).toBe(false);
    });
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Supermercado' }).value).toBe(
      FOOD,
    );
    expect(screen.getByText('No hay errores: se puede confirmar.')).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toHaveLength(1);
  });

  it('una decisión que la API rechaza (422) se explica', async () => {
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET')
        return { status: 200, body: detail({ errors: 1, canConfirm: false }) };
      if (method === 'PATCH') {
        return {
          status: 422,
          body: problem(422, 'UNPROCESSABLE', 'La categoría «Ocio» está archivada', [
            {
              path: 'categoryMappings.0.categoryId',
              message: 'La categoría «Ocio» está archivada',
            },
          ]),
        };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: 'Supermercado' });
    await waitFor(() => {
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(select, FUN);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Esa decisión no es coherente');
    expect(alert.textContent).toContain('«Ocio» está archivada');
  });

  it('descartar pide confirmación y vuelve a la subida', async () => {
    const fetchMock = stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: detail() };
      if (path === `/imports/${ID}` && method === 'DELETE') return { status: 204 };
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Descartar' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Importar el plan desde Excel' }),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});

describe('confirmar: 201 frente a 200', () => {
  it('201: muestra lo creado, actualizado, borrado y omitido, y ya no ofrece confirmar', async () => {
    let batch = detail();
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: batch };
      if (path === `/imports/${ID}/confirm` && method === 'POST') {
        batch = detail({ status: 'confirmed' });
        return {
          status: 201,
          body: { snapshotId: SALARY, budgets: { created: 4, updated: 2, deleted: 1, omitted: 3 } },
        };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar importación' }));

    const result = await screen.findByRole('region', { name: 'Resultado de la importación' });
    expect(within(result).getByRole('status').textContent).toContain('Importación confirmada');
    const counts = [...result.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(counts).toEqual([
      ['Presupuestos creados', '4'],
      ['Presupuestos actualizados', '2'],
      ['Presupuestos borrados', '1'],
      ['Categorías sin presupuesto (suman 0)', '3'],
    ]);
    expect(confirmButton()).toBeNull();
    expect(within(result).getByRole('link', { name: 'Ver presupuesto' })).toBeTruthy();
  });

  it('200 con el lote ya confirmado: «ya estaba confirmada», sin recuentos ni botón', async () => {
    let batch = detail();
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: batch };
      if (path === `/imports/${ID}/confirm` && method === 'POST') {
        batch = detail({ status: 'confirmed' });
        return { status: 200, body: { snapshotId: SALARY, budgets: null } };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar importación' }));

    const result = await screen.findByRole('region', { name: 'Resultado de la importación' });
    expect(result.textContent).toContain('ya estaba confirmada');
    expect(result.querySelector('dl')).toBeNull();
    expect(confirmButton()).toBeNull();
  });

  it('200 con el lote en vista previa (mismo contenido que el plan vigente): «no había cambios», sin confirmar, con descartar y volver', async () => {
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: detail() };
      if (path === `/imports/${ID}/confirm` && method === 'POST') {
        return { status: 200, body: { snapshotId: SALARY, budgets: null } };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar importación' }));

    const notice = await screen.findByText(/No había cambios/u);
    expect(notice.textContent).toContain('No se ha creado nada');
    expect(confirmButton()).toBeNull();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Volver' })).toBeTruthy();
  });

  it.each([
    ['IMPORT_NOT_PREVIEW', 'Esta importación ya no está en vista previa'],
    ['IMPORT_EXPIRED', 'La vista previa caducó'],
    ['IMPORT_HAS_ERRORS', 'Quedan errores sin resolver'],
    ['CONTENT_ALREADY_IMPORTED', 'Este contenido ya se importó antes'],
    ['BUDGET_MANUAL_EXISTS', 'Hay presupuestos creados a mano que chocan'],
  ])('409 %s: su propio mensaje', async (reason, title) => {
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: detail() };
      if (path === `/imports/${ID}/confirm` && method === 'POST') {
        return {
          status: 409,
          body: problem(409, 'CONFLICT', 'detalle de la API', [
            { path: reason, message: `Detalle de ${reason}: «Comida»` },
          ]),
        };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar importación' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(title);
  });

  it('409 BUDGET_MANUAL_EXISTS: lista las categorías que chocan', async () => {
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: detail() };
      if (path === `/imports/${ID}/confirm`) {
        return {
          status: 409,
          body: problem(409, 'CONFLICT', 'Hay categorías con un presupuesto creado a mano', [
            {
              path: 'BUDGET_MANUAL_EXISTS',
              message: 'Ya hay un presupuesto creado a mano de «Comida» en 2026-10',
            },
            {
              path: 'BUDGET_MANUAL_EXISTS',
              message: 'Ya hay un presupuesto creado a mano de «Ocio» en 2026-10',
            },
          ]),
        };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar importación' }));
    const alert = await screen.findByRole('alert');
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Ya hay un presupuesto creado a mano de «Comida» en 2026-10',
      'Ya hay un presupuesto creado a mano de «Ocio» en 2026-10',
    ]);
    expect(alert.textContent).toContain('Los presupuestos manuales no se tocan');
  });

  it('409 IMPORT_EXPIRED ofrece volver a subir', async () => {
    stubApi((method, path) => {
      if (path === `/imports/${ID}` && method === 'GET') return { status: 200, body: detail() };
      if (path === `/imports/${ID}/confirm`) {
        return {
          status: 409,
          body: problem(409, 'CONFLICT', 'caducó', [{ path: 'IMPORT_EXPIRED', message: 'caducó' }]),
        };
      }
      return undefined;
    });
    renderApp(`/importar/${ID}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirmar importación' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Subir otro archivo' })).toBeTruthy();
  });
});

describe('estados del lote y errores de lectura', () => {
  it('una vista previa caducada no enseña nada confirmable y ofrece volver a subir', async () => {
    stubApi((_m, path) =>
      path === `/imports/${ID}` ? { status: 200, body: detail({ status: 'expired' }) } : undefined,
    );
    renderApp(`/importar/${ID}`);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('La vista previa caducó');
    expect(confirmButton()).toBeNull();
    expect(within(alert).getByRole('link', { name: 'Subir otro archivo' })).toBeTruthy();
  });

  it('un lote fallido muestra sus problemas y no se puede confirmar', async () => {
    stubApi((_m, path) =>
      path === `/imports/${ID}`
        ? {
            status: 200,
            body: detail({
              status: 'failed',
              errors: 1,
              issues: [
                {
                  code: 'SHEET_MISSING',
                  severity: 'error',
                  sheet: null,
                  cell: null,
                  message: 'Falta la hoja «Metas»',
                },
              ],
            }),
          }
        : undefined,
    );
    renderApp(`/importar/${ID}`);
    expect(await screen.findByText('Falta la hoja «Metas»')).toBeTruthy();
    expect(confirmButton()).toBeNull();
  });

  it('un lote ya confirmado, al recargar, lo dice sin ofrecer confirmar', async () => {
    stubApi((_m, path) =>
      path === `/imports/${ID}`
        ? { status: 200, body: detail({ status: 'confirmed' }) }
        : undefined,
    );
    renderApp(`/importar/${ID}`);
    const result = await screen.findByRole('region', { name: 'Resultado de la importación' });
    expect(result.textContent).toContain('está confirmada');
    expect(confirmButton()).toBeNull();
  });

  it('404: la importación no existe y se ofrece subir de nuevo', async () => {
    stubApi((_m, path) =>
      path === `/imports/${ID}`
        ? { status: 404, body: problem(404, 'NOT_FOUND', 'La importación no existe') }
        : undefined,
    );
    renderApp(`/importar/${ID}`);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('La importación no existe');
    expect(within(alert).getByRole('link', { name: 'Subir otro archivo' })).toBeTruthy();
  });
});
