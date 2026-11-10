/**
 * Lógica pura de las notas (sin base de datos): consulta de búsqueda, tramos del fragmento resaltado,
 * etiquetas únicas y cursor.
 */
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/modules/notes/domain/cursor.ts';
import {
  MATCH_END,
  MATCH_START,
  MAX_SEARCH_TERMS,
  buildPrefixQuery,
  splitHeadline,
} from '../../src/modules/notes/domain/search.ts';
import { uniqueTagNames } from '../../src/modules/notes/domain/tags.ts';

describe('buildPrefixQuery', () => {
  it('pone prefijo a cada término y los une con AND', () => {
    expect(buildPrefixQuery('presup informe')).toBe('presup:* & informe:*');
  });

  it('conserva letras con acento y la ñ, y las cifras', () => {
    expect(buildPrefixQuery('acción niño 2026')).toBe('acción:* & niño:* & 2026:*');
  });

  it('los operadores de tsquery no llegan a la consulta', () => {
    expect(buildPrefixQuery("a & !b | (c) <-> d:* 'e'")).toBe('a:* & b:* & c:* & d:* & e:*');
  });

  it('devuelve null si no hay ninguna letra ni cifra', () => {
    expect(buildPrefixQuery('  &!?* ')).toBeNull();
    expect(buildPrefixQuery('')).toBeNull();
  });

  it('acota el número de términos y el largo de cada uno', () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' ');
    expect(buildPrefixQuery(many)?.split(' & ')).toHaveLength(MAX_SEARCH_TERMS);
    expect(buildPrefixQuery('x'.repeat(500))).toBe(`${'x'.repeat(50)}:*`);
  });

  it('normaliza a NFC: «e» + acento combinado equivale a «é»', () => {
    expect(buildPrefixQuery('café')).toBe('café:*');
  });
});

describe('splitHeadline', () => {
  it('parte el texto en tramos y marca las coincidencias', () => {
    expect(splitHeadline(`el ${MATCH_START}presupuesto${MATCH_END} de casa`)).toEqual([
      { text: 'el ', match: false },
      { text: 'presupuesto', match: true },
      { text: ' de casa', match: false },
    ]);
  });

  it('sin marcas, un solo tramo sin coincidencia; vacío, ninguno', () => {
    expect(splitHeadline('texto')).toEqual([{ text: 'texto', match: false }]);
    expect(splitHeadline('')).toEqual([]);
  });

  it('el HTML del texto original sale tal cual, como texto', () => {
    const fragments = splitHeadline(`<script>x</script> ${MATCH_START}a${MATCH_END}`);
    expect(fragments.map((f) => f.text).join('')).toBe('<script>x</script> a');
  });

  it('no deja marcas en el texto aunque falte una apertura o un cierre', () => {
    const all = [
      ...splitHeadline(`a${MATCH_END}b`),
      ...splitHeadline(`a${MATCH_START}b`),
      ...splitHeadline(`${MATCH_START}${MATCH_START}a${MATCH_END}${MATCH_END}`),
    ];
    for (const { text } of all) {
      expect(text).not.toContain(MATCH_START);
      expect(text).not.toContain(MATCH_END);
    }
  });
});

describe('uniqueTagNames', () => {
  it('quita repetidos sin distinguir mayúsculas y conserva la primera grafía y el orden', () => {
    expect(uniqueTagNames(['Cuentas', 'casa', 'cuentas', 'CASA', 'Otra'])).toEqual([
      'Cuentas',
      'casa',
      'Otra',
    ]);
  });
});

describe('cursor', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const updatedAt = new Date('2026-11-03T09:00:00.123Z');
  const b64 = (text: string): string => Buffer.from(text).toString('base64url');

  it('ida y vuelta, sin y con relevancia', () => {
    const recent = { kind: 'recent', updatedAt, id } as const;
    const ranked = { kind: 'ranked', rank: 0.123_456_789_012_345_6, updatedAt, id } as const;
    expect(decodeCursor(encodeCursor(recent))).toEqual(recent);
    expect(decodeCursor(encodeCursor(ranked))).toEqual(ranked);
  });

  it.each([
    '',
    'basura',
    b64('recent|ayer|' + '0'.repeat(36)),
    b64(`ranked|NaN|2026-11-03T09:00:00.123Z|${id}`),
    b64(`ranked|-1|2026-11-03T09:00:00.123Z|${id}`),
    b64('otro|1|2'),
  ])('rechaza un cursor no válido: %s', (text) => {
    expect(decodeCursor(text)).toBeNull();
  });
});
