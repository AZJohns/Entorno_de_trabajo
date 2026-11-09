import { describe, expect, it } from 'vitest';
import {
  MAX_MANUAL_ENTRY_SECONDS,
  createTaskRequestSchema,
  createTimeEntryRequestSchema,
  moveTaskRequestSchema,
  updateTaskRequestSchema,
} from '../src/index.ts';

const ID = '00000000-0000-4000-8000-000000000001';

describe('esquemas de tareas', () => {
  it('el alta recorta el título, usa «Por hacer» por defecto y vacía la descripción en blanco', () => {
    expect(createTaskRequestSchema.parse({ title: '  Revisar  ', descriptionMd: ' ' })).toEqual({
      title: 'Revisar',
      descriptionMd: null,
      status: 'todo',
    });
  });

  it('rechaza campos que el cliente no debe fijar (posición, fechas de sistema)', () => {
    for (const extra of [{ position: 0 }, { completedAt: '2026-11-03T09:00:00Z' }, { id: ID }]) {
      expect(createTaskRequestSchema.safeParse({ title: 'A', ...extra }).success).toBe(false);
    }
  });

  it('la edición no admite la columna y exige algún campo', () => {
    expect(updateTaskRequestSchema.safeParse({ status: 'done' }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ dueOn: null }).success).toBe(true);
  });

  it('mover admite beforeId o afterId, no los dos', () => {
    expect(moveTaskRequestSchema.safeParse({ status: 'done' }).success).toBe(true);
    expect(moveTaskRequestSchema.safeParse({ status: 'done', beforeId: ID }).success).toBe(true);
    expect(moveTaskRequestSchema.safeParse({ status: 'done', afterId: ID }).success).toBe(true);
    expect(
      moveTaskRequestSchema.safeParse({ status: 'done', beforeId: ID, afterId: ID }).success,
    ).toBe(false);
  });
});

describe('anotación manual de tiempo', () => {
  const start = '2026-11-03T07:00:00Z';

  it('admite fin o duración, uno de los dos', () => {
    expect(
      createTimeEntryRequestSchema.safeParse({ startedAt: start, durationSeconds: 60 }).success,
    ).toBe(true);
    expect(
      createTimeEntryRequestSchema.safeParse({ startedAt: start, endedAt: '2026-11-03T08:00:00Z' })
        .success,
    ).toBe(true);
    expect(createTimeEntryRequestSchema.safeParse({ startedAt: start }).success).toBe(false);
    expect(
      createTimeEntryRequestSchema.safeParse({
        startedAt: start,
        endedAt: '2026-11-03T08:00:00Z',
        durationSeconds: 60,
      }).success,
    ).toBe(false);
  });

  it('el fin debe ser posterior al inicio, comparando instantes y no textos', () => {
    const parse = (startedAt: string, endedAt: string) =>
      createTimeEntryRequestSchema.safeParse({ startedAt, endedAt }).success;
    expect(parse(start, start)).toBe(false);
    expect(parse(start, '2026-11-03T06:59:59Z')).toBe(false);
    // 10:00+02:00 = 08:00Z: el texto «08:30Z» es menor, pero el instante es posterior.
    expect(parse('2026-11-03T10:00:00+02:00', '2026-11-03T08:30:00Z')).toBe(true);
  });

  it('el tope de 7 días se aplica a la duración y al par inicio-fin', () => {
    const ok = createTimeEntryRequestSchema.safeParse({
      startedAt: start,
      durationSeconds: MAX_MANUAL_ENTRY_SECONDS,
    });
    const tooLong = createTimeEntryRequestSchema.safeParse({
      startedAt: start,
      durationSeconds: MAX_MANUAL_ENTRY_SECONDS + 1,
    });
    expect(ok.success).toBe(true);
    expect(tooLong.success).toBe(false);
    expect(
      createTimeEntryRequestSchema.safeParse({ startedAt: start, endedAt: '2026-11-11T07:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('exige zona horaria y rechaza fechas anteriores a 1970', () => {
    expect(
      createTimeEntryRequestSchema.safeParse({
        startedAt: '2026-11-03T07:00:00',
        durationSeconds: 60,
      }).success,
    ).toBe(false);
    expect(
      createTimeEntryRequestSchema.safeParse({
        startedAt: '1969-12-31T23:59:59Z',
        durationSeconds: 60,
      }).success,
    ).toBe(false);
  });
});
