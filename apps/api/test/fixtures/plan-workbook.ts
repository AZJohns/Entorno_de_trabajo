/**
 * Libro VÁLIDO y FICTICIO de la plantilla v2 (docs/plantilla-excel.md §12): conceptos genéricos e importes
 * redondos inventados, con la disposición real de la plantilla (resumen de Presupuesto tras una fila vacía,
 * Metas con dos filas vacías antes del resumen, notas en las posiciones confirmadas y un comentario de
 * celda que debe ignorarse). Las variantes con errores se generan en los tests a partir de una copia.
 *
 * Mes 1 del plan en los tests: 2026-11. Los resultados esperados están en `plan-ficticio-v2.expected.md`.
 */
import { WorkbookBuilder, type CellSpec } from './xlsx-builder.ts';

export const DATOS = 'Datos y supuestos';
export const PRESUPUESTO = 'Presupuesto';
export const EVENTOS = 'Eventos y compromisos';
export const METAS = 'Metas';
export const ESCENARIOS = 'Escenarios';
export const PROYECCION = 'Proyección 12M';
export const CHECKS = 'Checks';
export const DASHBOARD = 'Dashboard';

/** Mes 1 que usan los tests de la fixture. */
export const FIXTURE_MONTH = '2026-11';

/** Referencia a una fila de «Datos y supuestos» como la guarda Excel (con `$`). */
export const dataRef = (col: 'C' | 'F', row: number): string => `'${DATOS}'!$${col}$${String(row)}`;

type Row = readonly (CellSpec | undefined)[];

