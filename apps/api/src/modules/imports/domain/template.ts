/**
 * Contrato de la plantilla v2 (docs/plantilla-excel.md §2, §2.1, §6 y §14) en un único módulo de
 * configuración: nombres de hoja, cabeceras, etiquetas de resumen y límites. Si la plantilla cambia, se
 * cambia aquí y en el documento.
 */
import { columnNumber } from './formula.ts';

/** Versión de la plantilla que admite el importador. */
export const TEMPLATE_VERSION = 2;

/** Límites del archivo (§2). Valores iniciales: se ajustan midiendo la plantilla real. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 200;
/** Defensas propias (no del contrato): filas por tabla y problemas por importación. */
export const MAX_TABLE_ROWS = 5_000;
export const MAX_ISSUES = 2_000;

export const HEADER_ROW = 5;
export const FIRST_DATA_ROW = 6;

export const SHEET = {
  data: 'Datos y supuestos',
  budget: 'Presupuesto',
  events: 'Eventos y compromisos',
  goals: 'Metas',
  scenarios: 'Escenarios',
} as const;

/** Hojas solo calculadas: no se leen, solo se comprueba que existen (§6.6). */
export const CALCULATED_SHEETS = ['Proyección 12M', 'Checks', 'Dashboard'] as const;

export type InputSheetKey = keyof typeof SHEET;

/** Cabeceras de la fila 5, desde la columna A (§6). */
export const HEADERS: Readonly<Record<InputSheetKey, readonly string[]>> = {
  data: [
    'Grupo',
    'Concepto',
    'Valor',
    'Unidad',
    'Naturaleza',
    'Estado',
    'Fuente/fecha',
    'Nota',
    'Tipo de registro',
  ],
  budget: [
    'Categoría',
    'Concepto',
    'Tipo',
    'Esencial',
    'Mensual',
    'Anual',
    '% ingreso',
    'Estado del dato',
  ],
  events: ['Concepto', 'Naturaleza', 'Importe', 'Estado', 'Fecha prevista', 'Incluir 12M', 'Nota'],
  goals: [
    'Meta',
    'Objetivo',
    'Actual',
    'Pendiente',
    'Aportación/mes',
    'Meses',
    'Estado',
    'Criterio',
    'Tipo de meta',
  ],
  scenarios: [
    'Escenario',
    'Gasto base',
    'Extra mensual',
    'Pago puntual',
    'Salida total',
    'Caja libre',
    'Tasa libre',
    'Lectura',
  ],
};

/** Las tres cabeceras que distinguen la v2 de la v1 (§7) y el paso de §14 que falta si no están. */
export const VERSION_MARKERS = [
  {
    sheet: 'data',
    col: columnNumber('I'),
    label: 'Tipo de registro',
    step: '§14 paso 1: añadir la columna I «Tipo de registro»',
  },
  {
    sheet: 'events',
    col: columnNumber('G'),
    label: 'Nota',
    step: '§14 paso 3: eliminar «Impacto base» para que «Nota» pase a la columna G',
  },
  {
    sheet: 'goals',
    col: columnNumber('I'),
    label: 'Tipo de meta',
    step: '§14 paso 5: añadir la columna I «Tipo de meta»',
  },
] as const satisfies readonly { sheet: InputSheetKey; col: number; label: string; step: string }[];

/** Resúmenes de Presupuesto y Metas (§2.1): solo la primera etiqueta marca el fin de la tabla. */
export const PRESUPUESTO_SUMMARY_START: readonly string[] = ['Total gastos recurrentes conocidos'];
export const PRESUPUESTO_SUMMARY: readonly string[] = [
  'Total gastos recurrentes conocidos',
  'Ingresos netos mensuales',
  'Margen aparente después de gastos conocidos',
  'Tasa de ahorro aparente',
  'Gastos esenciales conocidos',
  'Integridad de categorías de gasto',
];
export const METAS_SUMMARY_START: readonly string[] = ['Aportación mensual propuesta'];
export const METAS_SUMMARY: readonly string[] = [
  'Aportación mensual propuesta',
  'Margen mensual conocido',
  'Margen no asignado',
  'Prueba de capacidad',
];

const c = columnNumber;

/** Columnas de cada hoja. */
export const COL = {
  data: {
    group: c('A'),
    concept: c('B'),
    value: c('C'),
    unit: c('D'),
    nature: c('E'),
    status: c('F'),
    source: c('G'),
    note: c('H'),
    recordType: c('I'),
  },
  budget: {
    category: c('A'),
    concept: c('B'),
    costType: c('C'),
    essential: c('D'),
    monthly: c('E'),
    annual: c('F'),
    pctIncome: c('G'),
    statusRef: c('H'),
  },
  events: {
    concept: c('A'),
    nature: c('B'),
    amount: c('C'),
    status: c('D'),
    date: c('E'),
    include: c('F'),
    note: c('G'),
  },
  goals: {
    name: c('A'),
    target: c('B'),
    current: c('C'),
    pending: c('D'),
    contribution: c('E'),
    months: c('F'),
    status: c('G'),
    criterion: c('H'),
    kind: c('I'),
  },
  scenarios: {
    name: c('A'),
    baseSpend: c('B'),
    extra: c('C'),
    oneOff: c('D'),
    total: c('E'),
    freeCash: c('F'),
    freeRate: c('G'),
    reading: c('H'),
  },
} as const;
