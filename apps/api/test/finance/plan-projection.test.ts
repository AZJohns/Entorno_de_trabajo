/**
 * Proyección a 12 meses (`projectCash`, `eventAmountCents`, §9.3). Tests de tabla con casos límite y de
 * meses pasados; importes FICTICIOS.
 */
import { describe, expect, it } from 'vitest';
import { summarizeBudget } from '../../src/modules/finance/plan/domain/budget.ts';
import { indexItems } from '../../src/modules/finance/plan/domain/items.ts';
import {
  eventAmountCents,
  projectCash,
  type ProjectionRow,
} from '../../src/modules/finance/plan/domain/projection.ts';
import { event, expense, income, item, line, MONTH_1, savings, snapshot } from './plan-builders.ts';
import type { PlanSnapshot } from '../../src/modules/finance/plan/domain/types.ts';

/** I = 100 000, G = 40 000 (flujo 60 000), S0 = 500 000, salvo lo que se cambie. */
function base(parts: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return snapshot({
    items: [income('sal', 100_000), expense('rent', 40_000), savings('s1', 500_000)],
    budgetLines: [line('l1', 'rent')],
    ...parts,
  });
}

function project(
  plan: PlanSnapshot,
  currentMonth = MONTH_1,
  realFlowByMonth?: ReadonlyMap<string, number>,
): ProjectionRow[] {
  return projectCash(plan, summarizeBudget(plan), { currentMonth, realFlowByMonth });
}

describe('projectCash: sin eventos', () => {
  it('12 meses desde el mes de la foto, flujo constante y saldo que acumula', () => {
    const rows = project(base());
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.month)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
    ]);
    expect(rows.every((row) => row.flowCents === 60_000 && row.source === 'plan')).toBe(true);
    expect(rows[0]).toMatchObject({ index: 1, openingCents: 500_000, closingCents: 560_000 });
    expect(rows[11]).toMatchObject({ index: 12, closingCents: 500_000 + 12 * 60_000 });
  });

  it('varias filas savings_balance se suman; las excluidas no', () => {
    const rows = project(
      base({
        items: [
          income('sal', 100_000),
          expense('rent', 40_000),
          savings('a', 300_000),
          savings('b', 150_000, 'estimated'),
          savings('c', 99_999, 'inactive'), // fuera del plan base
        ],
      }),
    );
    expect(rows[0]?.openingCents).toBe(450_000);
  });

  it('sin filas de ahorro, S0 = 0', () => {
    const rows = project(base({ items: [income('sal', 100_000), expense('rent', 40_000)] }));
    expect(rows[0]?.openingCents).toBe(0);
  });

  it('I = 0: la tasa de cada mes es null y el flujo es −G', () => {
    const rows = project(base({ items: [expense('rent', 40_000), savings('s1', 500_000)] }));
    expect(rows[0]?.flowCents).toBe(-40_000);
    expect(rows.every((row) => row.flowRate === null)).toBe(true);
  });

  it('tasa_k = flujo_k / I como fracción', () => {
    expect(project(base())[0]?.flowRate).toEqual({ numerator: 60_000, denominator: 100_000 });
  });
});