/** Filas de «Datos y supuestos» (A..I), desde la fila 6. */
const DATOS_ROWS: readonly Row[] = [
  /* 6 */ [
    'Ingresos',
    'Salario neto',
    2500,
    '€/mes',
    'Recurrente',
    'Confirmado',
    undefined,
    undefined,
    'Ingreso',
  ],
  /* 7 */ [
    'Ingresos',
    'Ingreso extra',
    300,
    '€/mes',
    'Variable',
    'Estimado',
    { date: '2026-10-15' },
    'Fuente anotada como fecha',
    'Ingreso',
  ],
  /* 8 */ [
    'Vivienda',
    'Alquiler',
    800,
    '€/mes',
    'Recurrente',
    'Confirmado',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 9 */ [
    'Suministros',
    'Electricidad',
    60,
    '€/mes',
    'Variable',
    'Estimado',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 10 */ [
    'Alimentación',
    'Supermercado',
    350,
    '€/mes',
    'Variable',
    'Confirmar',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 11 */ [
    'Transporte',
    'Abono de transporte',
    40,
    '€/mes',
    'Recurrente',
    'Pendiente',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 12 */ [
    'Seguros',
    'Seguro anual (equivalente mensual)',
    25,
    '€/mes',
    'Irregular',
    'Provisional',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 13 */ [
    'Ocio',
    'Suscripciones',
    30,
    '€/mes',
    'Recurrente',
    'Confirmar pagado',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 14 */ [
    'Pruebas',
    'Gasto potencial',
    100,
    '€/mes',
    'Potencial',
    'Potencial',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 15 */ [
    'Pruebas',
    'Gasto pausado',
    15,
    '€/mes',
    'Recurrente',
    'Pausado',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 16 */ [
    'Ahorro',
    'Saldo cuenta de ahorro A',
    5000,
    '€',
    'Saldo',
    'Confirmado',
    undefined,
    undefined,
    'Saldo de ahorro',
  ],
  /* 17 */ [
    'Ahorro',
    'Saldo cuenta de ahorro B',
    1500,
    '€',
    'Acumulado',
    'Estimado',
    undefined,
    undefined,
    'Saldo de ahorro',
  ],
  /* 18 */ [
    'Supuestos',
    'Meses de fondo de emergencia',
    6,
    'meses',
    'Objetivo',
    'Confirmado',
    undefined,
    undefined,
    'Meses de fondo de emergencia',
  ],
  /* 19 */ [
    'Metas',
    'Objetivo del viaje',
    3000,
    '€',
    'Objetivo',
    'Confirmado',
    undefined,
    undefined,
    'Meta',
  ],
  /* 20 */ [
    'Metas',
    'Aportación al viaje',
    150,
    '€/mes',
    'Objetivo',
    'Confirmado',
    undefined,
    undefined,
    'Meta',
  ],
  /* 21 */ [
    'Metas',
    'Aportación al fondo',
    200,
    '€/mes',
    'Objetivo',
    'Pendiente',
    undefined,
    undefined,
    'Meta',
  ],
  /* 22 */ [
    'Escenarios',
    'Extra: curso',
    80,
    '€/mes',
    'Supuesto',
    'Potencial',
    undefined,
    undefined,
    'Escenario',
  ],
  /* 23 */ [
    'Escenarios',
    'Extra: gimnasio',
    45,
    '€/mes',
    'Supuesto',
    'Potencial',
    undefined,
    undefined,
    'Escenario',
  ],
  /* 24 */ [
    'Escenarios',
    'Pago puntual: reparación',
    600,
    '€',
    'Puntual',
    'Potencial',
    undefined,
    undefined,
    'Escenario',
  ],
  /* 25 */ [
    'Eventos',
    'Seguro del coche (pago único)',
    450,
    '€',
    'Puntual',
    'Estimado',
    undefined,
    undefined,
    'Pago puntual',
  ],
  /* 26 */ [
    'Eventos',
    'Cuota del préstamo',
    120,
    '€/mes',
    'Recurrente',
    'Confirmado',
    undefined,
    undefined,
    'Gasto',
  ],
  /* 27 */ [
    'Eventos',
    'Plazo del préstamo',
    18,
    'meses',
    'Supuesto',
    'Confirmado',
    undefined,
    undefined,
    'Supuesto',
  ],
  /* 28 */ [
    'Histórico',
    'Gasto antiguo',
    70,
    '€/mes',
    'Pagado',
    'Histórico',
    undefined,
    undefined,
    'Histórico',
  ],
  /* 29 */ [
    'Pruebas',
    'Servicio dado de baja',
    20,
    '€/mes',
    'Finalizado',
    'No activo',
    undefined,
    undefined,
    'Gasto',
  ],
];

/** Fila de «Datos y supuestos» (1-based) de cada concepto, para que los tests no cuenten filas a mano. */
export const DATA_ROW = {
  salary: 6,
  rent: 8,
  electricity: 9,
  groceries: 10,
  insurance: 12,
  potentialExpense: 14,
  savingsA: 16,
  savingsB: 17,
  emergencyMonths: 18,
  goalTarget: 19,
  goalContribution: 20,
  fundContribution: 21,
  scenarioExtraA: 22,
  scenarioExtraB: 23,
  scenarioOneOff: 24,
  carInsurance: 25,
  loanInstallment: 26,
  loanTerm: 27,
  lastDataRow: 29,
} as const;

const HEADERS = {
  [DATOS]: [
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
  [PRESUPUESTO]: [
    'Categoría',
    'Concepto',
    'Tipo',
    'Esencial',
    'Mensual',
    'Anual',
    '% ingreso',
    'Estado del dato',
  ],
  [EVENTOS]: [
    'Concepto',
    'Naturaleza',
    'Importe',
    'Estado',
    'Fecha prevista',
    'Incluir 12M',
    'Nota',
  ],
  [METAS]: [
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
  [ESCENARIOS]: [
    'Escenario',
    'Gasto base',
    'Extra mensual',
    'Pago puntual',
    'Salida total',
    'Caja libre',
    'Tasa libre',
    'Lectura',
  ],
} as const;

/** Etiquetas del resumen de cada hoja (columna A), en orden. */
const PRESUPUESTO_SUMMARY = [
  'Total gastos recurrentes conocidos',
  'Ingresos netos mensuales',
  'Margen aparente después de gastos conocidos',
  'Tasa de ahorro aparente',
  'Gastos esenciales conocidos',
  'Integridad de categorías de gasto',
] as const;
const METAS_SUMMARY = [
  'Aportación mensual propuesta',
  'Margen mensual conocido',
  'Margen no asignado',
  'Prueba de capacidad',
] as const;

/** Categorías de gasto de la fixture (nombres inventados). */
export const FIXTURE_CATEGORIES = [
  'Vivienda',
  'Suministros',
  'Alimentación',
  'Transporte',
  'Seguros',
  'Ocio',
  'Préstamos',
] as const;

/**
 * Crea el libro válido. Cada llamada devuelve un libro nuevo e independiente.
 */
export function buildValidWorkbook(): WorkbookBuilder {
  const book = new WorkbookBuilder();

  // --- Datos y supuestos ---
  const datos = book.addSheet(DATOS);
  datos.set('A1', 'Datos y supuestos (ficticio)');
  datos.row(5, HEADERS[DATOS]);
  DATOS_ROWS.forEach((row, index) => datos.row(6 + index, row));

  // --- Presupuesto: líneas 6-12, fila 13 vacía, resumen 14-19, nota en la 21 ---
  const presupuesto = book.addSheet(PRESUPUESTO);
  presupuesto.set('A1', 'Presupuesto (ficticio)');
  presupuesto.row(5, HEADERS[PRESUPUESTO]);
  const lines: readonly [string, string, string, string][] = [
    ['Vivienda', 'Alquiler', 'Fijo', 'Sí'],
    ['Suministros', 'Electricidad', 'Variable', 'Sí'],
    ['Alimentación', 'Supermercado', 'Variable', 'Sí'],
    ['Transporte', 'Abono de transporte', 'Fijo', 'No'],
    ['Seguros', 'Seguro anual', 'Irregular', 'No'],
    ['Ocio', 'Suscripciones', 'Variable', 'No'],
  ];
  // Las seis primeras líneas apuntan a filas consecutivas de Datos (8-13): Excel las guarda como fórmulas
  // COMPARTIDAS al rellenar hacia abajo (la maestra en E6, F6 y H6; el resto, dependientes).
  const monthlyValues = [800, 60, 350, 40, 25, 30];
  lines.forEach(([category, concept, type, essential], index) => {
    const row = 6 + index;
    presupuesto.row(row, [category, concept, type, essential]);
    presupuesto.set(
      `E${String(row)}`,
      index === 0
        ? { f: `'${DATOS}'!$C8`, v: 800, shared: { si: 0, ref: 'E6:E11' } }
        : { sharedSi: 0, v: monthlyValues[index] ?? 0 },
    );
    // Anual: calculada. El gasto irregular (fila 10) lo tiene escrito a mano: VALUE_IN_CALCULATED_COLUMN.
    presupuesto.set(
      `F${String(row)}`,
      row === 10
        ? 300
        : index === 0
          ? { f: 'E6*12', v: 9600, shared: { si: 1, ref: 'F6:F11' } }
          : { sharedSi: 1, v: (monthlyValues[index] ?? 0) * 12 },
    );
    presupuesto.set(`G${String(row)}`, {
      f: `E${String(row)}/$E$15`,
      v: (monthlyValues[index] ?? 0) / 2800,
    });
    presupuesto.set(
      `H${String(row)}`,
      index === 0
        ? { f: `'${DATOS}'!$F8`, v: 'Confirmado', shared: { si: 2, ref: 'H6:H11' } }
        : { sharedSi: 2, v: 'Estimado' },
    );
  });
  // Línea 12: cuota del préstamo (fórmula normal, no compartida).
  presupuesto.row(12, ['Préstamos', 'Cuota del préstamo', 'Fijo', 'Sí']);
  presupuesto.set('E12', { f: dataRef('C', DATA_ROW.loanInstallment), v: 120 });
  presupuesto.set('F12', { f: 'E12*12', v: 1440 });
  presupuesto.set('G12', { f: 'E12/$E$15', v: 120 / 2800 });
  presupuesto.set('H12', { f: dataRef('F', DATA_ROW.loanInstallment), v: 'Confirmado' });
  // Resumen tras una fila vacía (13): etiqueta en A, valores en E y F.
  PRESUPUESTO_SUMMARY.forEach((label, index) => {
    presupuesto.set(`A${String(14 + index)}`, label);
    presupuesto.set(`E${String(14 + index)}`, { f: `SUM(E6:E12)`, v: 1425 });
  });
  presupuesto.set('A21', 'Nota: el resumen lo calcula Excel; la app lo recalcula.');

  // --- Eventos y compromisos: datos desde la 6, sin resumen ni notas al pie ---
  const eventos = book.addSheet(EVENTOS);
  eventos.set('A1', 'Eventos y compromisos (ficticio)');
  eventos.row(5, HEADERS[EVENTOS]);
  eventos.row(6, [
    'Compra puntual',
    'Puntual',
    90,
    'Estimado',
    { date: '2026-11-15' },
    'Sí',
    'Importe literal, en el mes 1',
  ]);
  eventos.row(7, [
    'Seguro del coche',
    'Anual',
    { f: dataRef('C', DATA_ROW.carInsurance), v: 450 },
    'Estimado',
    { date: '2027-02-10' },
    'Sí',
  ]);
  eventos.row(8, [
    'Segundo pago del seguro',
    'Anual',
    { f: dataRef('C', DATA_ROW.carInsurance), v: 450 },
    'Estimado',
    { date: '2027-08-10' },
    'Sí',
    'Misma fila de Datos que el evento anterior',
  ]);
  eventos.row(9, [
    'Un pago de la cuota',
    'Cuota',
    { f: dataRef('C', DATA_ROW.loanInstallment), v: 120 },
    'Estimado',
    undefined,
    'No',
  ]);
  eventos.row(10, [
    'Préstamo total',
    'Compromiso',
    { f: `'${DATOS}'!$C$26*'${DATOS}'!$C$27`, v: 2160 },
    'Activo',
    { date: '2028-05-01' },
    'Sí',
    'Cuota × plazo; fuera de los 12 meses',
  ]);

  // --- Metas: datos 6-9, filas 10-11 vacías, resumen 12-15, nota en la 18 ---
  const metas = book.addSheet(METAS);
  metas.set('A1', 'Metas (ficticio)');
  metas.row(5, HEADERS[METAS]);
  metas.row(6, [
    'Viaje',
    { f: dataRef('C', DATA_ROW.goalTarget), v: 3000 },
    1000,
    { f: 'MAX(B6-C6,0)', v: 2000 },
    { f: dataRef('C', DATA_ROW.goalContribution), v: 150 },
    { f: 'IF(E6>0,ROUNDUP(D6/E6,0),"")', v: 14 },
    { f: 'IF(D6=0,"Completada",IF(E6<=0,"Pausada","En curso"))', v: 'En curso' },
    'Ahorrar para el viaje',
    'Importe fijo',
  ]);
  metas.row(7, [
    'Fondo de emergencia',
    { f: `SUM(Presupuesto!E6:E8)*'${DATOS}'!$C$18`, v: 7260 },
    { f: dataRef('C', DATA_ROW.savingsA), v: 5000 },
    { f: 'MAX(B7-C7,0)', v: 2260 },
    { f: dataRef('C', DATA_ROW.fundContribution), v: 200 },
    { f: 'IF(E7>0,ROUNDUP(D7/E7,0),"")', v: 12 },
    { f: 'IF(D7=0,"Completada",IF(E7<=0,"Pausada","En curso"))', v: 'En curso' },
    'Seis meses de gastos esenciales',
    'Fondo de emergencia',
  ]);
  metas.row(8, [
    'Meta ya completada',
    500,
    500,
    { f: 'MAX(B8-C8,0)', v: 0 },
    0,
    { f: 'IF(E8>0,ROUNDUP(D8/E8,0),"")', v: 0 },
    { f: 'IF(D8=0,"Completada",IF(E8<=0,"Pausada","En curso"))', v: 'Completada' },
    undefined,
    'Importe fijo',
  ]);
  metas.row(9, [
    'Meta sin aportación',
    2000,
    300,
    { f: 'MAX(B9-C9,0)', v: 1700 },
    0,
    { f: 'IF(E9>0,ROUNDUP(D9/E9,0),"")', v: '' },
    { f: 'IF(D9=0,"Completada",IF(E9<=0,"Pausada","En curso"))', v: 'Pausada' },
    undefined,
    'Importe fijo',
  ]);
  METAS_SUMMARY.forEach((label, index) => {
    metas.set(`A${String(12 + index)}`, label);
    metas.set(`E${String(12 + index)}`, { f: 'SUM(E6:E9)', v: 350 });
  });
  metas.set('A18', 'Nota: el estado lo calcula Excel; la app lo recalcula.');

  // --- Escenarios: datos 6-9 y una nota en la 12 ---
  const escenarios = book.addSheet(ESCENARIOS);
  escenarios.set('A1', 'Escenarios (ficticio)');
  escenarios.row(5, HEADERS[ESCENARIOS]);
  const calculated = (row: number): Row => [
    undefined,
    { f: 'Presupuesto!E14', v: 1425 },
    undefined,
    undefined,
    { f: `B${String(row)}+C${String(row)}+D${String(row)}`, v: 1425 },
    { f: `Presupuesto!E15-E${String(row)}`, v: 1375 },
    { f: `F${String(row)}/Presupuesto!E15`, v: 0.49 },
    { f: `IF(G${String(row)}<0,"Déficit","Margen alto")`, v: 'Margen alto' },
  ];
  const scenario = (row: number, name: string, extra: CellSpec, oneOff: CellSpec): void => {
    const base = calculated(row);
    escenarios.row(row, [name, base[1], extra, oneOff, base[4], base[5], base[6], base[7]]);
  };
  scenario(6, 'Escenario base', { f: '0', v: 0 }, { f: '0', v: 0 });
  scenario(7, 'Con curso', { f: dataRef('C', DATA_ROW.scenarioExtraA), v: 80 }, { f: '0', v: 0 });
  scenario(
    8,
    'Con extras y reparación',
    { f: `SUM('${DATOS}'!C22:C23)`, v: 125 },
    { f: dataRef('C', DATA_ROW.scenarioOneOff), v: 600 },
  );
  // Su «extra» ya está en el gasto base (Electricidad, fila 9): SCENARIO_ITEM_ALREADY_IN_BASE.
  scenario(
    9,
    'Con luz duplicada',
    { f: dataRef('C', DATA_ROW.electricity), v: 60 },
    { f: '0', v: 0 },
  );
  escenarios.set('A12', 'Nota: los resultados los calcula Excel; la app los recalcula.');

  // --- Hojas solo calculadas: solo se comprueba que existen ---
  book
    .addSheet(PROYECCION)
    .set('A1', 'Proyección 12M (ficticio)')
    .set('A6', { date: '2026-09-01' });
  book.addSheet(CHECKS).set('A1', 'Checks (ficticio)');
  book.addSheet(DASHBOARD).set('A1', 'Dashboard (ficticio)');

  // Un comentario de celda: se ignora (§2). Sin relación con ninguna hoja: basta con que exista en el ZIP.
  book.extraFiles.push({
    name: 'xl/comments1.xml',
    data: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author></author></authors><commentList><comment ref="C8" authorId="0"><text><r><t>Comentario ficticio que se ignora</t></r></text></comment></commentList></comments>',
      'utf8',
    ),
  });
  return book;
}
