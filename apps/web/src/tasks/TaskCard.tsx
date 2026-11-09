/**
 * Tarjeta de una tarea: título, fecha límite (con aviso textual si está vencida), tiempo, cronómetro y
 * acciones. Presentacional: el estado del tablero (arrastre, movimiento con teclado, mutaciones) vive
 * en la página.
 */
import { TASK_STATUSES, type TaskResponse, type TaskStatus } from '@backoffice/shared';
import { type DragEvent, type KeyboardEvent } from 'react';
import { formatDate } from '../finance/dates.ts';
import { COLUMN_LABEL, formatDuration, secondsSince } from './boardLogic.ts';

interface Props {
  task: TaskResponse;
  overdue: boolean;
  /** Instante actual en ms, para el contador del cronómetro. */
  now: number;
  /** La tarjeta está «cogida» con el teclado. */
  lifted: boolean;
  dragging: boolean;
  onToggleLift: () => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onHandleBlur: () => void;
  onMoveTo: (status: TaskStatus) => void;
  onToggleTimer: () => void;
  onOpenTime: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
}

const SMALL_BUTTON =
  'rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100';

export function TaskCard(props: Props) {
  const { task, overdue, now, lifted } = props;
  const running = task.timerStartedAt !== null;
  return (
    <li
      data-task-id={task.id}
      draggable
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      className={`flex flex-col gap-2 rounded-lg border bg-white p-3 shadow-sm ${
        lifted ? 'border-slate-800 ring-2 ring-slate-800' : 'border-slate-200'
      } ${props.dragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          data-handle={task.id}
          aria-pressed={lifted}
          aria-label={`Reordenar «${task.title}»`}
          onClick={props.onToggleLift}
          onKeyDown={props.onHandleKeyDown}
          onBlur={props.onHandleBlur}
          className="cursor-grab rounded-md border border-slate-300 px-1.5 text-slate-600 hover:bg-slate-100"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <h3 className="min-w-0 flex-1 break-words font-medium">{task.title}</h3>
      </div>

      {task.descriptionMd !== null && (
        <p className="line-clamp-3 whitespace-pre-line break-words text-sm text-slate-600">
          {task.descriptionMd}
        </p>
      )}

      {task.dueOn !== null && (
        <p className={`text-sm ${overdue ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
          {overdue && <span aria-hidden="true">⚠ </span>}
          {overdue ? 'Vencida: ' : 'Fecha límite: '}
          {formatDate(task.dueOn)}
        </p>
      )}

      <p className="text-sm text-slate-600">
        Tiempo: {formatDuration(task.timeSpentSeconds)}
        {task.timerStartedAt !== null && (
          <>
            {' · '}
            <span role="timer" className="font-semibold tabular-nums text-slate-900">
              En marcha {formatDuration(secondsSince(task.timerStartedAt, now))}
            </span>
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={props.onToggleTimer}
          aria-pressed={running}
          className={SMALL_BUTTON}
        >
          <span aria-hidden="true">{running ? '⏹ ' : '⏱ '}</span>
          {running ? 'Parar cronómetro' : 'Iniciar cronómetro'}{' '}
          <span className="sr-only">de «{task.title}»</span>
        </button>
        <button type="button" onClick={props.onOpenTime} className={SMALL_BUTTON}>
          Tiempo <span className="sr-only">de «{task.title}»</span>
        </button>
        <button type="button" onClick={props.onEdit} className={SMALL_BUTTON}>
          Editar <span className="sr-only">«{task.title}»</span>
        </button>
        <button
          type="button"
          onClick={props.onDelete}
          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          Borrar <span className="sr-only">«{task.title}»</span>
        </button>
      </div>

      {/* Alternativa sin arrastrar: sirve con teclado, lector de pantalla y pantalla táctil. */}
      <select
        aria-label={`Mover «${task.title}» a…`}
        value=""
        onChange={(event) => {
          const status = TASK_STATUSES.find((candidate) => candidate === event.target.value);
          if (status !== undefined) props.onMoveTo(status);
        }}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      >
        <option value="">Mover a…</option>
        {TASK_STATUSES.filter((status) => status !== task.status).map((status) => (
          <option key={status} value={status}>
            {COLUMN_LABEL[status]}
          </option>
        ))}
      </select>
    </li>
  );
}
