/**
 * Reloj inyectable: los servicios no llaman a `new Date()` directamente, para que los tests puedan
 * simular el paso del tiempo (caducidad de 24 h, bloqueo a 1 h) sin esperar.
 */
export interface Clock {
  now(): Date;
}

/** Reloj real del sistema. */
export const systemClock: Clock = { now: () => new Date() };