describe('projectCash: eventos', () => {
  it('cada evento va a su mes; dos eventos en el mismo mes se suman', () => {
    const rows = project(
      base({
        events: [
          event('e1', {
            amountCents: 9_000,
            expectedDate: '2026-11-15',
            includeInProjection: true,
          }),
          event('e2', {
            amountCents: 1_000,
            expectedDate: '2026-11-30',
            includeInProjection: true,
          }),
          event('e3', {
            amountCents: 5_000,
            expectedDate: '2027-02-10',
            includeInProjection: true,
          }),
        ],
      }),
    );
    expect(rows.map((row) => row.eventsCents)).toEqual([
      10_000, 0, 0, 5_000, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(rows[0]?.flowCents).toBe(50_000);
    expect(rows[3]?.flowCents).toBe(55_000);
  });

  it('el primer y el último día del horizonte entran; el día anterior y el siguiente no', () => {
    const rows = project(
      base({
        events: [
          event('first', { amountCents: 1, expectedDate: '2026-11-01', includeInProjection: true }),
          event('last', { amountCents: 2, expectedDate: '2027-10-31', includeInProjection: true }),
          event('before', {
            amountCents: 100,
            expectedDate: '2026-10-31',
            includeInProjection: true,
          }),
          event('after', {
            amountCents: 200,
            expectedDate: '2027-11-01',
            includeInProjection: true,
          }),
        ],
      }),
    );
    expect(rows[0]?.eventsCents).toBe(1);
    expect(rows[11]?.eventsCents).toBe(2);
    expect(rows.reduce((total, row) => total + row.eventsCents, 0)).toBe(3);
  });

  it('un evento sin fecha o no incluido no se proyecta', () => {
    const rows = project(
      base({
        events: [
          event('no-date', { amountCents: 7_000, includeInProjection: false }),
          event('not-included', {
            amountCents: 7_000,
            expectedDate: '2026-12-01',
            includeInProjection: false,
          }),
        ],
      }),
    );
    expect(rows.every((row) => row.eventsCents === 0)).toBe(true);
  });

  it('un evento incluido sin fecha es una foto incoherente (lo impide un CHECK de la base de datos)', () => {
    expect(() =>
      project(base({ events: [event('e', { includeInProjection: true, expectedDate: null })] })),
    ).toThrow(RangeError);
  });

  it('el estado del evento no cambia nada: solo cuentan la fecha y «incluir»', () => {
    const rows = project(
      base({
        events: [
          event('paid', {
            amountCents: 4_000,
            status: 'paid',
            expectedDate: '2026-12-05',
            includeInProjection: true,
          }),
        ],
      }),
    );
    expect(rows[1]?.eventsCents).toBe(4_000);
  });

  it('las aportaciones a metas no restan caja', () => {
    const rows = project(
      base({
        goals: [
          {
            id: 'g',
            name: 'Meta',
            goalKind: 'fixed_amount',
            targetItemId: null,
            targetCents: 1_000_000,
            currentItemId: null,
            currentCents: 0,
            contributionItemId: null,
            contributionCents: 25_000,
          },
        ],
      }),
    );
    expect(rows[0]?.flowCents).toBe(60_000);
  });
});

describe('eventAmountCents', () => {
  const items = indexItems([
    item('eur', 'one_off_payment', 'eur', 45_000),
    item('monthly', 'expense', 'eur_per_month', 12_000),
    item('term', 'assumption', 'months', 1_800),
    item('half-term', 'assumption', 'months', 650),
  ]);

  it.each([
    ['literal', event('e', { amountCents: 9_000 }), 9_000],
    ['referencia en €', event('e', { amountCents: null, amountItemId: 'eur' }), 45_000],
    // €/mes = UN pago igual a la cuota, no cuota × 12 ni × plazo
    [
      'referencia en €/mes (un único pago)',
      event('e', { amountCents: null, amountItemId: 'monthly' }),
      12_000,
    ],
    [
      'cuota × plazo (18 meses)',
      event('e', { amountCents: null, amountItemId: 'monthly', multiplierItemId: 'term' }),
      216_000,
    ],
    [
      'cuota × plazo con meses no enteros (6,5 meses)',
      event('e', { amountCents: null, amountItemId: 'monthly', multiplierItemId: 'half-term' }),
      78_000, // 12 000 × 650 / 100, exacto
    ],
    ['literal 0', event('e', { amountCents: 0 }), 0],
  ])('%s', (_name, planEvent, expected) => {
    expect(eventAmountCents(planEvent, items)).toBe(expected);
  });

  it('redondea half-up en x,5 céntimos', () => {
    const odd = indexItems([
      item('m', 'expense', 'eur_per_month', 101),
      item('t', 'assumption', 'months', 650),
    ]);
    expect(
      eventAmountCents(
        event('e', { amountCents: null, amountItemId: 'm', multiplierItemId: 't' }),
        odd,
      ),
    ).toBe(657); // 101 × 650 / 100 = 656,5
  });

  it.each([
    ['sin importe', event('e', { amountCents: null })],
    ['literal y referencia a la vez', event('e', { amountCents: 5, amountItemId: 'eur' })],
    ['plazo sin cuota', event('e', { amountCents: null, multiplierItemId: 'term' })],
    ['referencia inexistente', event('e', { amountCents: null, amountItemId: 'nope' })],
    ['la cuota no tiene importe', event('e', { amountCents: null, amountItemId: 'term' })],
    [
      'el plazo no está en meses',
      event('e', { amountCents: null, amountItemId: 'monthly', multiplierItemId: 'eur' }),
    ],
  ])('es incoherente: %s', (_name, planEvent) => {
    expect(() => eventAmountCents(planEvent, items)).toThrow(RangeError);
  });
});

describe('projectCash: meses pasados', () => {
  // Mes 1 = 2026-11. Mes en curso = 2027-01: son pasados 2026-11 y 2026-12.
  const current = '2027-01';

  it('con flujo real, el mes pasado usa el real (source = real) y el roll-forward sigue con él', () => {
    const rows = project(
      base({
        events: [
          event('e', { amountCents: 9_000, expectedDate: '2026-11-15', includeInProjection: true }),
        ],
      }),
      current,
      new Map([
        ['2026-11', 41_234], // real, distinto del plan (51 000)
        ['2026-12', -5_000], // real negativo
      ]),
    );
    expect(rows[0]).toMatchObject({
      source: 'real',
      warning: null,
      flowCents: 41_234,
      eventsCents: 9_000, // P_1 se sigue informando
      openingCents: 500_000,
      closingCents: 541_234,
    });
    expect(rows[1]).toMatchObject({
      source: 'real',
      flowCents: -5_000,
      openingCents: 541_234,
      closingCents: 536_234,
    });
    // El mes en curso y los siguientes vuelven al plan, sobre el saldo mostrado.
    expect(rows[2]).toMatchObject({
      source: 'plan',
      warning: null,
      flowCents: 60_000,
      openingCents: 536_234,
    });
  });

  it('un flujo real de 0 es un dato real, no «sin datos»', () => {
    const rows = project(base(), current, new Map([['2026-11', 0]]));
    expect(rows[0]).toMatchObject({ source: 'real', flowCents: 0, warning: null });
  });

  it('sin flujo real, el mes pasado usa el plan con el aviso «sin datos reales»', () => {
    const rows = project(base(), current, new Map([['2026-12', 70_000]]));
    expect(rows[0]).toMatchObject({ source: 'plan', warning: 'NO_REAL_DATA', flowCents: 60_000 });
    expect(rows[1]).toMatchObject({ source: 'real', warning: null, flowCents: 70_000 });
  });

  it('sin mapa de flujo real, todos los meses pasados avisan', () => {
    const rows = project(base(), current);
    expect(rows.map((row) => row.warning)).toEqual([
      'NO_REAL_DATA',
      'NO_REAL_DATA',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('el mes actual es plan, aunque el mapa traiga datos de ese mes', () => {
    const rows = project(base(), '2026-11', new Map([['2026-11', 1]]));
    expect(rows[0]).toMatchObject({ source: 'plan', warning: null, flowCents: 60_000 });
  });

  it('un plan de un mes futuro no tiene meses pasados', () => {
    const rows = project(base(), '2026-01', new Map([['2026-11', 1]]));
    expect(rows.every((row) => row.source === 'plan' && row.warning === null)).toBe(true);
  });

  it('el mes en curso tiene que ser un mes válido', () => {
    expect(() => project(base(), '2026-13')).toThrow(RangeError);
  });
});
