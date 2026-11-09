// @vitest-environment jsdom
/**
 * Pantalla de presupuestos: barra y estados (también sin color), formulario de importe y copia del mes
 * anterior. Nombres e importes inventados.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetBar } from '../src/finance/budget/BudgetBar.tsx';
import { BudgetForm } from '../src/finance/forms/BudgetForm.tsx';
import { BudgetPage } from '../src/finance/pages/BudgetPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FOOD = '33333333-3333-4333-8333-333333333333';
const FUN = '44444444-4444-4444-8444-444444444444';
const B1 = '55555555-5555-4555-8555-555555555555';
const B2 = '66666666-6666-4666-8666-666666666666';

describe('BudgetBar', () => {
  it('dentro del presupuesto: icono, texto y progressbar con su valor', () => {
    render(<BudgetBar name="Comida" amountCents={10_000} spentCents={3_000} />);
    const bar = screen.getByRole('progressbar', { name: 'Gastado de Comida' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuetext')).toBe('30 % gastado. Dentro del presupuesto');
    expect(screen.getByText(/Dentro del presupuesto · 30 %/u)).toBeTruthy();
  });

  it('al 80 % avisa con texto, no solo con color', () => {
    render(<BudgetBar name="Comida" amountCents={10_000} spentCents={8_000} />);
    expect(screen.getByText(/Cerca del límite · 80 %/u).textContent).toContain('⚠');
    expect(screen.getByRole('progressbar').firstElementChild?.getAttribute('data-state')).toBe(
      'near',
    );
  });

  it('al pasarse, la barra se queda al 100 % pero el porcentaje real se dice', () => {
    render(<BudgetBar name="Ocio" amountCents={10_000} spentCents={15_000} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('150 % gastado. Presupuesto superado');
    expect(screen.getByText(/Presupuesto superado · 150 %/u).textContent).toContain('✕');
  });
});

describe('BudgetForm', () => {
  const options = [{ value: FOOD, label: 'Comida' }];

  it('muestra «Se guardará», rechaza la coma ambigua y no envía', async () => {
    const onCreate = vi.fn();
    render(<BudgetForm month="2026-10" categories={options} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Categoría de gasto'), FOOD);
    await user.type(screen.getByLabelText('Importe presupuestado'), '1.234,50');
    expect(screen.getByText(/Se guardará: 1.?234,50/u)).toBeTruthy();

    await user.clear(screen.getByLabelText('Importe presupuestado'));
    await user.type(screen.getByLabelText('Importe presupuestado'), '12,345');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onCreate).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Importe presupuestado');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(screen.getByText(/Usa la coma para los céntimos/u)).toBeTruthy();
  });

  it('envía mes, categoría e importe en céntimos', async () => {
    const onCreate = vi.fn();
    render(<BudgetForm month="2026-10" categories={options} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Categoría de gasto'), FOOD);
    await user.type(screen.getByLabelText('Importe presupuestado'), '300');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onCreate).toHaveBeenCalledWith({
      month: '2026-10',
      categoryId: FOOD,
      amountCents: 30_000,
    });
  });

  it('pide la categoría y un importe mayor que 0', async () => {
    const onCreate = vi.fn();
    render(<BudgetForm month="2026-10" categories={options} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Importe presupuestado'), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Este campo es obligatorio')).toBeTruthy();
    expect(screen.getByText('El importe debe ser mayor que 0')).toBeTruthy();
  });

  it('al editar, parte del importe actual y sin cambios no llama a la API', async () => {
    const onUpdate = vi.fn();
    const onCancel = vi.fn();
    render(
      <BudgetForm
        month="2026-10"
        budget={{ categoryName: 'Comida', amountCents: 30_000 }}
        onUpdate={onUpdate}
        onCancel={onCancel}
      />,
    );
    const user = userEvent.setup();
    const field = screen.getByLabelText<HTMLInputElement>('Importe presupuestado');
    expect(field.value).toBe('300,00');
    expect(screen.queryByLabelText('Categoría de gasto')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, '320');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onUpdate).toHaveBeenCalledWith({ amountCents: 32_000 });
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

function problem(status: number, code: string, detail: string): Response {
  return json(status, { type: 'about:blank', title: 'Error', status, detail, code });
}

const MONTH_DATA = {
  month: '2026-11',
  items: [
    {
      id: B1,
      categoryId: FOOD,
      categoryName: 'Comida',
      categoryArchived: false,
      amountCents: 30_000,
      spentCents: 25_000,
      remainingCents: 5_000,
    },
    {
      id: B2,
      categoryId: FUN,
      categoryName: 'Ocio',
      categoryArchived: false,
      amountCents: 10_000,
      spentCents: 12_500,
      remainingCents: -2_500,
    },
  ],
  unbudgeted: [{ categoryId: null, categoryName: null, spentCents: 900 }],
  totals: {
    budgetedCents: 40_000,
    spentCents: 37_500,
    remainingCents: 2_500,
    unbudgetedSpentCents: 900,
  },
};

const CATEGORIES = {
  items: [
    { id: FOOD, name: 'Comida', kind: 'expense', archived: false },
    { id: FUN, name: 'Ocio', kind: 'expense', archived: false },
    {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Viajes',
      kind: 'expense',
      archived: false,
    },
    { id: '88888888-8888-4888-8888-888888888888', name: 'Nómina', kind: 'income', archived: false },
  ],
};

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function renderPage(
  handler: Handler,
): ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>> {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    (url: string, init?: RequestInit) => {
      const custom = handler(url, init);
      if (custom !== undefined) return Promise.resolve(custom);
      if (url.includes('/categories')) return Promise.resolve(json(200, CATEGORIES));
      return Promise.resolve(json(200, MONTH_DATA));
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BudgetPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('BudgetPage', () => {
  it('una fila por categoría con estado, el gasto sin presupuesto aparte y los totales', async () => {
    renderPage(() => undefined);
    expect(await screen.findByRole('heading', { name: 'Comida' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Gastado de Comida' })).toBeTruthy();
    expect(screen.getByText(/Cerca del límite · 83 %/u)).toBeTruthy();
    expect(screen.getByText(/Presupuesto superado · 125 %/u)).toBeTruthy();
    // El exceso se muestra en positivo con su etiqueta.
    expect(screen.getAllByText('Te has pasado en').length).toBeGreaterThan(0);

    const unbudgeted = screen.getByRole('region', { name: 'Gastos sin presupuesto' });
    expect(within(unbudgeted).getByText('Sin categoría')).toBeTruthy();
    expect(within(unbudgeted).getByText(/9,00/u)).toBeTruthy();
    // El selector de alta solo ofrece categorías de gasto sin presupuesto este mes.
    const select = screen.getByLabelText('Categoría de gasto');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Elige una categoría', 'Viajes']);
  });

  it('«Copiar del mes anterior» explica el resultado, incluido el caso sin nada que copiar', async () => {
    const fetchMock = renderPage((url, init) =>
      init?.method === 'POST' && url.endsWith('/budgets/copy-previous')
        ? json(200, {
            month: '2026-11',
            sourceMonth: '2026-10',
            copied: 0,
            skippedExisting: 0,
            skippedArchived: 0,
          })
        : undefined,
    );
    await screen.findByRole('heading', { name: 'Comida' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copiar del mes anterior' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Octubre de 2026 no tiene presupuestos que copiar.',
    );
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/copy-previous'));
    const body = call?.[1]?.body;
    expect(typeof body).toBe('string');
    const sent = JSON.parse(body as string) as { month: string };
    expect(sent.month).toMatch(/^\d{4}-\d{2}$/u);
  });

  it('un 409 al crear (ya existe) se muestra en español como «No se puede hacer ahora»', async () => {
    const message = 'Ya hay un presupuesto de «Viajes» en 2026-11';
    renderPage((url, init) =>
      init?.method === 'POST' && url.endsWith('/budgets')
        ? problem(409, 'CONFLICT', message)
        : undefined,
    );
    await screen.findByRole('heading', { name: 'Comida' });
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText('Categoría de gasto'),
      '77777777-7777-4777-8777-777777777777',
    );
    await user.type(screen.getByLabelText('Importe presupuestado'), '100');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No se puede hacer ahora');
    expect(alert.textContent).toContain(message);
  });

  it('un 422 al editar se muestra como «Revisa los datos»', async () => {
    renderPage((url, init) =>
      init?.method === 'PATCH' ? problem(422, 'UNPROCESSABLE', 'Importe incoherente') : undefined,
    );
    await screen.findByRole('heading', { name: 'Comida' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Editar presupuesto de Comida/u }));
    const form = screen.getByRole('form', { name: 'Editar presupuesto de Comida' });
    const field = within(form).getByLabelText('Importe presupuestado');
    await user.clear(field);
    await user.type(field, '350');
    await user.click(within(form).getByRole('button', { name: 'Guardar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Revisa los datos');
    expect(alert.textContent).toContain('Importe incoherente');
  });

  it('borrar pide confirmación y llama a DELETE solo al confirmar', async () => {
    const fetchMock = renderPage((_url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined,
    );
    await screen.findByRole('heading', { name: 'Comida' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Borrar presupuesto de Comida/u }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Borrar presupuesto' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).endsWith(`/budgets/${B1}`) && init?.method === 'DELETE',
        ),
      ).toBe(true);
    });
  });
});

describe('Selector de mes', () => {
  it('el desplegable tiene su etiqueta «Mes» y los botones cambian de mes', async () => {
    const fetchMock = renderPage(() => undefined);
    await screen.findByRole('heading', { name: 'Comida' });
    const select = screen.getByLabelText<HTMLSelectElement>('Mes');
    const before = select.value;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mes anterior' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url).includes('/budgets?month=') && !String(url).endsWith(before),
        ),
      ).toBe(true);
    });
    expect(select.value).not.toBe(before);
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeTruthy();
  });
});
