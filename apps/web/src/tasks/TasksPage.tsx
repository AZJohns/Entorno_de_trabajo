/**
 * Tablero de tareas: cuatro columnas, alta/edición/borrado, mover con ratón (arrastrar), teclado
 * (asa «Reordenar») o menú «Mover a…», cronómetro y tiempo dedicado. Ver `README.md` de esta carpeta.
 */
import { TASK_STATUSES, type TaskResponse, type TaskStatus } from '@backoffice/shared';
import { Fragment, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { todayLocal } from '../finance/dates.ts';
import { ConfirmBar, ProblemNotice } from '../ui/finance-forms.tsx';
import { Button, ErrorMessage, Loading } from '../ui/forms.tsx';
import {
  COLUMN_LABEL,
  DONE_PAGE_SIZE,
  findTask,
  formatDuration,
  isOverdue,
  locate,
  moveInColumns,
  recentDone,
  runningTask,
} from './boardLogic.ts';
import { TaskCard } from './TaskCard.tsx';
import { TaskForm } from './TaskForm.tsx';
import {
  moveErrorText,
  timeErrorText,
  timerRunningText,
  useBoard,
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  useStartTimer,
  useStopTimer,
  useUpdateTask,
} from './queries.ts';
import { TimePanel } from './TimePanel.tsx';

type Mode =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; task: TaskResponse }
  | { kind: 'time'; taskId: string };

/** Tarjeta «cogida» con el teclado: dónde está ahora (el índice no cuenta la propia tarjeta). */
interface Lift {
  id: string;
  status: TaskStatus;
  index: number;
}

/** Al soltar en «Terminado» siempre va al final: allí se ordena por fecha de cierre, no a mano. */
const END = Number.MAX_SAFE_INTEGER;

