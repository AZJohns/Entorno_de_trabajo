/**
 * Planificador por sondeo (`startScheduler`): primer ciclo inmediato, un ciclo cada intervalo, sin
 * solaparse, un trabajo que falla no detiene los demás ni los ciclos siguientes, y `stop` espera al ciclo
 * en curso. Con temporizadores simulados: no espera de verdad.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runJobsOnce, startScheduler, type Job } from '../../src/jobs/scheduler.ts';
import { captureLogger } from '../helpers.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startScheduler', () => {
  it('ejecuta un ciclo al arrancar y otro cada intervalo', async () => {
    const { logger } = captureLogger();
    const run = vi.fn(() => Promise.resolve());
    const scheduler = startScheduler({ jobs: [{ name: 'a', run }], intervalMs: 60_000, logger });

    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(4);
    await scheduler.stop();
  });

  it('no empieza un ciclo mientras el anterior sigue en curso', async () => {
    const { logger } = captureLogger();
    let release!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const scheduler = startScheduler({ jobs: [{ name: 'lento', run }], intervalMs: 1000, logger });

    await vi.advanceTimersByTimeAsync(10_000); // pasan 10 intervalos con el primer ciclo atascado
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await scheduler.stop();
  });

  it('un trabajo que falla se registra y no impide los demás ni los ciclos siguientes', async () => {
    const { logger, lines } = captureLogger();
    const bad: Job = { name: 'malo', run: () => Promise.reject(new Error('fallo simulado')) };
    const good = vi.fn(() => Promise.resolve());
    const scheduler = startScheduler({
      jobs: [bad, { name: 'bueno', run: good }],
      intervalMs: 1000,
      logger,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(good).toHaveBeenCalledTimes(2);
    expect(lines().filter((line) => line['job'] === 'malo')).toHaveLength(2);
    await scheduler.stop();
  });

  it('stop espera al ciclo en curso y no programa más', async () => {
    const { logger } = captureLogger();
    let release!: () => void;
    let finished = false;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            finished = true;
            resolve();
          };
        }),
    );
    const scheduler = startScheduler({ jobs: [{ name: 'lento', run }], intervalMs: 1000, logger });
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scheduler.stop().then(() => finished);
    release();
    expect(await stopping).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('runJobsOnce', () => {
  it('nunca lanza aunque falle un trabajo', async () => {
    const { logger } = captureLogger();
    await expect(
      runJobsOnce([{ name: 'malo', run: () => Promise.reject(new Error('x')) }], logger),
    ).resolves.toBeUndefined();
  });
});
