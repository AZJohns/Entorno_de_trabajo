import { MAX_TAGS_PER_NOTE } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import { addTag, cleanTagName, mergeTags, sameTags, suggestTags } from '../src/notes/tagLogic.ts';

describe('unión de etiquetas por mayúsculas', () => {
  it('no añade una etiqueta que solo difiere en mayúsculas', () => {
    expect(addTag(['Cuentas'], 'cuentas', [])).toEqual(['Cuentas']);
    expect(addTag(['Cuentas'], 'CUENTAS', [])).toEqual(['Cuentas']);
  });

  it('mergeTags conserva la primera grafía', () => {
    expect(mergeTags(['Casa', 'casa', 'CASA', 'Coche'], ['coche', 'Viaje'])).toEqual([
      'Casa',
      'Coche',
      'Viaje',
    ]);
  });

  it('al añadir una que ya existe en el sistema usa la grafía existente', () => {
    expect(addTag([], 'presupuesto', ['Presupuesto'])).toEqual(['Presupuesto']);
  });

  it('recorta espacios y descarta vacías y demasiado largas', () => {
    expect(cleanTagName('  a \n  b  ')).toBe('a b');
    expect(addTag(['x'], '   ', [])).toEqual(['x']);
    expect(addTag(['x'], 'a'.repeat(41), [])).toEqual(['x']);
  });

  it('respeta el máximo de etiquetas por nota', () => {
    const full = Array.from({ length: MAX_TAGS_PER_NOTE }, (_, i) => `t${String(i)}`);
    expect(addTag(full, 'otra', [])).toEqual(full);
  });

  it('sameTags ignora mayúsculas y orden', () => {
    expect(sameTags(['A', 'b'], ['B', 'a'])).toBe(true);
    expect(sameTags(['A'], ['A', 'b'])).toBe(false);
  });
});

describe('sugerencias', () => {
  const known = ['Trabajo', 'Casa', 'Tareas', 'Impuestos'];

  it('filtra por lo escrito, sin las ya puestas, con las que empiezan igual primero', () => {
    expect(suggestTags(known, ['Casa'], 'ta')).toEqual(['Tareas']);
    expect(suggestTags(known, [], 'T')).toEqual(['Tareas', 'Trabajo', 'Impuestos']);
  });

  it('sin texto muestra todas las que faltan', () => {
    expect(suggestTags(known, ['casa'], '')).toHaveLength(3);
  });
});
