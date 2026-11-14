/**
 * Contrato entre el importador y los cálculos: toda foto que el importador deja confirmar (sin errores) se
 * puede calcular sin lanzar `RangeError`. Se recorren variaciones de la fixture FICTICIA que cambian la unidad
 * y el tipo de registro de cada fila de Datos, que es donde el importador solo avisaba.
 */
import { describe, expect, it } from 'vitest';
import { RECORD_TYPES, UNITS } from '@backoffice/shared';
import { calculatePlan } from '../../src/modules/finance/plan/domain/index.ts';
import { summarize } from '../../src/modules/imports/domain/summary.ts';
import { buildValidWorkbook, DATOS, FIXTURE_MONTH } from '../fixtures/plan-workbook.ts';
import { parseBook } from '../imports/helpers.ts';
import { snapshotFromExtracted } from './plan-builders.ts';

/** Filas de «Datos y supuestos» de la fixture (24 filas, de la 6 a la 29). */
const DATA_ROWS = Array.from({ length: 24 }, (_, index) => index + 6);

/** Cada barrido genera y lee unos 200 libros: con la suite entera en paralelo supera los 5 s por defecto. */
const SWEEP_TIMEOUT_MS = 60_000;

/** Valor que cuadra con la unidad: meses con dos decimales como mucho, importes en euros. */
const valueFor = (unit: string): number => (unit === 'meses' ? 6 : 100);

/** Si la variación se puede confirmar, la calcula; devuelve `null` si el importador la bloquea. */
function calculateIfConfirmable(mutate: (book: ReturnType<typeof buildValidWorkbook>) => void) {
  const book = buildValidWorkbook();
  mutate(book);
  const outcome = parseBook(book);
  if (outcome.stage !== 'preview') return null;
  if (!summarize(outcome.extracted, outcome.issues).canConfirm) return null;
  return () =>
    calculatePlan(snapshotFromExtracted(outcome.extracted, FIXTURE_MONTH), {
      currentMonth: FIXTURE_MONTH,
    });
}

describe('lo que el importador deja confirmar, los cálculos lo aceptan', () => {
  it('la fixture sin cambios', () => {
    const calculate = calculateIfConfirmable(() => undefined);
    expect(calculate).not.toBeNull();
    expect(calculate).not.toThrow();
  });

  it(
    'cambiando la unidad de cada fila de Datos (con un valor que cuadra con ella)',
    () => {
      let confirmable = 0;
      for (const row of DATA_ROWS) {
        for (const unit of UNITS) {
          const calculate = calculateIfConfirmable((book) => {
            book.sheet(DATOS).set(`D${String(row)}`, unit.label);
            book.sheet(DATOS).set(`C${String(row)}`, valueFor(unit.label));
          });
          if (calculate === null) continue;
          confirmable += 1;
          expect(calculate, `fila ${String(row)} en «${unit.label}»`).not.toThrow();
        }
      }
      // La propia fixture (24 filas con su unidad) cuenta: el barrido no es vacío.
      expect(confirmable).toBeGreaterThan(DATA_ROWS.length);
    },
    SWEEP_TIMEOUT_MS,
  );

  it(
    'cambiando el tipo de registro de cada fila de Datos',
    () => {
      let confirmable = 0;
      for (const row of DATA_ROWS) {
        for (const type of RECORD_TYPES) {
          const calculate = calculateIfConfirmable((book) => {
            book.sheet(DATOS).set(`I${String(row)}`, type.label);
          });
          if (calculate === null) continue;
          confirmable += 1;
          expect(calculate, `fila ${String(row)} como «${type.label}»`).not.toThrow();
        }
      }
      expect(confirmable).toBeGreaterThan(DATA_ROWS.length);
    },
    SWEEP_TIMEOUT_MS,
  );
});
