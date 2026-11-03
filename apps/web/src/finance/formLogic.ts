/**
 * Lógica pura de los formularios del libro: del texto de los campos a la petición de la API, o a un
 * mensaje por campo. Sin React ni E/S, para probarla con tablas de casos.
 *
 * Los importes se convierten SOLO con `readAmount` (→ `parseEuroAmount`). La petición resultante se
 * valida además con el esquema compartido, el mismo que usa la API: si el esquema la rechaza, el
 * mensaje se asocia al campo y no se envía.
 */
import {
  createAccountRequestSchema,
  createMovementRequestSchema,
  createReconciliationRequestSchema,
  createTransferRequestSchema,
  type CreateAccountRequest,
  type CreateMovementRequest,
  type CreateReconciliationRequest,
  type CreateTransferRequest,
  type UpdateAccountRequest,
  type UpdateMovementRequest,
  type UpdateTransferRequest,
  type MovementResponse,
  type AccountResponse,
  type TransferResponse,
} from '@backoffice/shared';
import type { z } from 'zod';
import { readAmount } from './amount.ts';
import { monthOf } from './dates.ts';

/** Mensajes por campo (`name`, `amount`…) o resultado listo para enviar. */
export type FormResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

const REQUIRED = 'Este campo es obligatorio';

