/**
 * Notificaciones dentro de la app (`/notifications`): lista, contador, marcar como leída (idempotente) y
 * marcar todas, contra la base de datos real. Textos inventados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  notificationListResponseSchema,
  notificationResponseSchema,
  unreadCountResponseSchema,
} from '@backoffice/shared';
import { useAuthTestContext } from '../support/auth.ts';
import { expectProblem } from '../support/ledger.ts';

const getCtx = useAuthTestContext();
const BASE = '/api/v1/notifications';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await getCtx().database.db.deleteFrom('notifications').execute();
});

/** Inserta notificaciones con fechas crecientes (la primera, la más antigua). */
async function seed(count: number): Promise<string[]> {
  const rows = await getCtx()
    .database.db.insertInto('notifications')
    .values(
      Array.from({ length: count }, (_, i) => ({
        kind: 'task_reminder',
        title: 'Recordatorio de tarea',
        body: `Tarea ${String(i + 1)}`,
        created_at: new Date(Date.UTC(2026, 10, 3, 8, i)),
      })),
    )
    .returning(['id', 'created_at'])
    .execute();
  return rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map((row) => row.id);
}

describe('lista y contador', () => {
  it('sin notificaciones: lista vacía y contador a 0', async () => {
    const client = await getCtx().loggedIn();
    const list = await client.get(BASE);
    expect(list.status).toBe(200);
    expect(notificationListResponseSchema.parse(list.body)).toEqual({ items: [], unreadCount: 0 });
    const count = await client.get(`${BASE}/unread-count`);
    expect(unreadCountResponseSchema.parse(count.body)).toEqual({ count: 0 });
  });

  it('las más recientes primero, con su contenido y el recuento de no leídas', async () => {
    const client = await getCtx().loggedIn();
    const ids = await seed(3);
    const body = notificationListResponseSchema.parse((await client.get(BASE)).body);
    expect(body.unreadCount).toBe(3);
    expect(body.items.map((item) => item.id)).toEqual([...ids].reverse());
    expect(body.items[0]).toMatchObject({
      kind: 'task_reminder',
      referenceId: null,
      title: 'Recordatorio de tarea',
      body: 'Tarea 3',
      createdAt: '2026-11-03T08:02:00.000Z',
      readAt: null,
    });
  });

  it('la lista se limita a 50, pero el contador cuenta todas', async () => {
    const client = await getCtx().loggedIn();
    await seed(55);
    const body = notificationListResponseSchema.parse((await client.get(BASE)).body);
    expect(body.items).toHaveLength(50);
    expect(body.unreadCount).toBe(55);
  });
});

describe('marcar como leída', () => {
  it('marca una (con la hora del reloj) y baja el contador', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const [first, second] = await seed(2);
    const res = await client.post(`${BASE}/${first ?? ''}/read`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(notificationResponseSchema.parse(res.body)).toMatchObject({
      id: first,
      readAt: ctx.t.clock.now().toISOString(),
    });
    const count = unreadCountResponseSchema.parse((await client.get(`${BASE}/unread-count`)).body);
    expect(count.count).toBe(1);
    const list = notificationListResponseSchema.parse((await client.get(BASE)).body);
    expect(list.items.find((item) => item.id === second)?.readAt).toBeNull();
  });

  it('es idempotente: repetirlo no cambia la hora de lectura ni falla', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const [id] = await seed(1);
    const first = notificationResponseSchema.parse(
      (await client.post(`${BASE}/${id ?? ''}/read`)).body,
    );
    ctx.t.clock.advance(60_000);
    const again = await client.post(`${BASE}/${id ?? ''}/read`);
    expect(again.status).toBe(200);
    expect(notificationResponseSchema.parse(again.body).readAt).toBe(first.readAt);
  });

  it('una notificación que no existe → 404; un identificador no válido → 400', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.post(`${BASE}/${MISSING_ID}/read`), 404, 'NOT_FOUND');
    expectProblem(await client.post(`${BASE}/no-es-uuid/read`), 400, 'VALIDATION_ERROR');
  });

  it('marcar todas deja el contador a 0 y conserva la hora de las ya leídas', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const [first] = await seed(3);
    const early = notificationResponseSchema.parse(
      (await client.post(`${BASE}/${first ?? ''}/read`)).body,
    );
    ctx.t.clock.advance(60_000);
    expect((await client.post(`${BASE}/read-all`)).status).toBe(204);
    const list = notificationListResponseSchema.parse((await client.get(BASE)).body);
    expect(list.unreadCount).toBe(0);
    expect(list.items.every((item) => item.readAt !== null)).toBe(true);
    expect(list.items.find((item) => item.id === first)?.readAt).toBe(early.readAt);
  });
});
