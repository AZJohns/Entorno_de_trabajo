/**
 * Lista de notificaciones (`/notificaciones`): las 50 más recientes, con las no leídas marcadas con
 * texto («Nueva»), marcar una o todas como leídas y, en los recordatorios, un enlace al tablero.
 */
import type { NotificationResponse } from '@backoffice/shared';
import { Link } from 'react-router';
import { ProblemNotice } from '../ui/finance-forms.tsx';
import { Button, Loading } from '../ui/forms.tsx';
import { formatMadridMoment } from '../ui/moment.ts';
import { useMarkAllRead, useMarkRead, useNotifications } from './queries.ts';

export function NotificationsPage() {
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unread = list.data?.unreadCount ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Notificaciones</h1>
        <Button
          type="button"
          variant="secondary"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Marcar todas como leídas
        </Button>
      </div>

      {list.isPending && <Loading />}
      {list.isError && <ProblemNotice error={list.error} />}
      {markRead.isError && <ProblemNotice error={markRead.error} />}
      {markAll.isError && <ProblemNotice error={markAll.error} />}

      {list.isSuccess && (
        <>
          <p role="status" className="text-sm text-slate-600">
            {unread === 0
              ? 'No tienes notificaciones sin leer.'
              : `Tienes ${String(unread)} ${unread === 1 ? 'notificación sin leer' : 'notificaciones sin leer'}.`}
          </p>
          {list.data.items.length === 0 ? (
            <p className="text-sm text-slate-600">Todavía no hay notificaciones.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.data.items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  pending={markRead.isPending}
                  onMarkRead={() => markRead.mutate(notification.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  pending,
  onMarkRead,
}: {
  notification: NotificationResponse;
  pending: boolean;
  onMarkRead: () => void;
}) {
  const isUnread = notification.readAt === null;
  return (
    <li
      className={`flex flex-col gap-1 rounded-lg border p-3 ${
        isUnread ? 'border-slate-800 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">
          {isUnread && (
            <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">
              Nueva
            </span>
          )}
          {notification.title}
        </h2>
        <time dateTime={notification.createdAt} className="text-xs text-slate-500">
          {formatMadridMoment(notification.createdAt)}
        </time>
      </div>
      {notification.body !== '' && <p className="break-words text-sm">{notification.body}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {notification.kind === 'task_reminder' && (
          <Link to="/tareas" className="text-sm text-slate-800 underline">
            Ver el tablero de tareas
          </Link>
        )}
        {isUnread && (
          <button
            type="button"
            disabled={pending}
            onClick={onMarkRead}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            Marcar como leída{' '}
            <span className="sr-only">«{notification.body || notification.title}»</span>
          </button>
        )}
      </div>
    </li>
  );
}