/** Instante actual; solo avanza cada segundo mientras hay un cronómetro en marcha. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function TasksPage() {
  const board = useBoard();
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const move = useMoveTask();
  const start = useStartTimer();
  const stop = useStopTimer();

  const [mode, setMode] = useState<Mode>({ kind: 'none' });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ status: TaskStatus; index: number } | null>(null);
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState('');

  const columns = board.data ?? [];
  const running = runningTask(columns);
  const now = useNow(running !== undefined);
  const today = todayLocal();

  const opener = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const focusHandle = useRef<string | null>(null);
  const liftRef = useRef<Lift | null>(null);
  useEffect(() => {
    liftRef.current = lift;
  }, [lift]);

  // Al pasar la tarjeta a otra columna, React crea un asa nueva: el foco se devuelve a ella para que
  // el teclado siga donde estaba.
  useEffect(() => {
    const id = focusHandle.current;
    if (id === null) return;
    document.querySelector<HTMLElement>(`[data-handle="${id}"]`)?.focus();
    if (liftRef.current === null) focusHandle.current = null;
  });

  function announce(text: string): void {
    setAnnouncement(text);
  }

  function openForm(next: Mode): void {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    create.reset();
    update.reset();
    setMode(next);
  }

  function closeForm(): void {
    setMode({ kind: 'none' });
    create.reset();
    update.reset();
    const target = opener.current?.isConnected === true ? opener.current : newButton.current;
    queueMicrotask(() => target?.focus());
  }

  // --- mover -------------------------------------------------------------------------------------

  /** Pide el movimiento. El tablero ya cambia al instante; si el servidor lo rechaza, se deshace. */
  function commitMove(id: string, status: TaskStatus, index: number): void {
    const task = findTask(columns, id);
    const from = locate(columns, id);
    if (task === undefined || from === undefined) return;
    const unchanged = from.status === status && (status === 'done' || from.index === index);
    if (unchanged) {
      announce(`«${task.title}» se queda donde estaba`);
      return;
    }
    setProblem('');
    move.mutate(
      { id, status, index: status === 'done' ? END : index },
      {
        onSuccess: () => announce(`«${task.title}» movida a ${COLUMN_LABEL[status]}`),
        onError: (error) => {
          const text = moveErrorText(error);
          setProblem(text);
          announce(text);
        },
      },
    );
  }

  /** Cuántas tareas hay en `status` sin contar la tarea `id`. */
  function countWithout(status: TaskStatus, id: string): number {
    return (columns.find((column) => column.status === status)?.tasks ?? []).filter(
      (task) => task.id !== id,
    ).length;
  }

  function describe(task: TaskResponse, next: Lift): string {
    const total = countWithout(next.status, task.id) + 1;
    const where =
      next.status === 'done'
        ? 'la más reciente'
        : `posición ${String(next.index + 1)} de ${String(total)}`;
    return `«${task.title}»: ${COLUMN_LABEL[next.status]}, ${where}`;
  }

  function toggleLift(task: TaskResponse): void {
    if (lift?.id === task.id) {
      // Soltar: se pide el movimiento y el foco se queda en el asa.
      focusHandle.current = task.id;
      setLift(null);
      commitMove(task.id, lift.status, lift.index);
      return;
    }
    const from = locate(columns, task.id);
    if (from === undefined) return;
    focusHandle.current = task.id;
    setLift({ id: task.id, ...from });
    announce(
      `«${task.title}» cogida en ${COLUMN_LABEL[from.status]}. Flechas para moverla, Espacio para soltarla, Escape para cancelar.`,
    );
  }

  function cancelLift(task: TaskResponse): void {
    focusHandle.current = task.id;
    setLift(null);
    announce(`Movimiento de «${task.title}» cancelado`);
  }

  function handleKey(task: TaskResponse, event: KeyboardEvent<HTMLButtonElement>): void {
    if (lift?.id !== task.id) return;
    const statusIndex = TASK_STATUSES.indexOf(lift.status);
    let next: Lift | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const target = TASK_STATUSES[statusIndex + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (target !== undefined) {
        const size = countWithout(target, task.id);
        next = {
          id: task.id,
          status: target,
          index: target === 'done' ? size : Math.min(lift.index, size),
        };
      }
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && lift.status !== 'done') {
      const size = countWithout(lift.status, task.id);
      const index = Math.max(0, Math.min(size, lift.index + (event.key === 'ArrowUp' ? -1 : 1)));
      next = { ...lift, index };
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelLift(task);
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (next !== null) {
      setLift(next);
      announce(describe(task, next));
    }
  }

  /** Si el foco sale del asa sin que la tarjeta cambie de columna, se cancela lo que estaba cogido. */
  function handleBlur(task: TaskResponse): void {
    requestAnimationFrame(() => {
      const current = liftRef.current;
      if (current?.id !== task.id) return;
      if (document.activeElement?.getAttribute('data-handle') === task.id) return;
      setLift(null);
      announce(`Movimiento de «${task.title}» cancelado`);
    });
  }

  // --- arrastrar con el ratón --------------------------------------------------------------------

  function setDropTarget(status: TaskStatus, index: number): void {
    setDrop((current) =>
      current?.status === status && current.index === index ? current : { status, index },
    );
  }

  function cardDragOver(task: TaskResponse, event: DragEvent<HTMLLIElement>): void {
    if (dragId === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (task.status === 'done') {
      setDropTarget('done', END);
      return;
    }
    const others = (columns.find((column) => column.status === task.status)?.tasks ?? []).filter(
      (candidate) => candidate.id !== dragId,
    );
    const at = others.findIndex((candidate) => candidate.id === task.id);
    if (at === -1) return; // sobre sí misma
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setDropTarget(task.status, before ? at : at + 1);
  }

  function columnDrop(status: TaskStatus, event: DragEvent): void {
    event.preventDefault();
    const id = dragId;
    const target = drop?.status === status ? drop.index : END;
    setDragId(null);
    setDrop(null);
    if (id !== null) commitMove(id, status, target);
  }

  // --- cronómetro --------------------------------------------------------------------------------

  function toggleTimer(task: TaskResponse): void {
    setProblem('');
    if (task.timerStartedAt !== null) {
      stop.mutate(task.id, {
        onSuccess: (entry) =>
          announce(
            `Cronómetro parado en «${task.title}»: ${formatDuration(entry.durationSeconds)} más`,
          ),
        onError: (error) => setProblem(timeErrorText(error, 'stop')),
      });
      return;
    }
    if (running !== undefined && running.id !== task.id) {
      const text = timerRunningText(running.title);
      setProblem(text);
      announce(text);
      return;
    }
    start.mutate(task.id, {
      onSuccess: () => announce(`Cronómetro iniciado en «${task.title}»`),
      onError: (error) => {
        const text = timeErrorText(error, 'start', runningTask(columns)?.title);
        setProblem(text);
        announce(text);
      },
    });
  }

  // --- pintado -----------------------------------------------------------------------------------

  const view = lift === null ? columns : moveInColumns(columns, lift.id, lift.status, lift.index);
  const timePanelTask = mode.kind === 'time' ? findTask(columns, mode.taskId) : undefined;
  const deleteTarget = deleting === null ? undefined : findTask(columns, deleting);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Tareas</h1>
        <button
          ref={newButton}
          type="button"
          onClick={() => openForm({ kind: 'create' })}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Nueva tarea
        </button>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {problem !== '' && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {problem}
        </p>
      )}

      {mode.kind === 'create' && (
        <TaskForm
          onCreate={(request) => create.mutate(request, { onSuccess: closeForm })}
          onUpdate={() => undefined}
          onCancel={closeForm}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {mode.kind === 'edit' && (
        <TaskForm
          task={mode.task}
          onCreate={() => undefined}
          onUpdate={(task, body) => update.mutate({ id: task.id, body }, { onSuccess: closeForm })}
          onCancel={closeForm}
          pending={update.isPending}
          error={update.error}
        />
      )}
      {timePanelTask !== undefined && (
        <TimePanel task={timePanelTask} now={now} onClose={closeForm} />
      )}

      {board.isPending && <Loading />}
      <ErrorMessage error={board.error} />

      {board.isSuccess && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {view.map((column) => {
            const status = column.status;
            const isDone = status === 'done';
            const shown = isDone ? recentDone(column.tasks, doneLimit) : column.tasks;
            const hidden = column.tasks.length - shown.length;
            const marker = drop?.status === status && dragId !== null ? drop.index : null;
            const others = shown.filter((task) => task.id !== dragId);
            return (
              <section
                key={status}
                aria-labelledby={`column-${status}`}
                onDragOver={(event) => {
                  if (dragId === null) return;
                  event.preventDefault();
                  setDropTarget(status, END);
                }}
                onDrop={(event) => columnDrop(status, event)}
                className={`flex min-h-24 flex-col gap-2 rounded-lg bg-slate-100 p-2 ${
                  marker === null ? '' : 'ring-2 ring-slate-500'
                }`}
              >
                <h2 id={`column-${status}`} className="px-1 font-semibold">
                  {COLUMN_LABEL[status]}{' '}
                  <span className="font-normal text-slate-500">({column.tasks.length})</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {shown.map((task) => {
                    const slot = others.findIndex((candidate) => candidate.id === task.id);
                    return (
                      <Fragment key={task.id}>
                        {marker !== null && !isDone && slot === marker && (
                          <li aria-hidden="true" className="h-1 rounded bg-slate-700" />
                        )}
                        <TaskCard
                          task={task}
                          overdue={isOverdue(task, today)}
                          now={now}
                          lifted={lift?.id === task.id}
                          dragging={dragId === task.id}
                          onToggleLift={() => toggleLift(task)}
                          onHandleKeyDown={(event) => handleKey(task, event)}
                          onHandleBlur={() => handleBlur(task)}
                          onMoveTo={(target) => commitMove(task.id, target, END)}
                          onToggleTimer={() => toggleTimer(task)}
                          onOpenTime={() => openForm({ kind: 'time', taskId: task.id })}
                          onEdit={() => openForm({ kind: 'edit', task })}
                          onDelete={() => {
                            remove.reset();
                            setDeleting(task.id);
                          }}
                          onDragStart={(event) => {
                            setDragId(task.id);
                            event.dataTransfer.setData('text/plain', task.id);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDrop(null);
                          }}
                          onDragOver={(event) => cardDragOver(task, event)}
                        />
                        {deleting === task.id && deleteTarget !== undefined && (
                          <li className="flex flex-col gap-2">
                            <ConfirmBar
                              message={`¿Borrar «${task.title}»? También se borra el tiempo dedicado (${formatDuration(task.timeSpentSeconds)}). No se puede deshacer.`}
                              confirmLabel="Borrar tarea"
                              pending={remove.isPending}
                              onConfirm={() =>
                                remove.mutate(task.id, {
                                  onSuccess: () => {
                                    setDeleting(null);
                                    announce(`Tarea «${task.title}» borrada`);
                                    newButton.current?.focus();
                                  },
                                })
                              }
                              onCancel={() => setDeleting(null)}
                            />
                            <ProblemNotice error={remove.error} />
                          </li>
                        )}
                      </Fragment>
                    );
                  })}
                  {marker !== null && !isDone && marker >= others.length && (
                    <li aria-hidden="true" className="h-1 rounded bg-slate-700" />
                  )}
                </ul>
                {column.tasks.length === 0 && (
                  <p className="px-1 text-sm text-slate-500">Sin tareas.</p>
                )}
                {isDone && hidden > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setDoneLimit((limit) => limit + DONE_PAGE_SIZE);
                      announce(`Se muestran más tareas terminadas`);
                    }}
                  >
                    Ver más ({hidden} más antiguas)
                  </Button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
