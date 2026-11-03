/**
 * Esquemas del libro real (cuentas, categorías, movimientos, transferencias y conciliaciones),
 * compartidos por la web y la API (docs/plan.md §2.3 y §2.10).
 *
 * Convenciones: importes en céntimos enteros; fechas `YYYY-MM-DD` (días del calendario, sin hora ni
 * zona); meses `YYYY-MM`. Las peticiones son objetos estrictos: un campo desconocido es un error
 * (asignación masiva, ASVS 15.3.3). Las reglas que dependen de otras filas (la cuenta existe, la fecha
 * es posterior a la apertura…) las comprueba el servicio de la API, no estos esquemas.
 */
import { z } from 'zod';

/** Tipos de cuenta. */
export const ACCOUNT_TYPES = ['checking', 'savings', 'cash'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Naturaleza de una categoría o de un movimiento. */
export const MOVEMENT_KINDS = ['income', 'expense'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Estado de un movimiento. */
export const MOVEMENT_STATUSES = ['pending', 'confirmed'] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

/** Origen de un movimiento. `shortcut` se añade en la fase 2. */
export const MOVEMENT_SOURCES = ['manual', 'reconciliation'] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

/** Día del calendario `YYYY-MM-DD` (rechaza `2026-02-30`). */
export const localDateSchema = z.iso.date();
/** Mes `YYYY-MM`. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, 'Formato YYYY-MM');

/** Importe en céntimos: entero seguro, con signo (un saldo puede ser negativo). */
const signedCents = z.int();
/** Importe en céntimos estrictamente positivo (movimientos confirmados y transferencias). */
const positiveCents = z.int().positive();

const name = z.string().trim().min(1).max(100);
/** Texto libre opcional: el texto vacío equivale a «sin valor». */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

/** Un PATCH sin ningún campo no cambia nada: es un error del cliente. */
function atLeastOneField(value: object): boolean {
  return Object.values(value).some((field) => field !== undefined);
}
const AT_LEAST_ONE = { message: 'Indica al menos un campo' } as const;

// --- cuentas -------------------------------------------------------------------------------------

export const createAccountRequestSchema = z.strictObject({
  name,
  type: z.enum(ACCOUNT_TYPES),
  /** Saldo **al inicio del día** `openingDate`: los movimientos de ese día se suman a él. */
  openingBalanceCents: signedCents.default(0),
  openingDate: localDateSchema,
});

export const updateAccountRequestSchema = z
  .strictObject({
    name: name.optional(),
    type: z.enum(ACCOUNT_TYPES).optional(),
    openingBalanceCents: signedCents.optional(),
    openingDate: localDateSchema.optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

export const accountResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.literal('EUR'),
  openingBalanceCents: signedCents,
  openingDate: localDateSchema,
  /** Saldo actual, calculado al leer: todos los movimientos confirmados y las transferencias, también los futuros. */
  balanceCents: signedCents,
  archived: z.boolean(),
});

// --- categorías ----------------------------------------------------------------------------------

export const createCategoryRequestSchema = z.strictObject({
  name,
  kind: z.enum(MOVEMENT_KINDS),
});

/** El tipo de una categoría no cambia: los movimientos que la usan dejarían de ser coherentes. */
export const updateCategoryRequestSchema = z.strictObject({ name });

export const categoryResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(MOVEMENT_KINDS),
  archived: z.boolean(),
});

// --- movimientos ---------------------------------------------------------------------------------

/** Alta manual: siempre completa y confirmada. */
export const createMovementRequestSchema = z.strictObject({
  kind: z.enum(MOVEMENT_KINDS),
  amountCents: positiveCents,
  accountId: z.uuid(),
  categoryId: z.uuid(),
  bookedOn: localDateSchema,
  description: optionalText(500).optional(),
  merchant: optionalText(200).optional(),
});

/**
 * Edición parcial. Un movimiento pendiente (borrador) puede quedar incompleto; uno confirmado, no
 * (el servicio y la base de datos lo comprueban sobre el resultado de aplicar el cambio).
 */
