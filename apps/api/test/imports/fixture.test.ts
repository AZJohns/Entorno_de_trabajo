/**
 * La fixture guardada (`plan-ficticio-v2.xlsx`) es la que genera `plan-workbook.ts`, y es ficticia: sin
 * metadatos de autor y sin macros. Se compara el CONTENIDO descomprimido (no los bytes): el resultado de
 * deflate puede variar entre versiones de zlib, y la CI prueba dos versiones de Node.
 *
 * Cuando exista la fixture guardada por Excel (docs/guia-fixture-excel.md), se añadirá junto a esta una
 * comprobación de las fórmulas compartidas reales; este archivo seguirá protegiendo a la provisional.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openZip } from '../../src/modules/imports/domain/zip.ts';
import { buildValidWorkbook, FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import { codesOf, parseBytes, previewOf } from './helpers.ts';

const committed = readFileSync(new URL('../fixtures/plan-ficticio-v2.xlsx', import.meta.url));
const LIMITS = { maxEntries: 200, maxUncompressedBytes: 50 * 1024 * 1024 };

describe('plan-ficticio-v2.xlsx', () => {
  it('coincide con el libro que genera plan-workbook.ts (ejecuta `pnpm fixtures:build` si cambió)', () => {
    const expected = openZip(buildValidWorkbook().toBuffer(), LIMITS);
    const actual = openZip(committed, LIMITS);
    expect(actual.names()).toEqual(expected.names());
    for (const name of expected.names()) {
      expect(actual.read(name)?.toString('utf8'), name).toBe(expected.read(name)?.toString('utf8'));
    }
  });

  it('se importa igual que el libro en memoria', () => {
    const fromFile = previewOf(parseBytes(committed));
    const fromMemory = previewOf(parseBytes(buildValidWorkbook().toBuffer()));
    expect(fromFile.extracted).toEqual(fromMemory.extracted);
    expect(fromFile.contentHash.equals(fromMemory.contentHash)).toBe(true);
    expect(codesOf(fromFile)).toEqual(codesOf(fromMemory));
    expect(FIXTURE_MONTH).toBe('2026-11');
  });

  it('no lleva macros, vínculos externos, autor ni empresa', () => {
    const archive = openZip(committed, LIMITS);
    const names = archive.names().map((name) => name.toLowerCase());
    expect(names.some((name) => name.includes('vbaproject'))).toBe(false);
    expect(names.some((name) => name.startsWith('xl/externallinks/'))).toBe(false);
    expect(archive.read('docProps/core.xml')?.toString()).toContain('<dc:creator></dc:creator>');
    expect(archive.has('docProps/app.xml')).toBe(false); // ahí iría la empresa
  });

  // Pendiente: la fixture guardada por Excel (docs/guia-fixture-excel.md). Cuando exista
  // `plan-ficticio-v2-excel.xlsx`, este test debe comprobar que se importa con las mismas entradas y el
  // mismo `content_hash` que la generada por código (fórmulas compartidas expandidas a cada celda).
  it.todo(
    'plan-ficticio-v2-excel.xlsx (guardada por Excel): fórmulas compartidas, fechas y .xlsm sin macros',
  );

  it('es pequeña (se sube al repositorio público): solo datos inventados', () => {
    expect(committed.length).toBeLessThan(50 * 1024);
  });
});
