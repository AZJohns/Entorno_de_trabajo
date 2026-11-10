/**
 * Extracción y validación celda a celda de las cinco hojas de entrada (docs/plantilla-excel.md §4 a §7).
 *
 * Solo se extraen ENTRADAS. Nada se evalúa: las referencias entre hojas se leen del texto de la fórmula
 * (`formula.ts`) y se traducen a filas de «Datos y supuestos», nunca por el texto del concepto (§1.2).
 * Los problemas se recogen todos; una celda mala no detiene el resto.
 */
import {
  COST_TYPES,
  EVENT_STATUSES,
  GOAL_KINDS,
  NATURES,
  RECORD_TYPES,
  RECORD_TYPE_UNITS,
  STATUSES,
  UNITS,
  includedInBase,
  type ExtractedAmount,
  type ExtractedBudgetLine,
  type ExtractedEvent,
  type ExtractedGoal,
  type ExtractedItem,
  type ExtractedPlan,
  type ExtractedScenario,
  type RecordType,
  type Unit,
} from '@backoffice/shared';
import { CellReader } from './cells.ts';
import { extractDataReferences, parseFormula, a1, columnLetters, type CellRef } from './formula.ts';
import type { IssueCollector } from './issues.ts';
import { scanTable, type TableScan } from './layout.ts';
import { normalizeKey } from './normalize.ts';
import { COL, type InputSheetKey } from './template.ts';
import type { Sheet, Workbook } from './workbook.ts';

export interface ExtractInput {
  readonly workbook: Workbook;
  /** Nombre real de cada hoja en el archivo (puede diferir en mayúsculas o acentos). */
  readonly names: Readonly<Record<InputSheetKey, string>>;
  readonly issues: IssueCollector;
  /** Primer día del mes 1 del plan (`YYYY-MM-01`): el que se elige al subir el archivo. */
  readonly monthStart: string;
  /** Categoría de gasto de la app para un nombre normalizado, o `undefined` si no hay correspondencia. */
  readonly resolveCategory: (key: string) => string | undefined;
  /** Última fila de la zona de datos de Presupuesto y Metas (la anterior al resumen). */
  readonly lastRow: { readonly budget: number; readonly goals: number };
}

const SCENARIO_RANGE_LIMIT = 1_000;
const CLOSED_EVENT_STATUSES: ReadonlySet<string> = new Set(['paid', 'finished', 'inactive']);

