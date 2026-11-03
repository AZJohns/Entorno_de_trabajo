// @vitest-environment jsdom
/** Informes: geometría de los ejes, desplazamiento de meses y la pantalla con la API simulada. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { niceAxis, position } from '../src/finance/charts/scale.ts';
import { monthOf, shiftMonth, todayLocal } from '../src/finance/dates.ts';
import { ReportsPage } from '../src/finance/pages/ReportsPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('niceAxis', () => {
  it('incluye siempre el 0 y todos los valores, con marcas redondas', () => {
    const axis = niceAxis([0, 123_456]);
    expect(axis.min).toBe(0);
    expect(axis.max).toBeGreaterThanOrEqual(123_456);
    expect(axis.ticks[0]).toBe(0);
    expect(axis.ticks.at(-1)).toBe(axis.max);
    const steps = axis.ticks.slice(1).map((tick, i) => tick - (axis.ticks[i] ?? 0));
    expect(new Set(steps).size).toBe(1);
  });

  it('admite saldos negativos', () => {
    const axis = niceAxis([-30_000, 80_000]);
    expect(axis.min).toBeLessThanOrEqual(-30_000);
    expect(axis.max).toBeGreaterThanOrEqual(80_000);
    expect(axis.ticks).toContain(0);
  });

  it('sin datos o todo a cero devuelve un eje válido', () => {
    expect(niceAxis([])).toEqual({ min: 0, max: 100, ticks: [0, 100] });
    expect(niceAxis([0, 0])).toEqual({ min: 0, max: 100, ticks: [0, 100] });
  });

  it('position coloca el mínimo y el máximo en los extremos', () => {
    const axis = niceAxis([0, 1_000]);
    expect(position(axis, axis.min, 200, 0)).toBe(200);
    expect(position(axis, axis.max, 200, 0)).toBe(0);
  });
});

describe('shiftMonth', () => {
  it.each([
    ['2026-01', -1, '2025-12'],
    ['2026-12', 1, '2027-01'],
    ['2026-10', -11, '2025-11'],
    ['2026-10', 0, '2026-10'],
    ['2026-03', -15, '2024-12'],
  ])('%s %i → %s', (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected);
  });
});

const ID = '11111111-1111-4111-8111-111111111111';
const CAT = '22222222-2222-4222-8222-222222222222';

function stubApi(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const to = monthOf(todayLocal());
  const from = shiftMonth(to, -11);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(from, i));
  const bodies: Record<string, unknown> = {
    '/reports/monthly': {
      items: months.map((month, i) => ({
        month,
        incomeCents: i === 11 ? 200_000 : 0,
        expenseCents: i === 11 ? 30_000 : 0,
        netCents: i === 11 ? 170_000 : 0,
        adjustmentsCents: i === 11 ? 500 : 0,
        pending: { count: i === 11 ? 1 : 0, incomeCents: 0, expenseCents: i === 11 ? 700 : 0 },
      })),
    },
    [`/reports/monthly/${to}/categories`]: {
      month: to,
      items: [
        { kind: 'income', categoryId: null, name: 'Sueldo', totalCents: 200_000 },
        { kind: 'expense', categoryId: CAT, name: 'Comida', totalCents: 25_000 },
      ],
    },
    '/reports/balances': {
      at: todayLocal(),
      accounts: [
        {
          accountId: ID,
          name: 'Cuenta de prueba',
          type: 'checking',
          archived: false,
          balanceCents: 240_500,
          adjustmentsCents: 500,
        },
        {
          accountId: CAT,
          name: 'Vieja',
          type: 'cash',
          archived: true,
          balanceCents: 0,
          adjustmentsCents: 0,
        },
      ],
      totalCents: 240_500,
      totalAdjustmentsCents: 500,
    },
    '/reports/balance-history': {
      months,
      accounts: [
        {
          accountId: ID,
          name: 'Cuenta de prueba',
          archived: false,
          balancesCents: months.map((_, i) => (i < 3 ? null : 100_000 + i * 1_000)),
        },
      ],
      totalsCents: months.map((_, i) => (i < 3 ? 0 : 100_000 + i * 1_000)),
    },
  };
  Object.assign(bodies, overrides);
  const fetchMock = vi.fn((url: string) => {
    const path = url.replace('/api/v1', '').split('?')[0] ?? '';
    const body = bodies[path];
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

describe('ReportsPage', () => {
  it('muestra los 3 gráficos con su tabla de datos, el saldo por cuenta y los ajustes en su columna', async () => {
    const fetchMock = stubApi();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const table = await screen.findByRole('table', {
      name: 'Saldo por cuenta, con los ajustes de conciliación aparte',
    });
    expect(within(table).getByText('Cuenta de prueba')).toBeTruthy();
    // La cuenta archivada y vacía no estorba, pero el total sí sale.
    expect(within(table).queryByText(/Vieja/u)).toBeNull();
    const total = within(table).getByText('Total').closest('tr');
    expect(total?.textContent).toContain('2405,00');
    expect(total?.textContent).toContain('5,00');

    const charts = await screen.findAllByRole('img');
    expect(charts).toHaveLength(3);
    expect(charts.map((chart) => chart.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('ingresos y gastos por mes'),
      expect.stringContaining('gastos por categoría'),
      expect.stringContaining('saldo a fin de cada mes'),
    ]);
    // Cada gráfico tiene su alternativa en tabla.
    expect(document.querySelectorAll('details table')).toHaveLength(3);
    expect(screen.getAllByText('Ajustes de conciliación').length).toBeGreaterThan(0);

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/reports/monthly?from='))).toBe(true);
    expect(urls.some((url) => url.includes(`/reports/balances?at=${todayLocal()}`))).toBe(true);
  });

  it('un mes sin gastos lo dice en vez de dibujar un gráfico vacío', async () => {
    const to = monthOf(todayLocal());
    stubApi({
      [`/reports/monthly/${to}/categories`]: { month: to, items: [] },
      '/reports/balances': {
        at: todayLocal(),
        accounts: [],
        totalCents: 0,
        totalAdjustmentsCents: 0,
      },
      '/reports/balance-history': { months: [], accounts: [], totalsCents: [] },
      '/reports/monthly': { items: [] },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No hay gastos confirmados en este mes.')).toBeTruthy();
  });
});