/** Traduce los fallos de un esquema compartido a mensajes por campo (el primero de cada campo). */
function schemaErrors(
  error: z.ZodError,
  rename: Record<string, string> = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    const field = rename[key] ?? key;
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Texto vacío → `null` (así lo entiende la API: «sin valor»). */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// --- cuentas -------------------------------------------------------------------------------------

export interface AccountFormValues {
  name: string;
  type: string;
  openingBalance: string;
  openingDate: string;
}

const ACCOUNT_FIELDS = { openingBalanceCents: 'openingBalance' } as const;

/** Alta de cuenta. El saldo de apertura puede ser negativo (descubierto) y estar vacío (0). */
export function buildCreateAccount(values: AccountFormValues): FormResult<CreateAccountRequest> {
  const errors: Record<string, string> = {};
  let openingBalanceCents = 0;
  if (values.openingBalance.trim() !== '') {
    const amount = readAmount(values.openingBalance, { allowNegative: true, allowZero: true });
    if (amount.ok) openingBalanceCents = amount.cents;
    else errors['openingBalance'] = amount.message;
  }
  const parsed = createAccountRequestSchema.safeParse({
    name: values.name,
    type: values.type,
    openingBalanceCents,
    openingDate: values.openingDate,
  });
  if (!parsed.success) {
    return { ok: false, errors: { ...schemaErrors(parsed.error, ACCOUNT_FIELDS), ...errors } };
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: parsed.data };
}

/** Edición de cuenta: envía solo lo que ha cambiado; sin cambios, `null`. */
export function buildAccountPatch(
  values: AccountFormValues,
  original: AccountResponse,
): FormResult<UpdateAccountRequest | null> {
  const full = buildCreateAccount(values);
  if (!full.ok) return full;
  const patch: UpdateAccountRequest = {
    ...(full.value.name === original.name ? {} : { name: full.value.name }),
    ...(full.value.type === original.type ? {} : { type: full.value.type }),
    ...(full.value.openingBalanceCents === original.openingBalanceCents
      ? {}
      : { openingBalanceCents: full.value.openingBalanceCents }),
    ...(full.value.openingDate === original.openingDate
      ? {}
      : { openingDate: full.value.openingDate }),
  };
  return { ok: true, value: Object.keys(patch).length === 0 ? null : patch };
}

// --- movimientos ---------------------------------------------------------------------------------

export interface MovementFormValues {
  kind: string;
  amount: string;
  accountId: string;
  categoryId: string;
  bookedOn: string;
  description: string;
  merchant: string;
}

const MOVEMENT_FIELDS = { amountCents: 'amount', bookedOn: 'bookedOn' } as const;

/** Alta manual de un movimiento: nace confirmado y completo, con importe > 0. */
export function buildCreateMovement(values: MovementFormValues): FormResult<CreateMovementRequest> {
  const errors: Record<string, string> = {};
  const amount = readAmount(values.amount);
  if (!amount.ok) errors['amount'] = amount.message;
  if (values.accountId === '') errors['accountId'] = REQUIRED;
  if (values.categoryId === '') errors['categoryId'] = REQUIRED;
  if (values.bookedOn === '') errors['bookedOn'] = REQUIRED;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = createMovementRequestSchema.safeParse({
    kind: values.kind,
    amountCents: amount.ok ? amount.cents : 0,
    accountId: values.accountId,
    categoryId: values.categoryId,
    bookedOn: values.bookedOn,
    description: textOrNull(values.description),
    merchant: textOrNull(values.merchant),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: schemaErrors(parsed.error, MOVEMENT_FIELDS) };
}

/**
 * Edición de un movimiento: solo los campos cambiados; sin cambios, `null`. Un pendiente (borrador)
 * puede quedar con importe 0 o sin categoría; uno confirmado, no: lo comprueba la API, pero aquí se
 * avisa antes para los campos que no admiten vacío.
 */
export function buildMovementPatch(
  values: MovementFormValues,
  original: MovementResponse,
): FormResult<UpdateMovementRequest | null> {
  const pending = original.status === 'pending';
  const errors: Record<string, string> = {};
  const amount = readAmount(values.amount, { allowZero: pending });
  if (!amount.ok) errors['amount'] = amount.message;
  if (values.accountId === '') errors['accountId'] = REQUIRED;
  if (values.categoryId === '' && !pending) errors['categoryId'] = REQUIRED;
  if (values.bookedOn === '') errors['bookedOn'] = REQUIRED;
  if (values.description.length > 500) errors['description'] = 'Máximo 500 caracteres';
  if (values.merchant.length > 200) errors['merchant'] = 'Máximo 200 caracteres';
  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors };

  const description = textOrNull(values.description);
  const merchant = textOrNull(values.merchant);
  const categoryId = values.categoryId === '' ? null : values.categoryId;
  const patch: UpdateMovementRequest = {
    ...(values.kind === original.kind
      ? {}
      : { kind: values.kind as UpdateMovementRequest['kind'] }),
    ...(amount.cents === original.amountCents ? {} : { amountCents: amount.cents }),
    ...(values.accountId === original.accountId ? {} : { accountId: values.accountId }),
    ...(categoryId === original.categoryId ? {} : { categoryId }),
    ...(values.bookedOn === original.bookedOn ? {} : { bookedOn: values.bookedOn }),
    ...(description === original.description ? {} : { description }),
    ...(merchant === original.merchant ? {} : { merchant }),
  };
  return { ok: true, value: Object.keys(patch).length === 0 ? null : patch };
}

// --- transferencias ------------------------------------------------------------------------------

export interface TransferFormValues {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  bookedOn: string;
  note: string;
}

const TRANSFER_FIELDS = { amountCents: 'amount' } as const;

export function buildCreateTransfer(values: TransferFormValues): FormResult<CreateTransferRequest> {
  const errors: Record<string, string> = {};
  const amount = readAmount(values.amount);
  if (!amount.ok) errors['amount'] = amount.message;
  if (values.fromAccountId === '') errors['fromAccountId'] = REQUIRED;
  if (values.toAccountId === '') errors['toAccountId'] = REQUIRED;
  if (values.bookedOn === '') errors['bookedOn'] = REQUIRED;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = createTransferRequestSchema.safeParse({
    fromAccountId: values.fromAccountId,
    toAccountId: values.toAccountId,
    amountCents: amount.ok ? amount.cents : 0,
    bookedOn: values.bookedOn,
    note: textOrNull(values.note),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: schemaErrors(parsed.error, TRANSFER_FIELDS) };
}

export function buildTransferPatch(
  values: TransferFormValues,
  original: TransferResponse,
): FormResult<UpdateTransferRequest | null> {
  const full = buildCreateTransfer(values);
  if (!full.ok) return full;
  const patch: UpdateTransferRequest = {
    ...(full.value.fromAccountId === original.fromAccountId
      ? {}
      : { fromAccountId: full.value.fromAccountId }),
    ...(full.value.toAccountId === original.toAccountId
      ? {}
      : { toAccountId: full.value.toAccountId }),
    ...(full.value.amountCents === original.amountCents
      ? {}
      : { amountCents: full.value.amountCents }),
    ...(full.value.bookedOn === original.bookedOn ? {} : { bookedOn: full.value.bookedOn }),
    ...((full.value.note ?? null) === original.note ? {} : { note: full.value.note ?? null }),
  };
  return { ok: true, value: Object.keys(patch).length === 0 ? null : patch };
}

// --- conciliación --------------------------------------------------------------------------------

export interface ReconciliationFormValues {
  month: string;
  asOf: string;
  statementBalance: string;
  note: string;
}

const RECONCILIATION_FIELDS = { statementBalanceCents: 'statementBalance' } as const;

/**
 * Petición de conciliación. El saldo del banco admite signo y 0 (cuenta vacía o en descubierto). La
 * fecha del saldo debe estar dentro del mes: se comprueba aquí, con un mensaje en español, antes de
 * que lo haga la API.
 */
export function buildReconciliation(
  values: ReconciliationFormValues,
): FormResult<CreateReconciliationRequest> {
  const errors: Record<string, string> = {};
  const balance = readAmount(values.statementBalance, { allowNegative: true, allowZero: true });
  if (!balance.ok) errors['statementBalance'] = balance.message;
  if (values.month === '') errors['month'] = REQUIRED;
  if (values.asOf === '') errors['asOf'] = REQUIRED;
  else if (values.month !== '' && monthOf(values.asOf) !== values.month) {
    errors['asOf'] = 'La fecha del saldo debe estar dentro del mes conciliado';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = createReconciliationRequestSchema.safeParse({
    month: values.month,
    asOf: values.asOf,
    statementBalanceCents: balance.ok ? balance.cents : 0,
    note: textOrNull(values.note),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: schemaErrors(parsed.error, RECONCILIATION_FIELDS) };
}
