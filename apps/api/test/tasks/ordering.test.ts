/** Orden del tablero (domain/ordering.ts) y tiempo dedicado (domain/time.ts): lógica pura. */
import { describe, expect, it } from 'vitest';
import {
  emptyColumns,
  placeTask,
  placementChanges,
  removeTask,
  type Columns,
} from '../../src/modules/tasks/domain/ordering.ts';
import { elapsedSeconds, stopInstant, totalSeconds } from '../../src/modules/tasks/domain/time.ts';

const board = (parts: Partial<Record<keyof Columns, string[]>>): Columns => ({
  ...emptyColumns(),
  ...parts,
});

describe('placeTask', () => {
  const columns = board({ todo: ['a', 'b', 'c'], in_progress: ['x', 'y'] });

  it('sin ancla, al final de la columna', () => {
    expect(placeTask(columns, 'a', 'todo')).toEqual({
      ok: true,
      columns: board({ todo: ['b', 'c', 'a'], in_progress: ['x', 'y'] }),
    });
  });

  it('delante y detrás de una tarea de la misma columna', () => {
    expect(placeTask(columns, 'c', 'todo', { kind: 'before', taskId: 'a' })).toMatchObject({
      columns: { todo: ['c', 'a', 'b'] },
    });
    expect(placeTask(columns, 'a', 'todo', { kind: 'after', taskId: 'b' })).toMatchObject({
      columns: { todo: ['b', 'a', 'c'] },
    });
  });

  it('dejarla donde estaba no cambia nada (el ancla se busca sin la tarea movida)', () => {
    expect(placeTask(columns, 'b', 'todo', { kind: 'after', taskId: 'a' })).toEqual({
      ok: true,
      columns,
    });
    expect(placeTask(columns, 'b', 'todo', { kind: 'before', taskId: 'c' })).toEqual({
      ok: true,
      columns,
    });
  });

  it('entre columnas: sale de la de origen, que se cierra, y entra en la de destino', () => {
    expect(placeTask(columns, 'b', 'in_progress', { kind: 'before', taskId: 'y' })).toEqual({
      ok: true,
      columns: board({ todo: ['a', 'c'], in_progress: ['x', 'b', 'y'] }),
    });
  });

  it('a una columna vacía', () => {
    expect(placeTask(columns, 'a', 'done')).toMatchObject({
      columns: { todo: ['b', 'c'], done: ['a'] },
    });
  });

  it('rechaza como ancla la propia tarea o una que no está en la columna de destino', () => {
    expect(placeTask(columns, 'a', 'todo', { kind: 'before', taskId: 'a' })).toEqual({
      ok: false,
      reason: 'anchor_is_task',
    });
    expect(placeTask(columns, 'a', 'todo', { kind: 'before', taskId: 'x' })).toEqual({
      ok: false,
      reason: 'anchor_not_in_column',
    });
    expect(placeTask(columns, 'a', 'todo', { kind: 'after', taskId: 'no-existe' })).toEqual({
      ok: false,
      reason: 'anchor_not_in_column',
    });
  });

  it('no modifica el tablero de entrada', () => {
    placeTask(columns, 'a', 'in_progress');
    expect(columns).toEqual(board({ todo: ['a', 'b', 'c'], in_progress: ['x', 'y'] }));
  });
});

describe('placementChanges', () => {
  const before = board({ todo: ['a', 'b', 'c'], in_progress: ['x'] });

  it('sin cambios, nada que escribir', () => {
    expect(placementChanges(before, before)).toEqual([]);
  });

  it('solo las tareas que cambian de columna o de posición', () => {
    const moved = placeTask(before, 'c', 'todo', { kind: 'before', taskId: 'b' });
    if (!moved.ok) throw new Error('movimiento válido');
    expect(placementChanges(before, moved.columns)).toEqual([
      { id: 'c', status: 'todo', position: 1 },
      { id: 'b', status: 'todo', position: 2 },
    ]);
  });

  it('al cambiar de columna renumera la de origen y escribe la tarea en la de destino', () => {
    const moved = placeTask(before, 'a', 'in_progress');
    if (!moved.ok) throw new Error('movimiento válido');
    // «x» conserva su posición 0 y no se reescribe.
    expect(placementChanges(before, moved.columns)).toEqual([
      { id: 'b', status: 'todo', position: 0 },
      { id: 'c', status: 'todo', position: 1 },
      { id: 'a', status: 'in_progress', position: 1 },
    ]);
  });
});

describe('removeTask', () => {
  it('quita la tarea y deja las demás en su orden', () => {
    expect(removeTask(board({ todo: ['a', 'b', 'c'] }), 'b')).toEqual(board({ todo: ['a', 'c'] }));
  });
});

describe('tiempo dedicado', () => {
  const at = (iso: string): Date => new Date(iso);

  it('elapsedSeconds redondea hacia abajo y nunca es negativo', () => {
    const later = at('2030-01-01T00:00:00Z');
    expect(
      elapsedSeconds(at('2026-11-03T09:00:00.000Z'), at('2026-11-03T09:00:01.999Z'), later),
    ).toBe(1);
    expect(elapsedSeconds(at('2026-11-03T09:00:10Z'), null, at('2026-11-03T09:01:10Z'))).toBe(60);
    expect(elapsedSeconds(at('2026-11-03T09:00:10Z'), null, at('2026-11-03T09:00:00Z'))).toBe(0);
  });

  it('totalSeconds suma lo cerrado y lo que lleva el cronómetro en marcha', () => {
    const now = at('2026-11-03T10:00:00Z');
    expect(totalSeconds(120, null, now)).toBe(120);
    expect(totalSeconds(120, at('2026-11-03T09:59:00Z'), now)).toBe(180);
    expect(totalSeconds(0, null, now)).toBe(0);
  });

  it('stopInstant nunca devuelve un fin que no sea posterior al inicio', () => {
    const start = at('2026-11-03T09:00:00.000Z');
    const plusOneMs = at('2026-11-03T09:00:00.001Z');
    expect(stopInstant(start, at('2026-11-03T09:00:05.000Z'))).toEqual(
      at('2026-11-03T09:00:05.000Z'),
    );
    expect(stopInstant(start, start)).toEqual(plusOneMs);
    expect(stopInstant(start, at('2026-11-03T08:00:00.000Z'))).toEqual(plusOneMs);
  });
});
