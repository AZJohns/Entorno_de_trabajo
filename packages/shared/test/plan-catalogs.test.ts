/**
 * Catálogos de la plantilla (docs/plantilla-excel.md §6, §7 y §9.1) y esquemas de la importación.
 */
import { describe, expect, it } from 'vitest';
import {
  EVENT_STATUSES,
  GOAL_KINDS,
  ISSUE_CODES,
  NATURES,
  RECORD_TYPES,
  RECORD_TYPE_UNITS,
  STATUSES,
  UNITS,
  extractedPlanSchema,
  importIssueSchema,
  includedInBase,
  uploadPlanExcelQuerySchema,
  type Status,
} from '../src/index.ts';

describe('catálogos cerrados', () => {
  it('tienen los tamaños del contrato', () => {
    expect(UNITS).toHaveLength(3);
    expect(NATURES).toHaveLength(11);
    expect(STATUSES).toHaveLength(10);
    expect(RECORD_TYPES).toHaveLength(9);
    expect(EVENT_STATUSES).toHaveLength(6);
    expect(GOAL_KINDS).toHaveLength(2);
  });

  it('los códigos y las etiquetas no se repiten', () => {
    for (const catalog of [UNITS, NATURES, STATUSES, RECORD_TYPES, EVENT_STATUSES, GOAL_KINDS]) {
      expect(new Set(catalog.map((entry) => entry.code)).size).toBe(catalog.length);
      expect(new Set(catalog.map((entry) => entry.label)).size).toBe(catalog.length);
    }
  });

  it('cada tipo de registro tiene al menos una unidad esperada y todas son unidades válidas', () => {
    const units = new Set<string>(UNITS.map((unit) => unit.code));
    for (const { code } of RECORD_TYPES) {
      expect(RECORD_TYPE_UNITS[code].length).toBeGreaterThan(0);
      for (const unit of RECORD_TYPE_UNITS[code]) expect(units.has(unit)).toBe(true);
    }
  });
});

describe('includedInBase (predicado único, §6.1 y §9.1)', () => {
  const included: Status[] = [
    'confirmed',
    'pending',
    'to_confirm',
    'provisional',
    'estimated',
    'to_confirm_paid',
  ];
  const excluded: Status[] = ['potential', 'inactive', 'paused', 'historical'];

  it.each(included)('«%s» cuenta en el plan base', (status) => {
    expect(includedInBase(status)).toBe(true);
  });
  it.each(excluded)('«%s» no cuenta en el plan base', (status) => {
    expect(includedInBase(status)).toBe(false);
  });
  it('cubre exactamente los 10 estados', () => {
    expect(new Set([...included, ...excluded]).size).toBe(STATUSES.length);
    expect(STATUSES.map((status) => status.code).sort()).toEqual([...included, ...excluded].sort());
  });
});

describe('esquemas de la importación', () => {
  it('un problema válido pasa y uno con un código desconocido, no', () => {
    const issue = {
      code: 'CELL_TYPE',
      severity: 'error',
      sheet: 'Datos y supuestos',
      cell: 'C8',
      message: 'x',
    };
    expect(importIssueSchema.parse(issue)).toEqual(issue);
    expect(importIssueSchema.safeParse({ ...issue, code: 'INVENTADO' }).success).toBe(false);
    expect(importIssueSchema.safeParse({ ...issue, severity: 'grave' }).success).toBe(false);
  });

  it('el catálogo tiene 39 códigos: los 36 de §11 y los 3 avisos de §6.3 añadidos en la 3b.1', () => {
    expect(Object.keys(ISSUE_CODES)).toHaveLength(39);
  });

  it('las entradas extraídas rechazan códigos fuera de catálogo y filas anteriores a la 6', () => {
    const empty = { items: [], budgetLines: [], events: [], goals: [], scenarios: [] };
    expect(extractedPlanSchema.parse(empty)).toEqual(empty);
    expect(
      extractedPlanSchema.safeParse({
        ...empty,
        scenarios: [{ sourceRow: 5, name: 'x', extraMonthlyRows: [], oneOffRows: [] }],
      }).success,
    ).toBe(false);
  });

  it('la consulta de subida exige mes YYYY-MM válido y nombre de archivo, y no admite campos extra', () => {
    expect(
      uploadPlanExcelQuerySchema.safeParse({ month: '2026-11', fileName: 'a.xlsx' }).success,
    ).toBe(true);
    for (const bad of [
      { month: '2026-13', fileName: 'a.xlsx' },
      { month: '0000-01', fileName: 'a.xlsx' },
      { month: '2026-11' },
      { month: '2026-11', fileName: '' },
      { month: '2026-11', fileName: 'a.xlsx', extra: 1 },
    ]) {
      expect(uploadPlanExcelQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});
