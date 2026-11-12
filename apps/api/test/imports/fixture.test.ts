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

/** Lee `Default` y `Override` de `[Content_Types].xml` con una expresión simple, a propósito sin usar el lector. */
function readFileTypes(xml: string): {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
} {
  const attribute = (tag: string, name: string): string =>
    new RegExp(`${name}="([^"]*)"`, 'u').exec(tag)?.[1] ?? '';
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const tag of xml.match(/<Default\b[^>]*>/gu) ?? [])
    defaults.set(attribute(tag, 'Extension').toLowerCase(), attribute(tag, 'ContentType'));
  for (const tag of xml.match(/<Override\b[^>]*>/gu) ?? [])
    overrides.set(attribute(tag, 'PartName'), attribute(tag, 'ContentType'));
  return { defaults, overrides };
}

interface Relationship {
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

/** Relaciones de una parte (`''` es el paquete, `_rels/.rels`), leídas con una expresión simple, sin el lector. */
function relationshipsOf(archive: ReturnType<typeof openZip>, source: string): Relationship[] {
  const slash = source.lastIndexOf('/');
  const dir = source.slice(0, slash + 1);
  const file = source.slice(slash + 1);
  const xml = archive.read(`${dir}_rels/${file}.rels`)?.toString('utf8') ?? '';
  const attribute = (tag: string, name: string): string =>
    new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(tag)?.[1] ?? '';
  return (xml.match(/<Relationship\b[^>]*>/gu) ?? []).map((tag) => ({
    type: attribute(tag, 'Type'),
    target: attribute(tag, 'Target'),
    external: attribute(tag, 'TargetMode') === 'External',
  }));
}

/** Nombre en el ZIP de la parte a la que apunta `target`, relativo a la carpeta de `source` (o absoluto con `/`). */
function resolveTarget(source: string, target: string): string {
  const segments = target.startsWith('/')
    ? target.slice(1).split('/')
    : [...source.split('/').slice(0, -1), ...target.split('/')];
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '..') out.pop();
    else if (segment !== '.' && segment !== '') out.push(segment);
  }
  return out.join('/');
}

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

  // No depende de nuestro lector: aplica la regla del paquete OOXML (ECMA-376 Parte 2, §10.1.2): cada parte
  // tiene un tipo, por `Override` o por `Default` según su extensión. Sin esto, openpyxl no abre el archivo y
  // LibreOffice lo abre sin textos aunque nuestro lector (que no mira los tipos) lo lea bien.
  describe.each([
    ['la fixture guardada', () => committed],
    ['el libro generado en memoria', () => buildValidWorkbook().toBuffer()],
  ])('paquete OOXML válido: %s', (_label, load) => {
    const archive = openZip(load(), LIMITS);
    const declared = readFileTypes(archive.read('[Content_Types].xml')?.toString('utf8') ?? '');

    it('cada parte del ZIP tiene su tipo de contenido declarado (no basta el genérico application/xml)', () => {
      const sinTipo = archive
        .names()
        .filter((name) => name !== '[Content_Types].xml')
        .filter((name) => {
          const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
          const type = declared.overrides.get(`/${name}`) ?? declared.defaults.get(extension);
          // `application/xml` por `Default` es lo que hacía el generador antiguo: lo cumple cualquier XML,
          // pero no es el tipo de una hoja ni de las cadenas compartidas.
          return type === undefined || type === 'application/xml';
        });
      expect(sinTipo).toEqual([]);
    });

    it('ningún Override apunta a una parte que no existe', () => {
      const names = new Set(archive.names().map((name) => `/${name}`));
      expect([...declared.overrides.keys()].filter((part) => !names.has(part))).toEqual([]);
    });

    it('las partes principales declaran el tipo que exige el estándar', () => {
      const types = declared.overrides;
      const base = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
      expect(types.get('/xl/workbook.xml')).toBe(`${base}.sheet.main+xml`);
      expect(types.get('/xl/worksheets/sheet1.xml')).toBe(`${base}.worksheet+xml`);
      expect(types.get('/xl/sharedStrings.xml')).toBe(`${base}.sharedStrings+xml`);
      expect(types.get('/xl/styles.xml')).toBe(`${base}.styles+xml`);
      expect(types.get('/xl/comments1.xml')).toBe(`${base}.comments+xml`);
      expect(types.get('/docProps/core.xml')).toBe(
        'application/vnd.openxmlformats-package.core-properties+xml',
      );
      // Todas las hojas del libro (no solo la primera) están declaradas.
      const sheets = archive
        .names()
        .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name));
      expect(sheets.length).toBeGreaterThan(1);
      for (const sheet of sheets)
        expect(types.get(`/${sheet}`), sheet).toBe(`${base}.worksheet+xml`);
    });

    // Excel y LibreOffice no buscan los textos por su ruta, sino siguiendo las relaciones desde `_rels/.rels`
    // (el estándar, ECMA-376 Parte 2 §9): una parte a la que no llega ninguna relación es huérfana y se ignora.
    // Nuestro lector no las sigue para esto (lee `xl/sharedStrings.xml` y `xl/styles.xml` por su ruta fija, ver
    // el README del módulo), así que solo este test protege la fixture.
    it('cada parte (salvo [Content_Types].xml y los .rels) es alcanzable siguiendo las relaciones desde _rels/.rels', () => {
      const names = new Set(archive.names());
      const reached = new Set<string>();
      const dangling: string[] = [];
      const pending: string[] = [''];
      while (pending.length > 0) {
        const source = pending.pop() ?? '';
        for (const { target, external } of relationshipsOf(archive, source)) {
          if (external) continue;
          const part = resolveTarget(source, target);
          if (!names.has(part)) dangling.push(`${source || '/'} → ${part}`);
          else if (!reached.has(part)) {
            reached.add(part);
            pending.push(part);
          }
        }
      }
      const huerfanas = [...names].filter(
        (name) => name !== '[Content_Types].xml' && !name.endsWith('.rels') && !reached.has(name),
      );
      expect(huerfanas).toEqual([]);
      expect(dangling).toEqual([]);
    });

    it('el libro enlaza sus estilos y sus cadenas compartidas con el tipo de relación del estándar', () => {
      const base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const byType = new Map(
        relationshipsOf(archive, 'xl/workbook.xml').map((rel) => [rel.type, rel.target]),
      );
      expect(byType.get(`${base}/styles`)).toBe('styles.xml');
      expect(byType.get(`${base}/sharedStrings`)).toBe('sharedStrings.xml');
    });
  });

  it('es pequeña (se sube al repositorio público): solo datos inventados', () => {
    expect(committed.length).toBeLessThan(50 * 1024);
  });
});