export const updateMovementRequestSchema = z
  .strictObject({
    kind: z.enum(MOVEMENT_KINDS).optional(),
    amountCents: z.int().min(0).optional(),
    accountId: z.uuid().optional(),
    categoryId: z.uuid().nullable().optional(),
    bookedOn: localDateSchema.optional(),
    description: optionalText(500).optional(),
    merchant: optionalText(200).optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

/** Parámetros de paginación por cursor. */
const pageParams = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
};

function fromNotAfterTo(value: { from?: string | undefined; to?: string | undefined }): boolean {
  return value.from === undefined || value.to === undefined || value.from <= value.to;
}
const FROM_TO = { message: '«from» no puede ser posterior a «to»', path: ['from'] };

export const listMovementsQuerySchema = z
  .strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    status: z.enum(MOVEMENT_STATUSES).optional(),
    kind: z.enum(MOVEMENT_KINDS).optional(),
    source: z.enum(MOVEMENT_SOURCES).optional(),
    /** Busca en el concepto y el comercio, sin distinguir mayúsculas ni acentos. */
    q: z.string().trim().min(1).max(100).optional(),
    ...pageParams,
  })
  .refine(fromNotAfterTo, FROM_TO);

export const movementResponseSchema = z.object({
  id: z.uuid(),
  kind: z.enum(MOVEMENT_KINDS),
  amountCents: z.int().min(0),
  description: z.string().nullable(),
  merchant: z.string().nullable(),
  accountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  bookedOn: localDateSchema,
  source: z.enum(MOVEMENT_SOURCES),
  reconciliationId: z.uuid().nullable(),
  status: z.enum(MOVEMENT_STATUSES),
  flags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
});

export const pendingCountResponseSchema = z.object({ count: z.int().min(0) });

// --- transferencias ------------------------------------------------------------------------------

export const createTransferRequestSchema = z
  .strictObject({
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amountCents: positiveCents,
    bookedOn: localDateSchema,
    note: optionalText(500).optional(),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: 'El origen y el destino deben ser cuentas distintas',
    path: ['toAccountId'],
  });

export const updateTransferRequestSchema = z
  .strictObject({
    fromAccountId: z.uuid().optional(),
    toAccountId: z.uuid().optional(),
    amountCents: positiveCents.optional(),
    bookedOn: localDateSchema.optional(),
    note: optionalText(500).optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

export const listTransfersQuerySchema = z
  .strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    accountId: z.uuid().optional(),
    ...pageParams,
  })
  .refine(fromNotAfterTo, FROM_TO);

export const transferResponseSchema = z.object({
  id: z.uuid(),
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amountCents: positiveCents,
  bookedOn: localDateSchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** Respuesta de una lista paginada por cursor. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

// --- conciliaciones ------------------------------------------------------------------------------

export const createReconciliationRequestSchema = z
  .strictObject({
    month: monthSchema,
    /** Fecha del saldo que muestra el banco; debe estar dentro de `month`. */
    asOf: localDateSchema,
    statementBalanceCents: signedCents,
    note: optionalText(500).optional(),
  })
  .refine((value) => value.asOf.startsWith(`${value.month}-`), {
    message: 'La fecha del saldo debe estar dentro del mes',
    path: ['asOf'],
  });

export const createReconciliationResponseSchema = z.object({
  id: z.uuid(),
  computedBalanceCents: signedCents,
  differenceCents: signedCents,
  adjustmentMovementId: z.uuid().optional(),
});

export const reconciliationResponseSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  month: monthSchema,
  asOf: localDateSchema,
  statementBalanceCents: signedCents,
  /** Lo que se calculó al conciliar, antes del ajuste (registro histórico). */
  computedBalanceCents: signedCents,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  adjustmentMovementId: z.uuid().nullable(),
  /** Saldo calculado hoy hasta `asOf` (con el ajuste) frente al del banco. */
  discrepancy: z.object({
    currentBalanceCents: signedCents,
    differenceCents: signedCents,
    hasDiscrepancy: z.boolean(),
  }),
});

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;
export type CreateMovementRequest = z.infer<typeof createMovementRequestSchema>;
export type UpdateMovementRequest = z.infer<typeof updateMovementRequestSchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
export type MovementResponse = z.infer<typeof movementResponseSchema>;
export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;
export type UpdateTransferRequest = z.infer<typeof updateTransferRequestSchema>;
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;
export type TransferResponse = z.infer<typeof transferResponseSchema>;
export type CreateReconciliationRequest = z.infer<typeof createReconciliationRequestSchema>;
export type CreateReconciliationResponse = z.infer<typeof createReconciliationResponseSchema>;
export type ReconciliationResponse = z.infer<typeof reconciliationResponseSchema>;

/** Listas de cuentas y categorías: por defecto, sin las archivadas. */
export const listArchivableQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

// --- informes (docs/plan.md §5, `/reports/*`) ------------------------------------------------------

/** Máximo de meses que admiten los informes por rango (5 años). */
export const MAX_REPORT_MONTHS = 60;

