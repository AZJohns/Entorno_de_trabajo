/**
 * Cálculo del tiempo dedicado: lógica pura, sin E/S (docs/plan.md §2.6).
 *
 * El tiempo no se guarda: cada entrada es un intervalo `[inicio, fin)` y los totales se calculan al leer.
 * Un intervalo sin fin es el cronómetro en marcha y cuenta hasta «ahora». La unidad es el segundo
 * entero, redondeado **hacia abajo** en cada entrada: así el total de una tarea es exactamente la suma
 * de las duraciones que se muestran en su lista.
 */

/** Segundos enteros de un intervalo; si no tiene fin, hasta `now`. Nunca negativo. */
export function elapsedSeconds(startedAt: Date, endedAt: Date | null, now: Date): number {
  const end = endedAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - startedAt.getTime()) / 1000));
}

/**
 * Tiempo total de una tarea: los segundos de sus entradas cerradas más lo que lleva el cronómetro en
 * marcha, si lo hay.
 */
export function totalSeconds(closedSeconds: number, runningSince: Date | null, now: Date): number {
  return closedSeconds + (runningSince === null ? 0 : elapsedSeconds(runningSince, null, now));
}

/**
 * Fin con el que se cierra un cronómetro. La base de datos exige `fin > inicio`; si el reloj no ha
 * avanzado (paradas en el mismo milisegundo) o ha retrocedido, se usa `inicio + 1 ms` en vez de
 * rechazar la parada: un cronómetro que no se puede parar es peor que un milisegundo de más.
 */
export function stopInstant(startedAt: Date, now: Date): Date {
  return now.getTime() > startedAt.getTime() ? now : new Date(startedAt.getTime() + 1);
}
