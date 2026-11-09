/**
 * Conversión de la hora local de Madrid a un instante (`resolveLocalDateTime`) y validación del texto
 * (`isLocalDateTime`). Función pura: no necesita base de datos. Cubre los dos cambios de horario del año
 * en 2026 y 2027 y una zona sin horario de verano.
 *
 * Madrid: el último domingo de marzo, a las 02:00 (CET, UTC+1) se pasa a las 03:00 (CEST, UTC+2); el
 * último domingo de octubre, a las 03:00 (CEST) se vuelve a las 02:00 (CET).
 */
import { describe, expect, it } from 'vitest';
import { REMINDER_TIME_ZONE, isLocalDateTime } from '@backoffice/shared';
import { resolveLocalDateTime, zoneOffsetMs } from '../../src/modules/tasks/domain/local-time.ts';

const MADRID = REMINDER_TIME_ZONE;
const HOUR = 3_600_000;

function resolve(local: string, zone = MADRID) {
  const result = resolveLocalDateTime(local, zone);
  return result.kind === 'gap'
    ? 'gap'
    : `${result.instant.toISOString()}${result.ambiguous ? ' (repetida)' : ''}`;
}

describe('hora local de Madrid → instante', () => {
  it.each([
    // Invierno (UTC+1) y verano (UTC+2) fuera de los cambios.
    ['2026-01-15T09:00', '2026-01-15T08:00:00.000Z'],
    ['2026-07-15T09:00', '2026-07-15T07:00:00.000Z'],
    // Marzo de 2026: el cambio es el domingo 29. Justo antes y justo después del hueco.
    ['2026-03-29T01:59', '2026-03-29T00:59:00.000Z'],
    ['2026-03-29T03:00', '2026-03-29T01:00:00.000Z'],
    ['2026-03-29T03:30', '2026-03-29T01:30:00.000Z'],
    // Octubre de 2026: el cambio es el domingo 25. 01:59 es única (verano); 03:00 es única (invierno).
    ['2026-10-25T01:59', '2026-10-24T23:59:00.000Z'],
    ['2026-10-25T03:00', '2026-10-25T02:00:00.000Z'],
    // 2027: marzo, domingo 28; octubre, domingo 31.
    ['2027-03-28T01:59', '2027-03-28T00:59:00.000Z'],
    ['2027-03-28T03:00', '2027-03-28T01:00:00.000Z'],
    ['2027-10-31T03:00', '2027-10-31T02:00:00.000Z'],
  ])('%s → %s', (local, expected) => {
    expect(resolve(local)).toBe(expected);
  });

  it.each(['2026-03-29T02:00', '2026-03-29T02:30', '2026-03-29T02:59', '2027-03-28T02:30'])(
    'la hora %s no existe (hueco de marzo)',
    (local) => {
      expect(resolve(local)).toBe('gap');
    },
  );

  it.each([
    // La primera ocurrencia es en horario de verano (UTC+2): 02:30 CEST = 00:30 UTC.
    ['2026-10-25T02:00', '2026-10-25T00:00:00.000Z (repetida)'],
    ['2026-10-25T02:30', '2026-10-25T00:30:00.000Z (repetida)'],
    ['2026-10-25T02:59', '2026-10-25T00:59:00.000Z (repetida)'],
    ['2027-10-31T02:30', '2027-10-31T00:30:00.000Z (repetida)'],
  ])('la hora %s ocurre dos veces (octubre): se elige la primera', (local, expected) => {
    expect(resolve(local)).toBe(expected);
  });

  it('una hora después de la primera ocurrencia el reloj ya marca la segunda, y no se elige', () => {
    const first = resolveLocalDateTime('2026-10-25T02:30', MADRID);
    if (first.kind !== 'ok') throw new Error('debería existir');
    expect(zoneOffsetMs(MADRID, first.instant.getTime())).toBe(2 * HOUR);
    expect(zoneOffsetMs(MADRID, first.instant.getTime() + HOUR)).toBe(HOUR);
  });

  it('una zona sin horario de verano no tiene huecos ni repeticiones', () => {
    expect(resolve('2026-03-29T02:30', 'UTC')).toBe('2026-03-29T02:30:00.000Z');
    expect(resolve('2026-10-25T02:30', 'UTC')).toBe('2026-10-25T02:30:00.000Z');
  });

  it('el desplazamiento de Madrid es +1 h en invierno y +2 h en verano', () => {
    expect(zoneOffsetMs(MADRID, Date.parse('2026-01-01T12:00:00Z'))).toBe(HOUR);
    expect(zoneOffsetMs(MADRID, Date.parse('2026-07-01T12:00:00Z'))).toBe(2 * HOUR);
  });

  it('rechaza un texto con otro formato', () => {
    expect(() => resolveLocalDateTime('2026-03-29 02:30', MADRID)).toThrow(RangeError);
    expect(() => resolveLocalDateTime('2026-03-29T02:30+01:00', MADRID)).toThrow(RangeError);
  });
});

describe('isLocalDateTime', () => {
  it.each(['2026-03-29T02:30', '2027-10-31T23:59', '2028-02-29T00:00', '1970-01-01T00:00'])(
    '%s es válida',
    (value) => {
      expect(isLocalDateTime(value)).toBe(true);
    },
  );

  it.each([
    '2026-02-30T10:00', // no existe el 30 de febrero
    '2027-02-29T10:00', // 2027 no es bisiesto
    '2026-13-01T10:00',
    '2026-03-29T24:00',
    '2026-03-29T10:60',
    '2026-03-29T10:00:00', // con segundos
    '2026-03-29T10:00Z', // con zona
    '2026-03-29T10:00+01:00',
    '2026-03-29 10:00',
    '1969-12-31T23:59',
    '',
  ])('«%s» no es válida', (value) => {
    expect(isLocalDateTime(value)).toBe(false);
  });
});