/** `?from=YYYY-MM&to=YYYY-MM` de los informes mensuales y del histórico de saldos. */
export const reportRangeQuerySchema = z
  .strictObject({ from: monthSchema, to: monthSchema })
  .refine((range) => range.from <= range.to, {
    message: '«from» no puede ser posterior a «to»',
    path: ['from'],
  });

/** `?at=YYYY-MM-DD` del informe de saldos. Obligatorio: el servidor no adivina «hoy» (zona horaria). */
export const balancesQuerySchema = z.strictObject({ at: localDateSchema });

export const monthlyReportRowSchema = z.object({
  month: monthSchema,
  /** Ingresos confirmados, sin los ajustes de conciliación. */
  incomeCents: signedCents,
  /** Gastos confirmados, sin los ajustes de conciliación. */
  expenseCents: signedCents,
  netCents: signedCents,
  /** Ajustes de conciliación del mes, con signo: línea propia, no son ingresos ni gastos. */
  adjustmentsCents: signedCents,
  pending: z.object({
    count: z.int().min(0),
    incomeCents: signedCents,
    expenseCents: signedCents,
  }),
});
export const monthlyReportResponseSchema = z.object({ items: z.array(monthlyReportRowSchema) });

export const categoryReportResponseSchema = z.object({
  month: monthSchema,
  items: z.array(
    z.object({
      kind: z.enum(MOVEMENT_KINDS),
      /** `null` si no tiene categoría. */
      categoryId: z.uuid().nullable(),
      /** Nombre de la categoría; `null` si no tiene categoría. */
      name: z.string().nullable(),
      totalCents: signedCents,
    }),
  ),
});

export const balancesReportResponseSchema = z.object({
  at: localDateSchema,
  accounts: z.array(
    z.object({
      accountId: z.uuid(),
      name: z.string(),
      type: z.enum(ACCOUNT_TYPES),
      archived: z.boolean(),
      /** Saldo calculado: incluye los ajustes. */
      balanceCents: signedCents,
      /** De ese saldo, lo debido a ajustes de conciliación (con signo). */
      adjustmentsCents: signedCents,
    }),
  ),
  totalCents: signedCents,
  totalAdjustmentsCents: signedCents,
});

export const balanceHistoryResponseSchema = z.object({
  months: z.array(monthSchema),
  accounts: z.array(
    z.object({
      accountId: z.uuid(),
      name: z.string(),
      archived: z.boolean(),
      /** Saldo a fin de cada mes de `months`; `null` si la cuenta aún no estaba abierta. */
      balancesCents: z.array(signedCents.nullable()),
    }),
  ),
  /** Suma de las cuentas abiertas en cada mes. */
  totalsCents: z.array(signedCents),
});

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;
export type BalancesQuery = z.infer<typeof balancesQuerySchema>;
export type MonthlyReportRow = z.infer<typeof monthlyReportRowSchema>;
export type MonthlyReportResponse = z.infer<typeof monthlyReportResponseSchema>;
export type CategoryReportResponse = z.infer<typeof categoryReportResponseSchema>;
export type BalancesReportResponse = z.infer<typeof balancesReportResponseSchema>;
export type BalanceHistoryResponse = z.infer<typeof balanceHistoryResponseSchema>;

// --- exportación (docs/plan.md §2.10, `GET /export`) -----------------------------------------------

/** Versión del formato de exportación: sube si cambia la forma del archivo. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Archivo de `GET /export`: una copia legible de los datos del libro. Solo datos de negocio: nunca
 * usuarios, sesiones, factores de autenticación, tokens ni la auditoría. Importes en céntimos.
 */
export const exportResponseSchema = z.strictObject({
  format: z.literal('backoffice-export'),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: z.iso.datetime(),
  currency: z.literal('EUR'),
  amountUnit: z.literal('cents'),
  /** Incluye las cuentas archivadas. `balanceCents` es informativo: se calcula al exportar. */
  accounts: z.array(accountResponseSchema),
  /** Incluye las categorías archivadas. */
  categories: z.array(categoryResponseSchema),
  /** Todos: confirmados y pendientes, y los ajustes de conciliación. */
  movements: z.array(movementResponseSchema),
  transfers: z.array(transferResponseSchema),
  reconciliations: z.array(
    z.strictObject({
      id: z.uuid(),
      accountId: z.uuid(),
      month: monthSchema,
      asOf: localDateSchema,
      statementBalanceCents: signedCents,
      computedBalanceCents: signedCents,
      note: z.string().nullable(),
      createdAt: z.iso.datetime(),
      adjustmentMovementId: z.uuid().nullable(),
    }),
  ),
});
export type ExportResponse = z.infer<typeof exportResponseSchema>;
