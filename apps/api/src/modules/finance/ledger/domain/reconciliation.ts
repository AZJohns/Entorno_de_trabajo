/**
 * Conciliación mensual (docs/plan.md §2.3): se compara el saldo calculado con el que muestra el banco
 * y, si difieren, se crea un movimiento de ajuste explícito (no se «arregla» el saldo inicial).
 * Funciones puras; la transacción que guarda la conciliación y el ajuste es del servicio.
 */
import { assertCents, type Cents } from '@backoffice/shared';
import { balanceAsOf, type AccountLedger } from './balances.ts';
import { assertLocalDate, isInMonth, type LocalDate } from './dates.ts';

/** Descripción de todos los movimientos de ajuste. */
export const RECONCILIATION_ADJUSTMENT_DESCRIPTION = 'Ajuste de conciliación';

/** Datos del movimiento de ajuste que hay que crear. */
export interface AdjustmentDraft {
  /** Ingreso si el banco tiene más de lo calculado; gasto si tiene menos. */
  readonly kind: 'income' | 'expense';
  /** Valor absoluto de la diferencia; siempre mayor que 0. */
  readonly amountCents: Cents;
  /** Es la fecha del saldo del banco, para que entre en el saldo calculado hasta esa fecha. */
  readonly bookedOn: LocalDate;
  readonly description: string;
}

/** Resultado de {@link reconcile}. */
export interface ReconciliationResult {
  /** Saldo calculado hasta `asOf`, antes del ajuste (lo que se guarda como registro histórico). */
  readonly computedBalanceCents: Cents;
  /** `saldo del banco − saldo calculado`. Positiva: al banco le sobra dinero respecto a la app. */
  readonly differenceCents: Cents;
  /** `null` si la diferencia es 0: no se crea un ajuste de 0 (la base de datos lo impediría). */
  readonly adjustment: AdjustmentDraft | null;
}

/** Datos de entrada de {@link reconcile}. */
export interface ReconcileInput {
  readonly ledger: AccountLedger;
  /** Primer día del mes que se concilia. */
  readonly month: LocalDate;
  /** Fecha del saldo del banco; debe estar dentro de `month`. */
  readonly asOf: LocalDate;
  readonly statementBalanceCents: Cents;
}

/**
 * Calcula la conciliación de una cuenta: saldo calculado hasta `asOf`, diferencia con el banco y, si
 * no es 0, el ajuste que las iguala.
 *
 * Tras guardar el ajuste, `balanceAsOf(ledger + ajuste, asOf)` es igual a `statementBalanceCents`.
 * El ajuste lleva la fecha `asOf` precisamente para que esto se cumpla.
 *
 * @throws {RangeError} si `month` no es un día 1, `asOf` no está dentro de `month`, o un importe no
 *   es un entero seguro.
 */
export function reconcile(input: ReconcileInput): ReconciliationResult {
  const { ledger, month, asOf } = input;
  assertLocalDate(month);
  assertLocalDate(asOf);
  if (!month.endsWith('-01')) {
    throw new RangeError(`El mes de la conciliación debe ser el día 1: ${month}`);
  }
  if (!isInMonth(asOf, month)) {
    throw new RangeError(`La fecha ${asOf} no está dentro del mes ${month}`);
  }

  const statement = assertCents(input.statementBalanceCents);
  const computed = balanceAsOf(ledger, asOf);
  const difference = assertCents(statement - computed);
  if (difference === 0) {
    return { computedBalanceCents: computed, differenceCents: 0, adjustment: null };
  }
  return {
    computedBalanceCents: computed,
    differenceCents: difference,
    adjustment: {
      kind: difference > 0 ? 'income' : 'expense',
      amountCents: assertCents(Math.abs(difference)),
      bookedOn: asOf,
      description: RECONCILIATION_ADJUSTMENT_DESCRIPTION,
    },
  };
}

/** Lo guardado de una conciliación que hace falta para detectar una discrepancia. */
export interface RecordedReconciliation {
  readonly asOf: LocalDate;
  /** `statement_balance_cents`: el saldo que mostraba el banco. */
  readonly statementBalanceCents: Cents;
}

/** Resultado de {@link reconciliationDiscrepancy}. */
export interface ReconciliationDiscrepancy {
  /** Saldo del banco registrado al conciliar. */
  readonly statementCents: Cents;
  /** Saldo calculado hoy hasta `asOf`, **con** el ajuste de la conciliación y los de las demás. */
  readonly currentCents: Cents;
  /** `currentCents − statementCents`; 0 si el libro sigue cuadrando con el banco. */
  readonly differenceCents: Cents;
  readonly hasDiscrepancy: boolean;
}

/**
 * Compara el saldo calculado **hoy** hasta la fecha de una conciliación con el saldo del banco que se
 * registró. Tras conciliar son iguales; si después cambia algo que afecta a ese saldo, el libro deja de
 * cuadrar con el banco y la pantalla debe avisar.
 *
 * Se compara con el saldo del banco, y no con el calculado al conciliar (`computed_balance_cents`)
 * quitando el ajuste propio, porque así se detectan también los cambios en el ajuste: uno editado o
 * borrado deja el saldo lejos del del banco, mientras que si se excluyera no se vería. Detecta, entre
 * otros:
 * - un movimiento o una transferencia editados, añadidos o borrados dentro del periodo;
 * - el ajuste de esta conciliación modificado o borrado;
 * - una conciliación de un mes **anterior** creada después: su ajuste, con fecha anterior, cambia el
 *   saldo de esta.
 *
 * El `computed_balance_cents` guardado no interviene: es el registro histórico de lo que se calculó al
 * conciliar y se muestra aparte.
 */
export function reconciliationDiscrepancy(
  ledger: AccountLedger,
  reconciliation: RecordedReconciliation,
): ReconciliationDiscrepancy {
  const statement = assertCents(reconciliation.statementBalanceCents);
  const current = balanceAsOf(ledger, reconciliation.asOf);
  const difference = assertCents(current - statement);
  return {
    statementCents: statement,
    currentCents: current,
    differenceCents: difference,
    hasDiscrepancy: difference !== 0,
  };
}
