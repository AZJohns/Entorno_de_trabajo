/**
 * Conversión de una fecha y hora LOCALES de una zona (p. ej. «2027-03-28 02:30 en Madrid») al instante
 * que representan. Lógica pura, sin dependencias: usa `Intl.DateTimeFormat`, que Node trae con los datos
 * de zonas horarias completos (ICU), igual que el navegador.
 *
 * Por qué se hace aquí y no en el navegador: la regla de los cambios de horario debe existir en un solo
 * sitio, probada, y no depender de la zona ni de la versión del navegador de quien escribe el aviso.
 *
 * Una hora local no siempre corresponde a un único instante (Madrid, horas de reloj):
 * - **Hueco** (último domingo de marzo, a las 02:00 se pasa a las 03:00): las 02:00–02:59 NO existen.
 *   No hay instante que sea «02:30». Se rechaza, porque no se puede saber si quería antes o después y
 *   adivinar movería el aviso sin que se note.
 * - **Repetida** (último domingo de octubre, a las 03:00 se vuelve a las 02:00): las 02:00–02:59 ocurren
 *   DOS veces (primero en horario de verano, luego en el de invierno). Se elige la PRIMERA: sí es
 *   respetable literalmente, el aviso nunca llega tarde y es la misma elección que `Temporal` llama
 *   «compatible». Quien necesite la segunda puede pedir 03:00, que es única.
 */

export type LocalResolution =
  | {
      readonly kind: 'ok';
      readonly instant: Date;
      /** La hora ocurre dos veces ese día (fin del horario de verano): se ha elegido la primera. */
      readonly ambiguous: boolean;
    }
  | { readonly kind: 'gap' };

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Desplazamiento de la zona respecto a UTC en ese instante, en ms (Madrid: +3 600 000 en invierno,
 * +7 200 000 en verano). Se obtiene formateando el instante en la zona y comparando la hora de reloj
 * resultante con la UTC.
 */
export function zoneOffsetMs(timeZone: string, instantMs: number): number {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  const wallAsUtc = Date.UTC(
    fields['year'] ?? 0,
    (fields['month'] ?? 1) - 1,
    fields['day'] ?? 1,
    fields['hour'] ?? 0,
    fields['minute'] ?? 0,
    fields['second'] ?? 0,
  );
  // El formateador no da milisegundos: se descartan del instante para comparar segundos enteros.
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Convierte `YYYY-MM-DDTHH:mm` (hora de reloj de `timeZone`) en el instante correspondiente.
 *
 * Método: se prueba con el desplazamiento vigente un día antes y un día después (entre los dos queda
 * cualquier cambio de horario, que nunca están a menos de semanas). Un candidato vale si, en ese
 * instante, la zona de verdad tiene ese desplazamiento. Ninguno vale → hueco; uno → único; dos → hora
 * repetida.
 *
 * @param local Texto ya validado como fecha existente (`isLocalDateTime` de `@backoffice/shared`).
 * @throws {RangeError} si el texto no tiene el formato o la zona no existe.
 */
export function resolveLocalDateTime(local: string, timeZone: string): LocalResolution {
  const match = LOCAL_DATE_TIME.exec(local);
  if (match === null) throw new RangeError('Fecha y hora locales no válidas');
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  const offsets = new Set([
    zoneOffsetMs(timeZone, wallAsUtc - DAY_MS),
    zoneOffsetMs(timeZone, wallAsUtc + DAY_MS),
  ]);
  const candidates = [...offsets]
    .map((offset) => ({ offset, instantMs: wallAsUtc - offset }))
    .filter(({ offset, instantMs }) => zoneOffsetMs(timeZone, instantMs) === offset)
    .map(({ instantMs }) => instantMs);

  if (candidates.length === 0) return { kind: 'gap' };
  return {
    kind: 'ok',
    instant: new Date(Math.min(...candidates)),
    ambiguous: candidates.length > 1,
  };
}
