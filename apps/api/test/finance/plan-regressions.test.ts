/**
 * Regresión de los errores de la plantilla Excel (docs/plantilla-excel.md §10): cada uno tiene aquí un test
 * que lo reproduce con la plantilla y demuestra que la app no lo repite. Datos FICTICIOS.
 */
import { includedInBase, STATUSES, type Status } from '@backoffice/shared';
import { describe, expect, it } from 'vitest';
import { calculatePlan } from '../../src/modules/finance/plan/domain/index.ts';
import { addMonths } from '../../src/modules/finance/plan/domain/months.ts';
import { event, expense, income, line, MONTH_1, scenario, snapshot } from './plan-builders.ts';

describe('error 1: «los rangos de suma distintos según el mes: los eventos nuevos no se proyectan»', () => {
  const dates = Array.from({ length: 12 }, (_, offset) => `${addMonths(MONTH_1, offset)}-17`);

  it.each(dates.map((date, offset) => [offset + 1, date] as const))(
    'un evento nuevo con fecha en el mes %i (%s) se proyecta en ese mes y en ningún otro',
    (month, date) => {
      const plan = snapshot({
        items: [income('sal', 100_000), expense('rent', 40_000)],
        budgetLines: [line('l', 'rent')],
        // Cuatro eventos «antiguos» y, el último, el nuevo: da igual en qué posición esté.
        events: [
          event('old1', { amountCents: 1, expectedDate: '2026-11-01', includeInProjection: true }),
          event('old2', { amountCents: 2, expectedDate: '2027-01-01', includeInProjection: true }),
          event('old3', { amountCents: 4, expectedDate: '2027-04-01', includeInProjection: true }),
          event('new', { amountCents: 1_000_000, expectedDate: date, includeInProjection: true }),
        ],
      });
      const projection = calculatePlan(plan, { currentMonth: MONTH_1 }).projection;
      const withNew = projection.map((row) => row.eventsCents);

      const without = calculatePlan(
        { ...plan, events: plan.events.filter((entry) => entry.id !== 'new') },
        { currentMonth: MONTH_1 },
      ).projection.map((row) => row.eventsCents);

      const diff = withNew.map((value, index) => value - (without[index] ?? 0));
      expect(diff).toEqual(
        Array.from({ length: 12 }, (_, index) => (index + 1 === month ? 1_000_000 : 0)),
      );
    },
  );

  it('añadir eventos no cambia el orden ni deja ninguno fuera: Σ P_k = Σ importes de los eventos del horizonte', () => {
    const events = dates.map((date, index) =>
      event(`e${String(index)}`, {
        amountCents: (index + 1) * 100,
        expectedDate: date,
        includeInProjection: true,
      }),
    );
    const total = calculatePlan(
      snapshot({ items: [income('s', 1)], events: [...events].reverse() }),
      {
        currentMonth: MONTH_1,
      },
    ).projection.reduce((sum, row) => sum + row.eventsCents, 0);
    expect(total).toBe((100 * (12 * 13)) / 2); // 100 + 200 + … + 1 200 = 7 800
  });
});

describe('error 2: «un total incluye una línea que su propio check excluye»', () => {
  // Para cada uno de los 10 estados, una línea esencial con ese estado: el gasto, los esenciales, los
  // recuentos y la comprobación tienen que coincidir porque usan el MISMO predicado includedInBase.
  it.each(STATUSES.map((entry) => entry.code))('estado «%s»', (status: Status) => {
    const plan = snapshot({
      items: [income('sal', 500_000), expense('x', 12_345, status), expense('y', 1_000)],
      budgetLines: [line('lx', 'x', true), line('ly', 'y', true)],
    });
    const { budget, checks } = calculatePlan(plan, { currentMonth: MONTH_1 });
    const included = includedInBase(status);

    expect(budget.expensesCents).toBe(1_000 + (included ? 12_345 : 0));
    expect(budget.essentialCents).toBe(budget.expensesCents);
    expect(budget.includedLineCount).toBe(included ? 2 : 1);

    const flagged = checks.checks.find((entry) => entry.code === 'ESSENTIAL_NOT_CONFIRMED');
    // La línea sale en el check si y solo si cuenta en el total y no está confirmada.
    expect(flagged?.subjects.includes('lx')).toBe(included && status !== 'confirmed');
  });

  it('el total del gasto es exactamente la suma de las líneas que el check considera incluidas', () => {
    const statuses = STATUSES.map((entry) => entry.code);
    const items = statuses.map((status, index) =>
      expense(`i${String(index)}`, (index + 1) * 111, status),
    );
    const plan = snapshot({
      items: [income('sal', 1_000_000), ...items],
      budgetLines: items.map((entry, index) => line(`l${String(index)}`, entry.id, true)),
    });
    const { budget } = calculatePlan(plan, { currentMonth: MONTH_1 });
    const expected = items
      .filter((entry) => includedInBase(entry.status))
      .reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0);
    expect(budget.expensesCents).toBe(expected);
    expect(budget.lines.filter((entry) => entry.included).length).toBe(budget.includedLineCount);
  });
});

describe('error 3: «Gastos esenciales» deja fuera la última línea por un error de rango', () => {
  it('E suma todas las líneas esenciales, también la última, aunque haya líneas no esenciales detrás', () => {
    const plan = snapshot({
      items: [
        income('sal', 500_000),
        expense('a', 80_000),
        expense('b', 6_000),
        expense('c', 35_000),
        expense('d', 4_000),
        expense('e', 12_000),
      ],
      budgetLines: [
        line('la', 'a', true),
        line('lb', 'b', true),
        line('lc', 'c', true),
        line('ld', 'd', false),
        line('le', 'e', true), // la última línea esencial
      ],
    });
    // 80 000 + 6 000 + 35 000 + 12 000 = 133 000. La plantilla sumaba solo las tres primeras (121 000).
    expect(calculatePlan(plan, { currentMonth: MONTH_1 }).budget.essentialCents).toBe(133_000);
  });
});

describe('error 4: «un escenario suma como extra una fila que ya está en la base»', () => {
  it('avisa con SCENARIO_ITEM_ALREADY_IN_BASE y el estado global pasa a PASS WITH WARNINGS', () => {
    const plan = snapshot({
      items: [
        income('sal', 100_000),
        expense('rent', 40_000),
        expense('light', 6_000, 'estimated'),
      ],
      budgetLines: [line('l1', 'rent', true), line('l2', 'light')],
      scenarios: [scenario('luz', ['light', 'extra_monthly'])],
    });
    const { checks } = calculatePlan(plan, { currentMonth: MONTH_1 });
    const found = checks.checks.find((entry) => entry.code === 'SCENARIO_ITEM_ALREADY_IN_BASE');
    expect(found).toMatchObject({ passed: false, severity: 'WARN', subjects: ['luz'] });
    expect(checks.overall).toBe('PASS_WITH_WARNINGS');
  });
});

describe('la excepción de los escenarios (§9.5)', () => {
  it('los escenarios cuentan filas que el plan base deja fuera; el gasto base no', () => {
    const plan = snapshot({
      items: [
        income('sal', 100_000),
        expense('rent', 40_000),
        expense('maybe', 9_000, 'potential'),
      ],
      budgetLines: [line('l1', 'rent')],
      scenarios: [scenario('s', ['maybe', 'extra_monthly'])],
    });
    const { budget, scenarios } = calculatePlan(plan, { currentMonth: MONTH_1 });
    expect(budget.expensesCents).toBe(40_000);
    expect(scenarios[0]?.extraCents).toBe(9_000);
    expect(scenarios[0]?.freeCashCents).toBe(51_000);
  });
});
