// @vitest-environment jsdom
/**
 * Panel de recordatorios de una tarea con la API simulada: la lista muestra las horas en Madrid (con
 * CET/CEST), el alta envía la hora local tal cual la escribe la persona (la conversión es de la API), los
 * errores 422 de la API se explican y se puede borrar.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReminderResponse, TaskResponse } from '@backoffice/shared';
import { RemindersPanel } from '../src/tasks/RemindersPanel.tsx';
import { formatMadridMoment, madridNowLocal } from '../src/ui/moment.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TASK_ID = '00000000-0000-4000-8000-000000000001';
const task: TaskResponse = {
  id: TASK_ID,
  title: 'Llamar al seguro',
  descriptionMd: null,
  status: 'todo',
  position: 0,
  dueOn: null,
  completedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  timeSpentSeconds: 0,
  timerStartedAt: null,
};

const reminder = (n: number, remindAt: string, sentAt: string | null = null): ReminderResponse => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  taskId: TASK_ID,
  remindAt,
  sentAt,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

interface Stub {
  calls: { key: string; body: unknown }[];
}

function stubApi(
  reminders: ReminderResponse[],
  overrides: Record<string, () => Response> = {},
): Stub {
  const stub: Stub = { calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace('/api/v1', '').split('?')[0] ?? '';
      const key = `${init?.method ?? 'GET'} ${path}`;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      stub.calls.push({ key, body });
      const forced = overrides[key];
      if (forced !== undefined) return Promise.resolve(forced());
      if (key === `GET /tasks/${TASK_ID}/reminders`)
        return Promise.resolve(json({ items: reminders }));
      if (key === `POST /tasks/${TASK_ID}/reminders`) {
        const created = reminder(50, '2027-03-28T01:30:00.000Z');
        reminders.push(created);
        return Promise.resolve(json(created, 201));
      }
      if (key.startsWith(`DELETE /tasks/${TASK_ID}/reminders/`)) {
        reminders.splice(0, reminders.length);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(json({}, 404));
    }),
  );
  return stub;
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RemindersPanel task={task} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('formato en la hora de Madrid', () => {
  it('invierno: CET', () => {
    expect(formatMadridMoment('2026-12-10T08:30:00.000Z')).toMatch(/10\/12\/2026.*09:30.*CET/);
  });

  it('verano: CEST', () => {
    expect(formatMadridMoment('2027-07-10T07:30:00.000Z')).toMatch(/10\/07\/2027.*09:30.*CEST/);
  });

  it('octubre: las dos «02:30» se distinguen por la abreviatura', () => {
    expect(formatMadridMoment('2027-10-31T00:30:00.000Z')).toMatch(/02:30.*CEST/);
    expect(formatMadridMoment('2027-10-31T01:30:00.000Z')).toMatch(/02:30.*CET$/);
  });

  it('madridNowLocal da la hora de reloj de Madrid, no la del dispositivo', () => {
    expect(madridNowLocal(new Date('2026-11-03T09:01:00Z'))).toBe('2026-11-03T10:01');
    expect(madridNowLocal(new Date('2027-07-10T22:30:00Z'))).toBe('2027-07-11T00:30');
    expect(madridNowLocal(new Date('2027-03-28T00:30:00Z'))).toBe('2027-03-28T01:30');
  });
});

describe('RemindersPanel', () => {
  it('sin recordatorios lo dice', async () => {
    stubApi([]);
    renderPanel();
    expect(await screen.findByText('Esta tarea no tiene recordatorios.')).toBeTruthy();
  });

  it('lista pendientes y entregados con su hora de Madrid', async () => {
    stubApi([
      reminder(1, '2026-12-10T08:30:00.000Z'),
      reminder(2, '2026-10-01T07:00:00.000Z', '2026-10-01T07:00:00.000Z'),
    ]);
    renderPanel();
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toMatch(/10\/12\/2026.*09:30.*CET.*Pendiente/);
    expect(items[1]?.textContent).toMatch(/01\/10\/2026.*09:00.*CEST.*Entregado el/);
  });

  it('envía la hora local tal cual, sin convertirla en el navegador', async () => {
    const stub = stubApi([]);
    renderPanel();
    await screen.findByText('Esta tarea no tiene recordatorios.');
    fireEvent.change(screen.getByLabelText(/Fecha y hora/), {
      target: { value: '2027-03-28T03:30' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Añadir recordatorio' }));
    await screen.findByText('Recordatorio añadido');
    expect(stub.calls.filter((call) => call.key.startsWith('POST'))).toEqual([
      { key: `POST /tasks/${TASK_ID}/reminders`, body: { remindAtLocal: '2027-03-28T03:30' } },
    ]);
    // El campo se vacía y la lista se recarga con el nuevo aviso.
    expect(screen.getByLabelText<HTMLInputElement>(/Fecha y hora/).value).toBe('');
    expect((await screen.findByRole('listitem')).textContent).toMatch(/28\/03\/2027.*03:30.*CEST/);
  });

  it('sin fecha no llama a la API y lo explica', async () => {
    const stub = stubApi([]);
    renderPanel();
    await screen.findByText('Esta tarea no tiene recordatorios.');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir recordatorio' }));
    expect(await screen.findByText('Indica la fecha y la hora del recordatorio')).toBeTruthy();
    expect(screen.getByLabelText(/Fecha y hora/).getAttribute('aria-invalid')).toBe('true');
    expect(stub.calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it.each([
    [
      'una hora que no existe',
      'Esa hora no existe ese día por el cambio de horario. Elige una hora anterior o posterior.',
    ],
    ['el pasado', 'El recordatorio debe ser posterior a la hora actual'],
  ])('muestra el 422 de la API (%s)', async (_name, detail) => {
    stubApi([], {
      [`POST /tasks/${TASK_ID}/reminders`]: () =>
        json(
          { type: 'about:blank', title: detail, status: 422, detail, code: 'UNPROCESSABLE' },
          422,
        ),
    });
    renderPanel();
    await screen.findByText('Esta tarea no tiene recordatorios.');
    fireEvent.change(screen.getByLabelText(/Fecha y hora/), {
      target: { value: '2027-03-28T02:30' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Añadir recordatorio' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Revisa los datos')).toBeTruthy();
    expect(alert.textContent).toContain(detail);
  });

  it('borra un recordatorio', async () => {
    const stub = stubApi([reminder(1, '2026-12-10T08:30:00.000Z')]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Borrar el recordatorio/ }));
    await waitFor(() => {
      expect(stub.calls.map((call) => call.key)).toContain(
        `DELETE /tasks/${TASK_ID}/reminders/${reminder(1, '').id}`,
      );
    });
    expect(await screen.findByText('Esta tarea no tiene recordatorios.')).toBeTruthy();
  });
});
