/** Lógica pura del tablero de tareas: colocación, petición de movimiento, vencidas, tiempo manual. */
import type { TaskColumnResponse, TaskResponse, TaskStatus } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import {
  buildManualTime,
  formatDuration,
  isOverdue,
  moveInColumns,
  moveRequest,
  recentDone,
  samePlacement,
} from '../src/tasks/boardLogic.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function task(n: number, status: TaskStatus, extra: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: id(n),
    title: `Tarea ${String(n)}`,
    descriptionMd: null,
    status,
    position: 0,
    dueOn: null,
    completedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    timeSpentSeconds: 0,
    timerStartedAt: null,
    ...extra,
  };
}

const board = (): TaskColumnResponse[] => [
  { status: 'todo', tasks: [task(1, 'todo'), task(2, 'todo'), task(3, 'todo')] },
  { status: 'in_progress', tasks: [task(4, 'in_progress')] },
  { status: 'testing', tasks: [] },
  { status: 'done', tasks: [] },
];

const ids = (columns: TaskColumnResponse[], status: TaskStatus) =>
  columns.find((c) => c.status === status)?.tasks.map((t) => t.id);

describe('moveInColumns', () => {
  it('mueve entre columnas sin tocar el tablero de entrada', () => {
    const before = board();
    const after = moveInColumns(before, id(2), 'in_progress', 0);
    expect(ids(after, 'todo')).toEqual([id(1), id(3)]);
    expect(ids(after, 'in_progress')).toEqual([id(2), id(4)]);
    expect(after.find((c) => c.status === 'in_progress')?.tasks[0]?.status).toBe('in_progress');
    expect(ids(before, 'todo')).toEqual([id(1), id(2), id(3)]);
  });

  it('reordena dentro de la columna contando el índice sin la propia tarea', () => {
    expect(ids(moveInColumns(board(), id(1), 'todo', 2), 'todo')).toEqual([id(2), id(3), id(1)]);
    expect(ids(moveInColumns(board(), id(3), 'todo', 0), 'todo')).toEqual([id(3), id(1), id(2)]);
  });

  it('un índice fuera de rango la deja al final', () => {
    expect(ids(moveInColumns(board(), id(1), 'in_progress', 99), 'in_progress')).toEqual([
      id(4),
      id(1),
    ]);
  });
});

describe('moveRequest', () => {
  it('detrás de la tarea anterior, delante de la siguiente si es la primera, o al final', () => {
    expect(moveRequest(board(), id(1), 'todo', 2)).toEqual({ status: 'todo', afterId: id(3) });
    expect(moveRequest(board(), id(3), 'todo', 0)).toEqual({ status: 'todo', beforeId: id(1) });
    expect(moveRequest(board(), id(1), 'testing', 0)).toEqual({ status: 'testing' });
  });

  it('nunca usa la propia tarea como referencia', () => {
    // Tras mover de forma optimista, la tarea ya está en la columna de destino.
    const moved = moveInColumns(board(), id(2), 'in_progress', 1);
    expect(moveRequest(moved, id(2), 'in_progress', 1)).toEqual({
      status: 'in_progress',
      afterId: id(4),
    });
  });
});

describe('samePlacement', () => {
  it('detecta si algo cambia de sitio', () => {
    expect(samePlacement(board(), board())).toBe(true);
    expect(samePlacement(board(), moveInColumns(board(), id(1), 'todo', 1))).toBe(false);
  });
});

describe('isOverdue', () => {
  it('vence si la fecha es anterior a hoy y no está terminada', () => {
    const today = '2026-11-09';
    expect(isOverdue({ dueOn: '2026-11-08', status: 'todo' }, today)).toBe(true);
    expect(isOverdue({ dueOn: '2026-11-09', status: 'todo' }, today)).toBe(false);
    expect(isOverdue({ dueOn: '2026-11-10', status: 'in_progress' }, today)).toBe(false);
    expect(isOverdue({ dueOn: null, status: 'todo' }, today)).toBe(false);
    expect(isOverdue({ dueOn: '2020-01-01', status: 'done' }, today)).toBe(false);
  });
});

describe('recentDone', () => {
  it('ordena por cierre, las más recientes primero, y corta; sin fecha cuenta como la más reciente', () => {
    const tasks = [
      task(1, 'done', { completedAt: '2026-11-01T10:00:00.000Z' }),
      task(2, 'done', { completedAt: '2026-11-03T10:00:00.000Z' }),
      task(3, 'done', { completedAt: '2026-11-02T10:00:00.000Z' }),
      task(4, 'done'),
    ];
    expect(recentDone(tasks, 3).map((t) => t.id)).toEqual([id(4), id(2), id(3)]);
  });
});

describe('formatDuration', () => {
  it('da horas, minutos y segundos', () => {
    expect(formatDuration(5)).toBe('5 s');
    expect(formatDuration(125)).toBe('2 min 05 s');
    expect(formatDuration(3725)).toBe('1 h 02 min 05 s');
  });
});

describe('buildManualTime', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');
  const base = { mode: 'duration', hours: '', minutes: '', start: '', end: '' } as const;

  it('la duración se anota como terminada ahora', () => {
    const result = buildManualTime({ ...base, hours: '1', minutes: '30' }, now);
    expect(result).toEqual({
      ok: true,
      startedAt: '2026-11-09T10:30:00.000Z',
      durationSeconds: 5400,
    });
  });

  it('rechaza duración vacía, no entera o de más de 7 días', () => {
    expect(buildManualTime(base, now).ok).toBe(false);
    expect(buildManualTime({ ...base, minutes: '1,5' }, now).ok).toBe(false);
    expect(buildManualTime({ ...base, hours: '169' }, now).ok).toBe(false);
  });

  it('inicio y fin: exige los dos, el fin posterior y máximo 7 días', () => {
    const range = { ...base, mode: 'range' } as const;
    expect(buildManualTime({ ...range, start: '2026-11-09T09:00' }, now).ok).toBe(false);
    expect(
      buildManualTime({ ...range, start: '2026-11-09T09:00', end: '2026-11-09T09:00' }, now).ok,
    ).toBe(false);
    expect(
      buildManualTime({ ...range, start: '2026-11-01T09:00', end: '2026-11-09T09:00' }, now).ok,
    ).toBe(false);
    const ok = buildManualTime(
      { ...range, start: '2026-11-09T09:00', end: '2026-11-09T10:15' },
      now,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(Date.parse(ok.endedAt ?? '') - Date.parse(ok.startedAt)).toBe(75 * 60 * 1000);
    }
  });
});
