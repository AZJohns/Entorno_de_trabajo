import type { Clock } from '../../src/lib/clock.ts';

/** Reloj simulado: los tests avanzan el tiempo sin esperar. */
export class FakeClock implements Clock {
  #now: number;

  constructor(start = new Date('2026-11-03T09:00:00Z')) {
    this.#now = start.getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}
