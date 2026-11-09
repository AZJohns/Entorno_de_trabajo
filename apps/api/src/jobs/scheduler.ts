/**
 * Planificador por sondeo: ejecuta una lista de trabajos cada cierto tiempo dentro del propio proceso
 * de la API (docs/plan.md §7: sin dependencia; el estado vive en PostgreSQL, no en memoria).
 *
 * - Un ciclo no empieza hasta que termina el anterior (el siguiente se programa al acabar), así que
 *   nunca se solapan ni se acumulan si la base de datos va lenta.
 * - El primer ciclo es inmediato: tras un reinicio se recuperan enseguida los avisos que vencieron
 *   mientras la API estaba parada.
 * - Un trabajo que falla se registra y no impide los demás ni los ciclos siguientes. Los trabajos son
 *   responsables de ser idempotentes: el planificador puede ejecutarse en dos procesos a la vez.
 * - `stop()` espera al ciclo en curso para poder cerrar la base de datos después sin cortarlo.
 */
import type { Logger } from 'pino';

export interface Job {
  /** Nombre para los logs. */
  readonly name: string;
  run(): Promise<unknown>;
}

export interface Scheduler {
  /** Deja de programar ciclos y espera a que termine el que esté en curso. */
  stop(): Promise<void>;
}

/** Ejecuta cada trabajo una vez, en orden, registrando los fallos. Nunca lanza. */
export async function runJobsOnce(jobs: readonly Job[], logger: Logger): Promise<void> {
  for (const job of jobs) {
    try {
      await job.run();
    } catch (error) {
      logger.error({ err: error, job: job.name }, 'Falló un trabajo programado');
    }
  }
}

/** Arranca el planificador. El primer ciclo es inmediato y los siguientes, cada `intervalMs`. */
export function startScheduler(options: {
  readonly jobs: readonly Job[];
  readonly intervalMs: number;
  readonly logger: Logger;
}): Scheduler {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = runJobsOnce(options.jobs, options.logger).finally(() => {
        schedule(options.intervalMs);
      });
    }, delayMs);
  };
  schedule(0);

  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await running;
    },
  };
}
