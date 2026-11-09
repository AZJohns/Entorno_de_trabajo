// @vitest-environment jsdom
/**
 * Campana y lista de notificaciones con la API simulada: el contador (con texto y etiqueta accesible), que
 * se refresca al cambiar de pantalla, y la lista con marcar una o todas como leídas.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationResponse } from '@backoffice/shared';
import { NotificationBell } from '../src/notifications/NotificationBell.tsx';
import { NotificationsPage } from '../src/notifications/NotificationsPage.tsx';
import { UNREAD_KEY } from '../src/notifications/queries.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const notification = (n: number, readAt: string | null = null): NotificationResponse => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  kind: 'task_reminder',
  referenceId: null,
  title: 'Recordatorio de tarea',
  body: `Tarea ${String(n)}`,
  createdAt: '2026-11-03T09:01:00.000Z',
  readAt,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

/** API en memoria de las notificaciones. */
function stubApi(items: NotificationResponse[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/v1', '').split('?')[0] ?? '';
      const key = `${init?.method ?? 'GET'} ${path}`;
      calls.push(key);
      const unreadCount = items.filter((item) => item.readAt === null).length;
      if (key === 'GET /notifications/unread-count')
        return Promise.resolve(json({ count: unreadCount }));
      if (key === 'GET /notifications') return Promise.resolve(json({ items, unreadCount }));
      if (key === 'POST /notifications/read-all') {
        items.forEach((item, i) => {
          items[i] = { ...item, readAt: item.readAt ?? '2026-11-03T09:05:00.000Z' };
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const match = /^POST \/notifications\/(.+)\/read$/.exec(key);
      if (match !== null) {
        const index = items.findIndex((item) => item.id === match[1]);
        const current = items[index];
        if (current === undefined) return Promise.resolve(json({}, 404));
        items[index] = { ...current, readAt: '2026-11-03T09:05:00.000Z' };
        return Promise.resolve(json(items[index]));
      }
      return Promise.resolve(json({}, 404));
    }),
  );
  return calls;
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderWithRouter(ui: React.ReactNode, queryClient = newClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationBell', () => {
  it('con notificaciones sin leer muestra el número y lo anuncia en la etiqueta', async () => {
    stubApi([notification(1), notification(2), notification(3, '2026-11-03T09:02:00.000Z')]);
    renderWithRouter(<NotificationBell />);
    const link = await screen.findByRole('link', { name: 'Notificaciones, 2 sin leer' });
    expect(link.getAttribute('href')).toBe('/notificaciones');
    expect(screen.getByTestId('unread-count').textContent).toBe('2');
  });

  it('sin notificaciones sin leer no muestra el número', async () => {
    const calls = stubApi([notification(1, '2026-11-03T09:02:00.000Z')]);
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByRole('link', { name: 'Notificaciones' })).toBeTruthy();
    await waitFor(() => {
      expect(calls).toContain('GET /notifications/unread-count');
    });
    expect(screen.queryByTestId('unread-count')).toBeNull();
  });

  it('más de 99 se muestra como 99+', async () => {
    stubApi(Array.from({ length: 120 }, (_, i) => notification(i)));
    renderWithRouter(<NotificationBell />);
    expect((await screen.findByTestId('unread-count')).textContent).toBe('99+');
  });

  it('no sondea: el contador no tiene intervalo de refresco (cada petición renovaría la inactividad)', async () => {
    stubApi([notification(1)]);
    const queryClient = newClient();
    renderWithRouter(<NotificationBell />, queryClient);
    await screen.findByTestId('unread-count');
    const query = queryClient.getQueryCache().find({ queryKey: UNREAD_KEY });
    const observers = query?.observers ?? [];
    expect(observers.length).toBeGreaterThan(0);
    for (const observer of observers) {
      expect(observer.options.refetchInterval).toBeUndefined();
    }
  });

  it('al cambiar de pantalla vuelve a pedir el contador', async () => {
    const items = [notification(1)];
    const calls = stubApi(items);
    renderWithRouter(
      <>
        <NotificationBell />
        <Link to="/otra">Ir a otra pantalla</Link>
      </>,
    );
    expect((await screen.findByTestId('unread-count')).textContent).toBe('1');
    const countCalls = () =>
      calls.filter((call) => call === 'GET /notifications/unread-count').length;
    const before = countCalls();

    items.push(notification(2));
    await userEvent.click(screen.getByRole('link', { name: 'Ir a otra pantalla' }));
    await waitFor(() => {
      expect(screen.getByTestId('unread-count').textContent).toBe('2');
    });
    expect(countCalls()).toBeGreaterThan(before);
  });
});

describe('NotificationsPage', () => {
  it('sin notificaciones lo dice y no ofrece marcar nada', async () => {
    stubApi([]);
    renderWithRouter(<NotificationsPage />);
    expect(await screen.findByText('Todavía no hay notificaciones.')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Marcar todas como leídas' }).disabled,
    ).toBe(true);
  });

  it('marca las no leídas con el texto «Nueva» y enlaza los recordatorios al tablero', async () => {
    stubApi([notification(1), notification(2, '2026-11-03T09:02:00.000Z')]);
    renderWithRouter(<NotificationsPage />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Nueva');
    expect(items[0]?.textContent).toContain('Tarea 1');
    expect(items[1]?.textContent).not.toContain('Nueva');
    expect(screen.getByRole('status').textContent).toBe('Tienes 1 notificación sin leer.');
    expect(
      screen.getAllByRole('link', { name: 'Ver el tablero de tareas' })[0]?.getAttribute('href'),
    ).toBe('/tareas');
  });

  it('marca una como leída y se actualiza la lista', async () => {
    const calls = stubApi([notification(1), notification(2)]);
    renderWithRouter(<NotificationsPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Marcar como leída.*Tarea 1/ }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Tienes 1 notificación sin leer.');
    });
    expect(calls).toContain(`POST /notifications/${notification(1).id}/read`);
    expect(screen.getAllByText('Nueva')).toHaveLength(1);
  });

  it('marca todas como leídas', async () => {
    const calls = stubApi([notification(1), notification(2), notification(3)]);
    renderWithRouter(<NotificationsPage />);
    expect(await screen.findByText('Tienes 3 notificaciones sin leer.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('No tienes notificaciones sin leer.');
    });
    expect(calls).toContain('POST /notifications/read-all');
    expect(screen.queryByText('Nueva')).toBeNull();
  });
});
