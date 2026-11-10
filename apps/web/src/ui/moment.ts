/**
 * Instantes mostrados en la hora de Madrid (la zona de los recordatorios, `REMINDER_TIME_ZONE`), con la
 * abreviatura de la zona (CET/CEST) para que se vea qué hora es cuando el reloj se repite en octubre.
 * Se usa `Intl` del navegador: no se añade ninguna dependencia.
 */
import { REMINDER_TIME_ZONE } from '@backoffice/shared';

/** `2026-11-03T09:01:00.000Z` → `03/11/2026, 10:01 CET`. */
export function formatMadridMoment(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: REMINDER_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Ahora en la hora de Madrid como `YYYY-MM-DDTHH:mm` (el formato de `<input type="datetime-local">`),
 * para el atributo `min` del campo. Es solo una ayuda: la API decide si el aviso está en el pasado.
 */
export function madridNowLocal(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
