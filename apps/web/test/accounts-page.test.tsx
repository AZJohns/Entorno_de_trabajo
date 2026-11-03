// @vitest-environment jsdom
/** Pantalla de cuentas: saldo en la lista y el 409 del archivado con el saldo en el mensaje. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from '../src/finance/pages/AccountsPage.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = '11111111-1111-4111-8111-111111111111';
const account = {
  id: ID,
  name: 'Cuenta de prueba',
  type: 'checking',
  currency: 'EUR',
  openingBalanceCents: 10_000,
  openingDate: '2026-01-01',
  balanceCents: 12_540,
  archived: false,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountsPage', () => {
  it('muestra el saldo y, al archivar con saldo ≠ 0, el mensaje de la API', async () => {
    const message =
      'Para archivar la cuenta, su saldo debe ser 0 (ahora: 125,40 €). Vacíala antes con una transferencia';
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/archive')) {
        return Promise.resolve(
          json(409, {
            type: 'about:blank',
            title: 'Conflicto',
            status: 409,
            detail: message,
            code: 'CONFLICT',
          }),
        );
      }
      return Promise.resolve(json(200, { items: [account] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByText(/125,40/u)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Archivar/u }));
    // La confirmación lleva el foco a «Cancelar»; se confirma con el botón de la propia barra.
    await user.click(screen.getByRole('button', { name: 'Archivar cuenta' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(message);
    });
    expect(screen.getByRole('alert').textContent).toContain('No se puede hacer ahora');
  });

  it('Cancelar cierra la confirmación sin llamar a la API de archivado', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(json(200, { items: [account] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText(/125,40/u);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Archivar/u }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });
});
