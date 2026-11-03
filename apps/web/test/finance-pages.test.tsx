// @vitest-environment jsdom
/** Pantallas del libro con la API simulada: conciliación (aviso de discrepancia), movimientos y transferencias. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MovementsPage } from '../src/finance/pages/MovementsPage.tsx';
import { ReconciliationPage } from '../src/finance/pages/ReconciliationPage.tsx';
import { TransfersPage } from '../src/finance/pages/TransfersPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';
const M = '55555555-5555-4555-8555-555555555555';

const account = (id: string, name: string, balanceCents: number) => ({
  id,
  name,
  type: 'checking',
  currency: 'EUR',
  openingBalanceCents: 0,
  openingDate: '2026-01-01',
  balanceCents,
  archived: false,
});
const accountA = account(A, 'Cuenta de prueba', 285_000);
const accountB = account(B, 'Cuenta de ahorro', 0);

const reconciliation = (discrepancy: boolean) => ({
  id: R,
  accountId: A,
  month: '2026-10',
  asOf: '2026-10-15',
  statementBalanceCents: 285_250,
  computedBalanceCents: 285_000,
  note: null,
  createdAt: '2026-10-16T10:00:00.000Z',
  adjustmentMovementId: M,
  discrepancy: {
    currentBalanceCents: discrepancy ? 284_000 : 285_250,
    differenceCents: discrepancy ? 1_250 : 0,
    hasDiscrepancy: discrepancy,
  },
});

function stubApi(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const path = url.replace('/api/v1', '').split('?')[0] ?? '';
    const body = routes[path];
    return Promise.resolve(
      body === undefined
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string, element: React.ReactNode, route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReconciliationPage', () => {
  it('codifica el id de la ruta del navegador al construir la URL de la API (ASVS 1.2.2)', async () => {
    const fetchMock = stubApi({});
    renderAt(
      '/cuentas/..%2Freports%3Fx=1/conciliacion',
      <ReconciliationPage />,
      '/cuentas/:id/conciliacion',
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain('/accounts/..%2Freports%3Fx%3D1');
      expect(url).not.toContain('/accounts/../');
    }
  });

  it('avisa cuando una conciliación ya no cuadra con el banco', async () => {
    stubApi({
      [`/accounts/${A}`]: accountA,
      [`/accounts/${A}/reconciliations`]: { items: [reconciliation(true)] },
    });
    renderAt(`/cuentas/${A}/conciliacion`, <ReconciliationPage />, '/cuentas/:id/conciliacion');
    const warning = await screen.findByText(/Ya no cuadra con el banco/u);
    expect(warning.closest('[role="alert"]')?.textContent).toContain('2840,00');
    expect(screen.getByRole('heading', { name: 'octubre de 2026' })).toBeTruthy();
  });

  it('sin discrepancia no hay aviso, y borrar pide confirmación e indica que borra el ajuste', async () => {
    stubApi({
      [`/accounts/${A}`]: accountA,
      [`/accounts/${A}/reconciliations`]: { items: [reconciliation(false)] },
    });
    renderAt(`/cuentas/${A}/conciliacion`, <ReconciliationPage />, '/cuentas/:id/conciliacion');
    await screen.findByRole('heading', { name: 'octubre de 2026' });
    expect(screen.queryByText(/Ya no cuadra/u)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /Borrar/u }));
    expect(screen.getByRole('alertdialog').textContent).toContain('También se borrará su ajuste');
  });
});

const movement = {
  id: M,
  kind: 'expense',
  amountCents: 1_250,
  description: 'Compra de prueba',
  merchant: null,
  accountId: A,
  categoryId: C,
  bookedOn: '2026-10-10',
  source: 'manual',
  reconciliationId: null,
  status: 'confirmed',
  flags: [],
  createdAt: '2026-10-10T10:00:00.000Z',
  confirmedAt: '2026-10-10T10:00:00.000Z',
};

describe('MovementsPage', () => {
  it('una descripción con <script> se muestra como texto, sin crear elementos (ASVS 1.2.1)', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    stubApi({
      '/accounts': { items: [accountA] },
      '/categories': { items: [] },
      '/movements': { items: [{ ...movement, description: payload }], nextCursor: null },
    });
    const { container } = renderAt('/movimientos', <MovementsPage />, '/movimientos');
    const titles = await screen.findAllByText(payload);
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(title.textContent).toContain(payload);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('lista con importe, cuenta y categoría; los ajustes no tienen editar ni borrar', async () => {
    stubApi({
      '/accounts': { items: [accountA, accountB] },
      '/categories': { items: [{ id: C, name: 'Comida', kind: 'expense', archived: false }] },
      '/movements': {
        items: [
          movement,
          {
            ...movement,
            id: R,
            description: 'Ajuste de conciliación',
            source: 'reconciliation',
            categoryId: null,
          },
        ],
        nextCursor: null,
      },
    });
    renderAt('/movimientos', <MovementsPage />, '/movimientos');
    expect(await screen.findByText('Compra de prueba', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText(/10\/10\/2026 · Cuenta de prueba · Comida/u)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Borrar/u })).toHaveLength(1);
    expect(screen.getByText(/Se borra junto con su conciliación/u)).toBeTruthy();
  });

  it('«Desde» posterior a «Hasta» se avisa sin llamar a la API', async () => {
    const fetchMock = stubApi({
      '/accounts': { items: [] },
      '/categories': { items: [] },
      '/movements': { items: [], nextCursor: null },
    });
    renderAt('/movimientos', <MovementsPage />, '/movimientos');
    await screen.findByText(/No hay movimientos/u);
    const calls = fetchMock.mock.calls.length;
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Desde'), '2026-10-20');
    await user.type(screen.getByLabelText('Hasta'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(screen.getByText(/no puede ser posterior/u)).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe('TransfersPage', () => {
  it('muestra origen → destino con el importe', async () => {
    stubApi({
      '/accounts': { items: [accountA, accountB] },
      '/transfers': {
        items: [
          {
            id: M,
            fromAccountId: A,
            toAccountId: B,
            amountCents: 5_000,
            bookedOn: '2026-10-10',
            note: 'Ahorro mensual',
            createdAt: '2026-10-10T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    });
    renderAt('/transferencias', <TransfersPage />, '/transferencias');
    expect(await screen.findByText('Cuenta de prueba → Cuenta de ahorro')).toBeTruthy();
    expect(screen.getByText(/50,00/u)).toBeTruthy();
  });
});