/** Primer día del mes 12 posterior al mes 1: el horizonte de la proyección es `[monthStart, horizonEnd)`. */
function horizonEnd(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  return `${String(year + 1).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** Primera columna con contenido de una fila, para situar un aviso de fila. */
function firstFilledCol(sheet: Sheet, row: number): number {
  return sheet.columnsOf(row).find((col) => !sheet.isBlank(row, col)) ?? 1;
}

function warnAfterGap(issues: IssueCollector, sheet: Sheet, scan: TableScan): void {
  for (const row of scan.afterGap) {
    issues.add(
      'ROW_AFTER_GAP',
      sheet.name,
      row,
      firstFilledCol(sheet, row),
      `La fila ${String(row)} tiene datos tras una fila vacía: no se importa`,
    );
  }
}

/** Un literal distinto de 0 en una columna calculada es un aviso (§5, §6.2): la app lo recalcula. */
function warnCalculated(
  reader: CellReader,
  row: number,
  cols: readonly number[],
  label: (col: number) => string,
): void {
  for (const col of cols) {
    const cell = reader.sheet.cell(row, col);
    if (cell === undefined || cell.formula !== null || reader.blank(row, col)) continue;
    if (cell.value?.kind === 'number' && cell.value.value === 0) continue;
    reader.issues.add(
      'VALUE_IN_CALCULATED_COLUMN',
      reader.sheet.name,
      row,
      col,
      `«${label(col)}» es una columna calculada y tiene un valor escrito a mano: se ignora y la app lo recalcula`,
      { found: reader.found(row, col) },
    );
  }
}

/** Contexto de las referencias a «Datos y supuestos». */
interface DataIndex {
  readonly sheetName: string;
  readonly byRow: ReadonlyMap<number, ExtractedItem>;
}

function ref(sheetName: string, row: number, col: number): string {
  return `«${sheetName}»!${a1(row, col)}`;
}

/**
 * Resuelve una referencia a Datos: la columna tiene que ser la esperada (C para importes y meses, F para
 * estados) y la fila tiene que existir en la zona de datos y no estar vacía.
 */
function resolveRef(
  reader: CellReader,
  data: DataIndex,
  at: { row: number; col: number },
  target: CellRef,
  expectedCol: number,
  emptySeverity: 'error' | 'warning' = 'error',
): ExtractedItem | undefined {
  if (target.col !== expectedCol) {
    reader.issues.add(
      'REF_TARGET_COLUMN',
      reader.sheet.name,
      at.row,
      at.col,
      `La referencia apunta a la columna ${columnLetters(target.col)} y debería apuntar a la ${columnLetters(expectedCol)} de «${data.sheetName}»`,
      { expected: columnLetters(expectedCol), found: columnLetters(target.col) },
    );
    return undefined;
  }
  const item = data.byRow.get(target.row);
  if (item === undefined) {
    reader.issues.add(
      'REF_TARGET_EMPTY',
      reader.sheet.name,
      at.row,
      at.col,
      `${ref(data.sheetName, target.row, target.col)} está vacía o fuera de la zona de datos`,
      { severity: emptySeverity },
    );
    return undefined;
  }
  return item;
}

function typeSignal(
  reader: CellReader,
  at: { row: number; col: number },
  item: ExtractedItem,
  allowed: readonly RecordType[],
  use: string,
): void {
  if (item.recordType === null || allowed.includes(item.recordType)) return;
  const labels = allowed.map(
    (code) => RECORD_TYPES.find((entry) => entry.code === code)?.label ?? code,
  );
  reader.issues.add(
    'TYPE_SIGNAL_MISMATCH',
    reader.sheet.name,
    at.row,
    at.col,
    `La fila ${String(item.sourceRow)} de Datos se usa como ${use}, pero su tipo de registro es «${RECORD_TYPES.find((entry) => entry.code === item.recordType)?.label ?? ''}»`,
    { expected: labels.join(', ') },
  );
}

const unitLabel = (unit: Unit): string => UNITS.find((entry) => entry.code === unit)?.label ?? unit;

/** Comprueba la unidad de la fila referenciada; `severity` depende de la hoja (§11). */
function checkUnit(
  reader: CellReader,
  at: { row: number; col: number },
  item: ExtractedItem,
  expected: Unit,
  severity: 'error' | 'warning',
): boolean {
  if (item.unit === null || item.unit === expected) return true;
  reader.issues.add(
    'REF_UNIT_MISMATCH',
    reader.sheet.name,
    at.row,
    at.col,
    `La fila ${String(item.sourceRow)} de Datos está en «${unitLabel(item.unit)}» y aquí se espera «${unitLabel(expected)}»`,
    { severity, expected: unitLabel(expected), found: unitLabel(item.unit) },
  );
  return false;
}

// --- Datos y supuestos ------------------------------------------------------------------------------

function extractItems(input: ExtractInput, sheet: Sheet, scan: TableScan): ExtractedItem[] {
  const reader = new CellReader(sheet, input.issues, input.workbook.date1904);
  const c = COL.data;
  const items: ExtractedItem[] = [];

  for (const row of scan.rows) {
    const group = reader.text(row, c.group, 'Grupo', { required: true });
    const concept = reader.text(row, c.concept, 'Concepto', { required: true });
    const unit = reader.list(row, c.unit, 'Unidad', UNITS, { required: true });
    const nature = reader.list(row, c.nature, 'Naturaleza', NATURES, { required: true });
    const status = reader.list(row, c.status, 'Estado', STATUSES, { required: true });
    const source = reader.text(row, c.source, 'Fuente/fecha', { required: false, dateAsIso: true });
    const note = reader.text(row, c.note, 'Nota', { required: false });
    const recordType = reader.list(row, c.recordType, 'Tipo de registro', RECORD_TYPES, {
      required: true,
    });

    // El valor depende de la unidad: sin una unidad válida solo se puede comprobar que existe.
    let amountCents: number | null = null;
    let quantityHundredths: number | null = null;
    if (unit.state === 'ok') {
      if (unit.value === 'months') {
        const value = reader.months(row, c.value, 'Valor', { required: true });
        if (value.state === 'ok') quantityHundredths = value.value;
      } else {
        const value = reader.amount(row, c.value, 'Valor', { required: true });
        if (value.state === 'ok') amountCents = value.value;
      }
    } else if (reader.blank(row, c.value)) {
      reader.issues.add(
        'CELL_REQUIRED',
        sheet.name,
        row,
        c.value,
        'Falta un valor obligatorio: «Valor»',
      );
    }

    if (
      unit.state === 'ok' &&
      recordType.state === 'ok' &&
      !RECORD_TYPE_UNITS[recordType.value].includes(unit.value)
    ) {
      const typeLabel = RECORD_TYPES.find((entry) => entry.code === recordType.value)?.label ?? '';
      reader.issues.add(
        'TYPE_SIGNAL_MISMATCH',
        sheet.name,
        row,
        c.recordType,
        `La unidad «${unitLabel(unit.value)}» no es la esperada para el tipo de registro «${typeLabel}»`,
        { expected: RECORD_TYPE_UNITS[recordType.value].map(unitLabel).join(', ') },
      );
    }

    items.push({
      sourceRow: row,
      recordType: recordType.state === 'ok' ? recordType.value : null,
      groupLabel: group.state === 'ok' ? group.value : '',
      concept: concept.state === 'ok' ? concept.value : '',
      unit: unit.state === 'ok' ? unit.value : null,
      amountCents,
      quantityHundredths,
      nature: nature.state === 'ok' ? nature.value : null,
      status: status.state === 'ok' ? status.value : null,
      sourceNote: source.state === 'ok' ? source.value : null,
      note: note.state === 'ok' ? note.value : null,
    });
  }
  return items;
}

// --- Presupuesto -------------------------------------------------------------------------------------

interface BudgetResult {
  readonly lines: ExtractedBudgetLine[];
  /** Filas de Datos referenciadas por Mensual (para los avisos de doble cómputo y gastos sin presupuestar). */
  readonly referencedRows: ReadonlySet<number>;
}

function extractBudget(
  input: ExtractInput,
  sheet: Sheet,
  scan: TableScan,
  data: DataIndex,
): BudgetResult {
  const reader = new CellReader(sheet, input.issues, input.workbook.date1904);
  const c = COL.budget;
  const lines: ExtractedBudgetLine[] = [];
  const firstLineOfRow = new Map<number, number>();
  const referencedRows = new Set<number>();

  for (const row of scan.rows) {
    const category = reader.text(row, c.category, 'Categoría', { required: true });
    const concept = reader.text(row, c.concept, 'Concepto', { required: true });
    const costType = reader.list(row, c.costType, 'Tipo', COST_TYPES, { required: true });
    const essential = reader.yesNo(row, c.essential, 'Esencial', { required: true });

    const categoryKey = category.state === 'ok' ? normalizeKey(category.value) : '';
    let categoryId: string | null = null;
    if (category.state === 'ok') {
      categoryId = input.resolveCategory(categoryKey) ?? null;
      if (categoryId === null) {
        input.issues.add(
          'CATEGORY_UNMAPPED',
          sheet.name,
          row,
          c.category,
          `La categoría «${category.value}» no tiene correspondencia con una categoría de gasto de la app`,
          { found: category.value },
        );
      }
    }

    const monthly = readRequiredRef(reader, data, row, c.monthly, 'Mensual', 3);
    const statusRef = readRequiredRef(reader, data, row, c.statusRef, 'Estado del dato', 6);

    let itemRow: number | null = null;
    if (monthly.target !== undefined) {
      itemRow = monthly.target.row;
      referencedRows.add(itemRow);
    }
    if (monthly.item !== undefined) {
      checkUnit(reader, { row, col: c.monthly }, monthly.item, 'eur_per_month', 'error');
      typeSignal(
        reader,
        { row, col: c.monthly },
        monthly.item,
        ['expense'],
        'gasto de Presupuesto',
      );
    }
    if (
      monthly.target !== undefined &&
      statusRef.target !== undefined &&
      monthly.target.row !== statusRef.target.row
    ) {
      input.issues.add(
        'REF_ROWS_MISMATCH',
        sheet.name,
        row,
        c.statusRef,
        `Mensual apunta a la fila ${String(monthly.target.row)} y Estado del dato a la ${String(statusRef.target.row)} de Datos: deben ser la misma`,
        { expected: String(monthly.target.row), found: String(statusRef.target.row) },
      );
    }
    if (itemRow !== null) {
      const first = firstLineOfRow.get(itemRow);
      if (first === undefined) {
        firstLineOfRow.set(itemRow, row);
      } else {
        input.issues.add(
          'DUPLICATE_REFERENCE',
          sheet.name,
          row,
          c.monthly,
          `La fila ${String(itemRow)} de Datos ya la usa la línea ${String(first)}: el gasto contaría dos veces`,
        );
      }
    }
    warnCalculated(reader, row, [c.annual, c.pctIncome], (col) =>
      col === c.annual ? 'Anual' : '% ingreso',
    );

    lines.push({
      sourceRow: row,
      categoryLabel: category.state === 'ok' ? category.value : '',
      categoryKey,
      categoryId,
      concept: concept.state === 'ok' ? concept.value : '',
      costType: costType.state === 'ok' ? costType.value : null,
      essential: essential.state === 'ok' ? essential.value : null,
      itemRow: monthly.item === undefined ? null : monthly.item.sourceRow,
      statusItemRow: statusRef.item === undefined ? null : statusRef.item.sourceRow,
    });
  }
  return { lines, referencedRows };
}

interface RequiredRef {
  /** Destino sintáctico de la referencia (aunque la fila esté vacía). */
  readonly target?: CellRef;
  /** Fila de Datos resuelta, si todo es correcto. */
  readonly item?: ExtractedItem;
}

/**
 * Lee una celda que exige una REF (§5): vacía → `CELL_REQUIRED`; un literal → `FORMULA_REQUIRED` [DECISIÓN];
 * otra forma → `REF_UNSUPPORTED`.
 */
function readRequiredRef(
  reader: CellReader,
  data: DataIndex,
  row: number,
  col: number,
  label: string,
  expectedCol: number,
): RequiredRef {
  if (reader.blank(row, col)) {
    reader.issues.add(
      'CELL_REQUIRED',
      reader.sheet.name,
      row,
      col,
      `Falta un valor obligatorio: «${label}»`,
    );
    return {};
  }
  const cell = reader.sheet.cell(row, col);
  if (cell?.formula === null || cell === undefined) {
    reader.issues.add(
      'FORMULA_REQUIRED',
      reader.sheet.name,
      row,
      col,
      `«${label}» tiene que ser una referencia a «${data.sheetName}», no un valor escrito a mano`,
      { found: reader.found(row, col) },
    );
    return {};
  }
  const parsed = parseFormula(cell.formula, data.sheetName);
  if (parsed.form !== 'ref') return unsupported(reader, row, col, label, cell.formula);
  const item = resolveRef(reader, data, { row, col }, parsed, expectedCol);
  return item === undefined ? { target: parsed } : { target: parsed, item };
}

function unsupported(
  reader: CellReader,
  row: number,
  col: number,
  label: string,
  formula: string,
): RequiredRef {
  reader.issues.add(
    'REF_UNSUPPORTED',
    reader.sheet.name,
    row,
    col,
    `La fórmula de «${label}» no es una forma admitida (referencia directa, SUM de un rango, producto de dos referencias o =0)`,
    { found: `=${formula}` },
  );
  return {};
}

// --- Eventos y compromisos --------------------------------------------------------------------------

function extractEvents(
  input: ExtractInput,
  sheet: Sheet,
  scan: TableScan,
  data: DataIndex,
  budgetRows: ReadonlySet<number>,
): ExtractedEvent[] {
  const reader = new CellReader(sheet, input.issues, input.workbook.date1904);
  const c = COL.events;
  const events: ExtractedEvent[] = [];
  const end = horizonEnd(input.monthStart);

  for (const row of scan.rows) {
    const concept = reader.text(row, c.concept, 'Concepto', { required: true });
    const nature = reader.text(row, c.nature, 'Naturaleza', { required: false });
    const status = reader.list(row, c.status, 'Estado', EVENT_STATUSES, { required: true });
    const include = reader.yesNo(row, c.include, 'Incluir 12M', { required: true });
    const note = reader.text(row, c.note, 'Nota', { required: false });

    // La fecha solo es obligatoria si el evento entra en la proyección (§6.3).
    let expectedDate: string | null = null;
    if (reader.blank(row, c.date)) {
      if (include.state === 'ok' && include.value) {
        input.issues.add(
          'EVENT_DATE_REQUIRED',
          sheet.name,
          row,
          c.date,
          'Un evento incluido en la proyección necesita «Fecha prevista»',
        );
      }
    } else {
      const date = reader.date(row, c.date, 'Fecha prevista', { required: false });
      if (date.state === 'ok') expectedDate = date.value;
    }

    const amount = readEventAmount(reader, data, row, c.amount);

    if (include.state === 'ok' && include.value) {
      if (status.state === 'ok' && CLOSED_EVENT_STATUSES.has(status.value)) {
        input.issues.add(
          'EVENT_INCLUDED_BUT_CLOSED',
          sheet.name,
          row,
          c.include,
          `El evento está incluido en la proyección pero su estado es «${EVENT_STATUSES.find((entry) => entry.code === status.value)?.label ?? ''}»`,
        );
      }
      if (expectedDate !== null) {
        if (
          expectedDate < input.monthStart &&
          !(status.state === 'ok' && status.value === 'paid')
        ) {
          input.issues.add(
            'EVENT_OVERDUE',
            sheet.name,
            row,
            c.date,
            'Evento vencido: su fecha es anterior al mes 1 del plan y no está pagado',
            { found: expectedDate },
          );
        } else if (expectedDate >= end) {
          input.issues.add(
            'EVENT_AFTER_HORIZON',
            sheet.name,
            row,
            c.date,
            'La fecha prevista queda fuera de los 12 meses de la proyección',
            { found: expectedDate },
          );
        }
      }
      const cuota =
        amount.amountItemRow === null ? undefined : data.byRow.get(amount.amountItemRow);
      if (
        cuota !== undefined &&
        budgetRows.has(cuota.sourceRow) &&
        cuota.status !== null &&
        includedInBase(cuota.status)
      ) {
        input.issues.add(
          'EVENT_ITEM_ALREADY_IN_BASE',
          sheet.name,
          row,
          c.amount,
          `El importe del evento es la fila ${String(cuota.sourceRow)} de Datos, que ya está en el gasto base del Presupuesto: la proyección restaría el mismo dinero dos veces`,
        );
      }
    }

    events.push({
      sourceRow: row,
      concept: concept.state === 'ok' ? concept.value : '',
      natureLabel: nature.state === 'ok' ? nature.value : null,
      amountCents: amount.amountCents,
      amountItemRow: amount.amountItemRow,
      multiplierItemRow: amount.multiplierItemRow,
      status: status.state === 'ok' ? status.value : null,
      expectedDate,
      includeInProjection: include.state === 'ok' ? include.value : null,
      note: note.state === 'ok' ? note.value : null,
    });
  }
  return events;
}

interface EventAmount {
  readonly amountCents: number | null;
  readonly amountItemRow: number | null;
  readonly multiplierItemRow: number | null;
}

const NO_AMOUNT: EventAmount = { amountCents: null, amountItemRow: null, multiplierItemRow: null };

/** Importe de un evento (§6.3): literal, REF a una fila (€ o €/mes) o PRODUCT2 cuota × plazo. */
function readEventAmount(
  reader: CellReader,
  data: DataIndex,
  row: number,
  col: number,
): EventAmount {
  if (reader.blank(row, col)) {
    reader.issues.add(
      'CELL_REQUIRED',
      reader.sheet.name,
      row,
      col,
      'Falta un valor obligatorio: «Importe»',
    );
    return NO_AMOUNT;
  }
  const cell = reader.sheet.cell(row, col);
  if (cell === undefined) return NO_AMOUNT;
  if (cell.formula === null) {
    const amount = reader.amount(row, col, 'Importe', { required: true });
    return amount.state === 'ok' ? { ...NO_AMOUNT, amountCents: amount.value } : NO_AMOUNT;
  }
  const at = { row, col };
  const parsed = parseFormula(cell.formula, data.sheetName);
  const allowed: readonly RecordType[] = ['one_off_payment', 'expense', 'scenario'];

  if (parsed.form === 'ref') {
    const item = resolveRef(reader, data, at, parsed, 3);
    if (item === undefined) return NO_AMOUNT;
    typeSignal(reader, at, item, allowed, 'importe de un evento');
    if (item.unit === 'months') {
      checkUnit(reader, at, item, 'eur', 'error');
      return NO_AMOUNT;
    }
    if (item.unit === 'eur_per_month') {
      reader.issues.add(
        'EVENT_REF_MONTHLY',
        reader.sheet.name,
        row,
        col,
        `El importe apunta a la fila ${String(item.sourceRow)} de Datos, que está en €/mes: se proyecta un único pago igual a la cuota mensual en la fecha prevista`,
      );
    }
    return { ...NO_AMOUNT, amountItemRow: item.sourceRow };
  }
  if (parsed.form === 'product') {
    const first = resolveRef(reader, data, at, parsed.a, 3);
    const second = resolveRef(reader, data, at, parsed.b, 3);
    if (first === undefined || second === undefined) return NO_AMOUNT;
    // Una fila en €/mes y otra en meses, en cualquier orden (§5).
    const monthly = [first, second].find((item) => item.unit === 'eur_per_month');
    const months = [first, second].find((item) => item.unit === 'months');
    if (monthly === undefined || months === undefined) {
      reader.issues.add(
        'REF_UNIT_MISMATCH',
        reader.sheet.name,
        row,
        col,
        'El producto debe ser una fila en €/mes por una fila en meses',
        { expected: '€/mes × meses' },
      );
      return NO_AMOUNT;
    }
    typeSignal(reader, at, monthly, allowed, 'cuota de un evento');
    return { ...NO_AMOUNT, amountItemRow: monthly.sourceRow, multiplierItemRow: months.sourceRow };
  }
  reader.issues.add(
    'REF_UNSUPPORTED',
    reader.sheet.name,
    row,
    col,
    'La fórmula de «Importe» no es una forma admitida en Eventos (referencia directa o producto de dos referencias)',
    { found: `=${cell.formula}` },
  );
  return NO_AMOUNT;
}

// --- Metas ----------------------------------------------------------------------------------------

function extractGoals(
  input: ExtractInput,
  sheet: Sheet,
  scan: TableScan,
  data: DataIndex,
  items: readonly ExtractedItem[],
): ExtractedGoal[] {
  const reader = new CellReader(sheet, input.issues, input.workbook.date1904);
  const c = COL.goals;
  const goals: ExtractedGoal[] = [];
  const monthsRows = items.filter((item) => item.recordType === 'emergency_fund_months');
  const goalLabel = (col: number): string =>
    col === c.pending ? 'Pendiente' : col === c.months ? 'Meses' : 'Estado';
  let emergencyGoals = 0;

  for (const row of scan.rows) {
    const name = reader.text(row, c.name, 'Meta', { required: true });
    const kind = reader.list(row, c.kind, 'Tipo de meta', GOAL_KINDS, { required: true });
    const criterion = reader.text(row, c.criterion, 'Criterio', { required: false });
    const emergency = kind.state === 'ok' && kind.value === 'emergency_fund';

    if (emergency) {
      emergencyGoals += 1;
      // Como mucho una (índice único en la base de datos): las demás son un valor no admisible.
      if (emergencyGoals > 1) {
        input.issues.add(
          'VALUE_NOT_IN_LIST',
          sheet.name,
          row,
          c.kind,
          'Solo puede haber una meta de «Fondo de emergencia»',
          { expected: 'Importe fijo' },
        );
      }
      if (monthsRows.length === 0) {
        input.issues.add(
          'EMERGENCY_FUND_MONTHS_MISSING',
          sheet.name,
          row,
          c.kind,
          'Hay una meta de fondo de emergencia pero ninguna fila de Datos de tipo «Meses de fondo de emergencia»',
        );
      }
    }

    let target: ExtractedAmount | null = null;
    if (emergency) {
      // B es una columna calculada en el fondo de emergencia (§6.4): solo se miran sus referencias.
      const cell = reader.sheet.cell(row, c.target);
      const only = monthsRows.length === 1 ? monthsRows[0] : undefined;
      if (cell?.formula !== undefined && cell.formula !== null && only !== undefined) {
        const stray = extractDataReferences(cell.formula, data.sheetName).filter(
          (r) => r !== only.sourceRow,
        );
        if (stray.length > 0) {
          input.issues.add(
            'TYPE_SIGNAL_MISMATCH',
            sheet.name,
            row,
            c.target,
            `El objetivo del fondo de emergencia menciona la fila ${String(stray[0])} de Datos y la fila de meses es la ${String(only.sourceRow)}`,
            { expected: `fila ${String(only.sourceRow)}` },
          );
        }
      }
    } else {
      target = readGoalAmount(reader, data, row, c.target, 'Objetivo', 'eur', kind.state === 'ok');
    }
    const current = readGoalAmount(reader, data, row, c.current, 'Actual', 'eur', true);
    const contribution = readGoalAmount(
      reader,
      data,
      row,
      c.contribution,
      'Aportación/mes',
      'eur_per_month',
      true,
    );
    warnCalculated(reader, row, [c.pending, c.months, c.status], goalLabel);

    goals.push({
      sourceRow: row,
      name: name.state === 'ok' ? name.value : '',
      goalKind: kind.state === 'ok' ? kind.value : null,
      target,
      current,
      contribution,
      criterion: criterion.state === 'ok' ? criterion.value : null,
    });
  }
  return goals;
}

/** Importe de una meta: literal o REF a una fila de Datos con la unidad esperada (§6.4). */
function readGoalAmount(
  reader: CellReader,
  data: DataIndex,
  row: number,
  col: number,
  label: string,
  unit: Unit,
  required: boolean,
): ExtractedAmount | null {
  if (reader.blank(row, col)) {
    if (required) {
      reader.issues.add(
        'CELL_REQUIRED',
        reader.sheet.name,
        row,
        col,
        `Falta un valor obligatorio: «${label}»`,
      );
    }
    return null;
  }
  const cell = reader.sheet.cell(row, col);
  if (cell === undefined) return null;
  if (cell.formula === null) {
    const amount = reader.amount(row, col, label, { required: true });
    return amount.state === 'ok' ? { kind: 'literal', cents: amount.value } : null;
  }
  const parsed = parseFormula(cell.formula, data.sheetName);
  if (parsed.form !== 'ref') {
    unsupported(reader, row, col, label, cell.formula);
    return null;
  }
  const item = resolveRef(reader, data, { row, col }, parsed, 3);
  if (item === undefined) return null;
  typeSignal(
    reader,
    { row, col },
    item,
    ['goal', 'savings_balance', 'assumption'],
    'dato de una meta',
  );
  // La unidad decide el cálculo de la meta: aquí es un error, como en Presupuesto.
  if (!checkUnit(reader, { row, col }, item, unit, 'error')) return null;
  return { kind: 'item', row: item.sourceRow };
}

// --- Escenarios -----------------------------------------------------------------------------------

function extractScenarios(
  input: ExtractInput,
  sheet: Sheet,
  scan: TableScan,
  data: DataIndex,
  budgetRows: ReadonlySet<number>,
): ExtractedScenario[] {
  const reader = new CellReader(sheet, input.issues, input.workbook.date1904);
  const c = COL.scenarios;
  const scenarios: ExtractedScenario[] = [];
  const calculated = [c.baseSpend, c.total, c.freeCash, c.freeRate, c.reading];
  const calcLabel = (col: number): string =>
    ({
      [c.baseSpend]: 'Gasto base',
      [c.total]: 'Salida total',
      [c.freeCash]: 'Caja libre',
      [c.freeRate]: 'Tasa libre',
      [c.reading]: 'Lectura',
    })[col] ?? '';

  for (const row of scan.rows) {
    const name = reader.text(row, c.name, 'Escenario', { required: true });
    const extra = readScenarioList(reader, data, row, c.extra, 'Extra mensual', 'eur_per_month');
    const oneOff = readScenarioList(reader, data, row, c.oneOff, 'Pago puntual', 'eur');
    warnCalculated(reader, row, calculated, calcLabel);

    for (const itemRow of extra) {
      const item = data.byRow.get(itemRow);
      if (
        item !== undefined &&
        budgetRows.has(itemRow) &&
        item.status !== null &&
        includedInBase(item.status)
      ) {
        input.issues.add(
          'SCENARIO_ITEM_ALREADY_IN_BASE',
          sheet.name,
          row,
          c.extra,
          `El extra del escenario incluye la fila ${String(itemRow)} de Datos, que ya está en el gasto base: se sumaría dos veces`,
        );
      }
    }
    scenarios.push({
      sourceRow: row,
      name: name.state === 'ok' ? name.value : '',
      extraMonthlyRows: extra,
      oneOffRows: oneOff,
    });
  }
  return scenarios;
}

/** Lista de filas de Datos de una celda de Escenarios (§5, §6.5): `=0`, REF o SUM de un rango contiguo de C. */
function readScenarioList(
  reader: CellReader,
  data: DataIndex,
  row: number,
  col: number,
  label: string,
  unit: Unit,
): number[] {
  if (reader.blank(row, col)) {
    reader.issues.add(
      'CELL_REQUIRED',
      reader.sheet.name,
      row,
      col,
      `Falta un valor obligatorio: «${label}» (usa =0 si no hay nada)`,
    );
    return [];
  }
  const cell = reader.sheet.cell(row, col);
  if (cell === undefined) return [];
  if (cell.formula === null) {
    // Un literal 0 se acepta como ZERO; cualquier otro, no (§6.5).
    if (cell.value?.kind === 'number' && cell.value.value === 0) return [];
    reader.issues.add(
      'FORMULA_REQUIRED',
      reader.sheet.name,
      row,
      col,
      `«${label}» tiene que ser una fórmula (=0, una referencia o SUM de un rango de «${data.sheetName}»), no un valor escrito a mano`,
      { found: reader.found(row, col) },
    );
    return [];
  }
  const at = { row, col };
  const parsed = parseFormula(cell.formula, data.sheetName);
  const allowed: readonly RecordType[] = ['scenario', 'expense', 'income'];

  if (parsed.form === 'zero') return [];
  if (parsed.form === 'ref') {
    const item = resolveRef(reader, data, at, parsed, 3);
    if (item === undefined) return [];
    typeSignal(reader, at, item, allowed, 'dato de un escenario');
    checkUnit(reader, at, item, unit, 'warning');
    return [item.sourceRow];
  }
  if (parsed.form === 'sum') {
    if (parsed.col !== 3) {
      reader.issues.add(
        'REF_TARGET_COLUMN',
        reader.sheet.name,
        row,
        col,
        `El rango suma la columna ${columnLetters(parsed.col)} y debería sumar la C de «${data.sheetName}»`,
        { expected: 'C', found: columnLetters(parsed.col) },
      );
      return [];
    }
    if (parsed.toRow - parsed.fromRow + 1 > SCENARIO_RANGE_LIMIT) {
      unsupported(reader, row, col, label, cell.formula);
      return [];
    }
    const rows: number[] = [];
    for (let target = parsed.fromRow; target <= parsed.toRow; target += 1) {
      const item = data.byRow.get(target);
      if (item === undefined) {
        // Dentro de un SUMRANGE una fila vacía solo avisa y se omite (§5).
        reader.issues.add(
          'REF_TARGET_EMPTY',
          reader.sheet.name,
          row,
          col,
          `${ref(data.sheetName, target, 3)} está vacía o fuera de la zona de datos: se omite`,
          { severity: 'warning' },
        );
        continue;
      }
      typeSignal(reader, at, item, allowed, 'dato de un escenario');
      checkUnit(reader, at, item, unit, 'warning');
      rows.push(target);
    }
    return rows;
  }
  unsupported(reader, row, col, label, cell.formula);
  return [];
}

// --- orquestación ---------------------------------------------------------------------------------

/** Lee las cinco hojas de entrada, valida y devuelve lo extraído. Los problemas van al recolector. */
export function extractPlan(input: ExtractInput): ExtractedPlan {
  const { workbook, names, issues } = input;
  const dataSheet = workbook.sheet(names.data);
  const c = COL;

  const dataScan = scanTable(dataSheet, {
    emptyCols: Object.values(c.data),
    laterCols: 'any',
  });
  warnAfterGap(issues, dataSheet, dataScan);
  const items = extractItems(input, dataSheet, dataScan);
  const data: DataIndex = {
    sheetName: dataSheet.name,
    byRow: new Map(items.map((item) => [item.sourceRow, item])),
  };

  // El tipo «Meses de fondo de emergencia» solo puede aparecer una vez (índice único parcial).
  const monthsRows = items.filter((item) => item.recordType === 'emergency_fund_months');
  for (const extra of monthsRows.slice(1)) {
    issues.add(
      'EMERGENCY_FUND_MONTHS_DUPLICATED',
      dataSheet.name,
      extra.sourceRow,
      c.data.recordType,
      'Hay más de una fila de «Meses de fondo de emergencia»',
    );
  }

  const budgetSheet = workbook.sheet(names.budget);
  const budgetScan = scanTable(budgetSheet, {
    emptyCols: [
      c.budget.category,
      c.budget.concept,
      c.budget.costType,
      c.budget.essential,
      c.budget.monthly,
      c.budget.statusRef,
    ],
    laterCols: [
      c.budget.category,
      c.budget.concept,
      c.budget.costType,
      c.budget.essential,
      c.budget.monthly,
      c.budget.statusRef,
    ],
    lastRow: input.lastRow.budget,
  });
  warnAfterGap(issues, budgetSheet, budgetScan);
  const budget = extractBudget(input, budgetSheet, budgetScan, data);

  const eventsSheet = workbook.sheet(names.events);
  const eventsScan = scanTable(eventsSheet, {
    emptyCols: Object.values(c.events),
    laterCols: 'any',
  });
  warnAfterGap(issues, eventsSheet, eventsScan);
  const events = extractEvents(input, eventsSheet, eventsScan, data, budget.referencedRows);

  const goalsSheet = workbook.sheet(names.goals);
  const goalsScan = scanTable(goalsSheet, {
    emptyCols: [
      c.goals.name,
      c.goals.target,
      c.goals.current,
      c.goals.contribution,
      c.goals.criterion,
      c.goals.kind,
    ],
    laterCols: [
      c.goals.name,
      c.goals.target,
      c.goals.current,
      c.goals.contribution,
      c.goals.criterion,
      c.goals.kind,
    ],
    lastRow: input.lastRow.goals,
  });
  warnAfterGap(issues, goalsSheet, goalsScan);
  const goals = extractGoals(input, goalsSheet, goalsScan, data, items);

  const scenariosSheet = workbook.sheet(names.scenarios);
  // Tras el fin, una fila con contenido solo en A es una nota; con contenido en C o D, un aviso (§2.1).
  const scenariosScan = scanTable(scenariosSheet, {
    emptyCols: [c.scenarios.name, c.scenarios.extra, c.scenarios.oneOff],
    laterCols: [c.scenarios.extra, c.scenarios.oneOff],
  });
  warnAfterGap(issues, scenariosSheet, scenariosScan);
  const scenarios = extractScenarios(
    input,
    scenariosSheet,
    scenariosScan,
    data,
    budget.referencedRows,
  );

  // Un gasto incluido que ninguna línea de Presupuesto referencia: queda fuera de los cálculos (§7).
  for (const item of items) {
    if (
      item.recordType === 'expense' &&
      item.status !== null &&
      includedInBase(item.status) &&
      !budget.referencedRows.has(item.sourceRow)
    ) {
      issues.add(
        'EXPENSE_NOT_BUDGETED',
        dataSheet.name,
        item.sourceRow,
        c.data.value,
        `El gasto «${item.concept}» está incluido en el plan pero ninguna línea de Presupuesto lo referencia`,
      );
    }
  }

  return { items, budgetLines: budget.lines, events, goals, scenarios };
}
