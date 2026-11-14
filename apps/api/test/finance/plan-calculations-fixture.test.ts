/**
 * Los cálculos del plan contra `plan-ficticio-v2.xlsx`: todos los valores esperados están calculados A MANO,
 * con su desarrollo, en `apps/api/test/fixtures/plan-ficticio-v2.expected.md` («Resultados de los cálculos»).
 * Aquí se copian como literales; no se calculan con el código bajo prueba. Datos FICTICIOS.
 *
 * El archivo pasa por el importador real y la foto se arma como lo hará el servicio (la fila del Excel es el
 * identificador), así que también se comprueba que lo que extrae el importador alimenta bien los cálculos.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  calculatePlan,
  type PlanCalculation,
} from '../../src/modules/finance/plan/domain/index.ts';
import { FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import { parseBytes, previewOf } from '../imports/helpers.ts';
import { rowId, snapshotFromExtracted } from './plan-builders.ts';

const bytes = readFileSync(new URL('../fixtures/plan-ficticio-v2.xlsx', import.meta.url));

let calc: PlanCalculation;
beforeAll(() => {
  const { extracted } = previewOf(parseBytes(bytes));
  calc = calculatePlan(snapshotFromExtracted(extracted, FIXTURE_MONTH), {
    currentMonth: FIXTURE_MONTH,
  });
});

describe('plan-ficticio-v2.xlsx: presupuesto (§9.2)', () => {
  it('I, G, M, tasa de ahorro, E y % confirmadas', () => {
    expect(calc.budget).toMatchObject({
      incomeCents: 280_000,
      expensesCents: 142_500,
      marginCents: 137_500,
      savingsRate: { numerator: 137_500, denominator: 280_000 },
      essentialCents: 133_000,
      includedLineCount: 7,
      confirmedLineCount: 2,
      confirmedShare: { numerator: 2, denominator: 7 },
    });
  });

  it('anual y % del ingreso de cada línea', () => {
    // Orden de las líneas de Presupuesto (filas 6 a 12): mensual, anual.
    const expected = [
      [80_000, 960_000],
      [6_000, 72_000],
      [35_000, 420_000],
      [4_000, 48_000],
      [2_500, 30_000],
      [3_000, 36_000],
      [12_000, 144_000],
    ];
    expect(
      calc.budget.lines.map((entry) => [entry.monthlyCents, entry.annualCents, entry.included]),
    ).toEqual(expected.map(([monthly, annual]) => [monthly, annual, true]));
    for (const [index, entry] of calc.budget.lines.entries()) {
      expect(entry.incomeShare).toEqual({
        numerator: expected[index]?.[0],
        denominator: 280_000,
      });
    }
  });
});

describe('plan-ficticio-v2.xlsx: proyección a 12 meses (§9.3)', () => {
  // [mes, P_k, flujo, inicial, final]
  const expected = [
    ['2026-11', 9_000, 128_500, 650_000, 778_500],
    ['2026-12', 0, 137_500, 778_500, 916_000],
    ['2027-01', 0, 137_500, 916_000, 1_053_500],
    ['2027-02', 45_000, 92_500, 1_053_500, 1_146_000],
    ['2027-03', 0, 137_500, 1_146_000, 1_283_500],
    ['2027-04', 0, 137_500, 1_283_500, 1_421_000],
    ['2027-05', 0, 137_500, 1_421_000, 1_558_500],
    ['2027-06', 0, 137_500, 1_558_500, 1_696_000],
    ['2027-07', 0, 137_500, 1_696_000, 1_833_500],
    ['2027-08', 45_000, 92_500, 1_833_500, 1_926_000],
    ['2027-09', 0, 137_500, 1_926_000, 2_063_500],
    ['2027-10', 0, 137_500, 2_063_500, 2_201_000],
  ] as const;

  it('los 12 meses: P_k, flujo, saldo inicial y final', () => {
    expect(
      calc.projection.map((row) => [
        row.month,
        row.eventsCents,
        row.flowCents,
        row.openingCents,
        row.closingCents,
      ]),
    ).toEqual(expected.map((row) => [...row]));
  });

  it('todos los meses son del plan y sin aviso; la tasa de cada mes es flujo / I', () => {
    expect(calc.projection.every((row) => row.source === 'plan' && row.warning === null)).toBe(
      true,
    );
    calc.projection.forEach((row, index) => {
      expect(row.index).toBe(index + 1);
      expect(row.flowRate).toEqual({ numerator: expected[index]?.[2], denominator: 280_000 });
    });
  });

  it('el saldo final del mes 12 cuadra: S0 + 12 × M − Σ P', () => {
    expect(calc.projection[11]?.closingCents).toBe(650_000 + 12 * 137_500 - 99_000);
  });
});

describe('plan-ficticio-v2.xlsx: metas (§9.4)', () => {
  it('las cuatro metas', () => {
    expect(calc.goals.goals.map((goal) => [goal.name, goal.kind])).toEqual([
      ['Viaje', 'fixed_amount'],
      ['Fondo de emergencia', 'emergency_fund'],
      ['Meta ya completada', 'fixed_amount'],
      ['Meta sin aportación', 'fixed_amount'],
    ]);
    expect(
      calc.goals.goals.map((goal) => ({
        target: goal.targetCents,
        current: goal.currentCents,
        remaining: goal.remainingCents,
        contribution: goal.contributionCents,
        months: goal.monthsToGoal,
        status: goal.status,
      })),
    ).toEqual([
      {
        target: 300_000,
        current: 100_000,
        remaining: 200_000,
        contribution: 15_000,
        months: 14,
        status: 'in_progress',
      },
      {
        target: 798_000,
        current: 500_000,
        remaining: 298_000,
        contribution: 20_000,
        months: 15,
        status: 'in_progress',
      },
      {
        target: 50_000,
        current: 50_000,
        remaining: 0,
        contribution: 0,
        months: 0,
        status: 'completed',
      },
      {
        target: 200_000,
        current: 30_000,
        remaining: 170_000,
        contribution: 0,
        months: null,
        status: 'paused',
      },
    ]);
  });

  it('la prueba de capacidad cumple: 35 000 ≤ 137 500', () => {
    expect(calc.goals.capacity).toEqual({
      contributionsCents: 35_000,
      marginCents: 137_500,
      unallocatedCents: 102_500,
      ok: true,
    });
  });
});

describe('plan-ficticio-v2.xlsx: escenarios (§9.5)', () => {
  it('extra, puntual, salida total, caja libre, tasa y lectura de cada escenario', () => {
    expect(
      calc.scenarios.map((result) => ({
        name: result.name,
        extra: result.extraCents,
        oneOff: result.oneOffCents,
        outflow: result.totalOutflowCents,
        freeCash: result.freeCashCents,
        freeRate: result.freeRate,
        reading: result.reading,
      })),
    ).toEqual([
      {
        name: 'Escenario base',
        extra: 0,
        oneOff: 0,
        outflow: 142_500,
        freeCash: 137_500,
        freeRate: { numerator: 137_500, denominator: 280_000 },
        reading: 'high',
      },
      {
        name: 'Con curso',
        extra: 8_000,
        oneOff: 0,
        outflow: 150_500,
        freeCash: 129_500,
        freeRate: { numerator: 129_500, denominator: 280_000 },
        reading: 'high',
      },
      {
        name: 'Con extras y reparación',
        extra: 12_500,
        oneOff: 60_000,
        outflow: 215_000,
        freeCash: 65_000,
        freeRate: { numerator: 65_000, denominator: 280_000 },
        reading: 'moderate',
      },
      {
        name: 'Con luz duplicada',
        extra: 6_000,
        oneOff: 0,
        outflow: 148_500,
        freeCash: 131_500,
        freeRate: { numerator: 131_500, denominator: 280_000 },
        reading: 'high',
      },
    ]);
  });
});

describe('plan-ficticio-v2.xlsx: comprobaciones y estado global (§9.6)', () => {
  it('cada comprobación, con lo que la dispara', () => {
    expect(
      calc.checks.checks.map((entry) => [
        entry.code,
        entry.severity,
        entry.passed,
        [...entry.subjects],
      ]),
    ).toEqual([
      ['CONTRIBUTIONS_EXCEED_MARGIN', 'FAIL', true, []],
      ['NEGATIVE_MARGIN', 'FAIL', true, []],
      // Electricidad (fila 9 de Presupuesto: línea de la fila 7) y Supermercado (línea de la fila 8)
      ['ESSENTIAL_NOT_CONFIRMED', 'WARN', false, [rowId(7), rowId(8)]],
      ['NEGATIVE_FINAL_BALANCE', 'WARN', true, []],
      ['EXPENSE_NOT_BUDGETED', 'WARN', true, []],
      // «Con luz duplicada»: fila 9 de Escenarios
      ['SCENARIO_ITEM_ALREADY_IN_BASE', 'WARN', false, [rowId(9)]],
      // «Préstamo total» (cuota × plazo): fila 10 de Eventos
      ['EVENT_ITEM_ALREADY_IN_BASE', 'WARN', false, [rowId(10)]],
    ]);
  });

  it('estado global: PASS WITH WARNINGS', () => {
    expect(calc.checks.overall).toBe('PASS_WITH_WARNINGS');
  });
});
