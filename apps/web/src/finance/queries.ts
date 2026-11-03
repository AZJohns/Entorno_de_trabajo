/**
 * Consultas y mutaciones del libro real. Las respuestas se validan con los esquemas de
 * `@backoffice/shared`. Cualquier cambio invalida todo `['finance', …]`: un movimiento o una
 * transferencia cambian el saldo de las cuentas, y las listas dependen unas de otras.
 */
import {
  accountResponseSchema,
  balanceHistoryResponseSchema,
  balancesReportResponseSchema,
  categoryReportResponseSchema,
  categoryResponseSchema,
  createReconciliationResponseSchema,
  exportResponseSchema,
  monthlyReportResponseSchema,
  movementResponseSchema,
  pageSchema,
  reconciliationResponseSchema,
  transferResponseSchema,
  type AccountResponse,
  type CategoryResponse,
  type CreateAccountRequest,
  type CreateCategoryRequest,
  type CreateMovementRequest,
  type CreateReconciliationRequest,
  type CreateTransferRequest,
  type MovementResponse,
  type TransferResponse,
  type UpdateAccountRequest,
  type UpdateMovementRequest,
  type UpdateTransferRequest,
} from '@backoffice/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client.ts';
import { saveJsonFile } from './download.ts';

const ROOT = 'finance';

const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

function invalidate(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [ROOT] });
}

/** Query string con solo los filtros que tienen valor. */
export function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

// --- cuentas -------------------------------------------------------------------------------------

export function useAccounts(includeArchived: boolean) {
  return useQuery({
    queryKey: [ROOT, 'accounts', { includeArchived }],
    queryFn: () =>
      api(`/accounts${includeArchived ? '?includeArchived=true' : ''}`, {
        schema: listOf(accountResponseSchema),
      }).then((result) => result.items),
  });
}

export function useAccount(id: string) {
  return useQuery({
    queryKey: [ROOT, 'account', id],
    queryFn: () => api(`/accounts/${id}`, { schema: accountResponseSchema }),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountRequest) =>
      api('/accounts', { method: 'POST', body, schema: accountResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateAccountRequest }) =>
      api(`/accounts/${input.id}`, {
        method: 'PATCH',
        body: input.body,
        schema: accountResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useArchiveAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/accounts/${id}/archive`, { method: 'POST', schema: accountResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

// --- categorías ----------------------------------------------------------------------------------

export function useCategories(includeArchived: boolean) {
  return useQuery({
    queryKey: [ROOT, 'categories', { includeArchived }],
    queryFn: () =>
      api(`/categories${includeArchived ? '?includeArchived=true' : ''}`, {
        schema: listOf(categoryResponseSchema),
      }).then((result) => result.items),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) =>
      api('/categories', { method: 'POST', body, schema: categoryResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRenameCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api(`/categories/${input.id}`, {
        method: 'PATCH',
        body: { name: input.name },
        schema: categoryResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useArchiveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/categories/${id}/archive`, { method: 'POST', schema: categoryResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

// --- movimientos ---------------------------------------------------------------------------------

/** Filtros de `GET /movements`; el texto vacío significa «sin filtro». */
export interface MovementFilters {
  from: string;
  to: string;
  accountId: string;
  categoryId: string;
  status: string;
  kind: string;
  source: string;
  q: string;
}

export const NO_MOVEMENT_FILTERS: MovementFilters = {
  from: '',
  to: '',
  accountId: '',
  categoryId: '',
  status: '',
  kind: '',
  source: '',
  q: '',
};

const movementPage = pageSchema(movementResponseSchema);

export function useMovements(filters: MovementFilters) {
  return useInfiniteQuery({
    queryKey: [ROOT, 'movements', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(`/movements${queryString({ ...filters, cursor: pageParam })}`, { schema: movementPage }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreateMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMovementRequest) =>
      api('/movements', { method: 'POST', body, schema: movementResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateMovementRequest }) =>
      api(`/movements/${input.id}`, {
        method: 'PATCH',
        body: input.body,
        schema: movementResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useConfirmMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/movements/${id}/confirm`, { method: 'POST', schema: movementResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/movements/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient),
  });
}

// --- transferencias ------------------------------------------------------------------------------

export interface TransferFilters {
  from: string;
  to: string;
  accountId: string;
}

export const NO_TRANSFER_FILTERS: TransferFilters = { from: '', to: '', accountId: '' };

const transferPage = pageSchema(transferResponseSchema);

export function useTransfers(filters: TransferFilters) {
  return useInfiniteQuery({
    queryKey: [ROOT, 'transfers', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(`/transfers${queryString({ ...filters, cursor: pageParam })}`, { schema: transferPage }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTransferRequest) =>
      api('/transfers', { method: 'POST', body, schema: transferResponseSchema }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateTransferRequest }) =>
      api(`/transfers/${input.id}`, {
        method: 'PATCH',
        body: input.body,
        schema: transferResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/transfers/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient),
  });
}

// --- conciliaciones ------------------------------------------------------------------------------

export function useReconciliations(accountId: string) {
  return useQuery({
    queryKey: [ROOT, 'reconciliations', accountId],
    queryFn: () =>
      api(`/accounts/${accountId}/reconciliations`, {
        schema: listOf(reconciliationResponseSchema),
      }).then((result) => result.items),
  });
}

export function useCreateReconciliation(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReconciliationRequest) =>
      api(`/accounts/${accountId}/reconciliations`, {
        method: 'POST',
        body,
        schema: createReconciliationResponseSchema,
      }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/reconciliations/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(queryClient),
  });
}

export type { AccountResponse, CategoryResponse, MovementResponse, TransferResponse };

// --- informes ------------------------------------------------------------------------------------
// Los importes ya vienen calculados por la API (`/reports/*`); la web solo los dibuja.

export function useMonthlyReport(from: string, to: string) {
  return useQuery({
    queryKey: [ROOT, 'reports', 'monthly', from, to],
    queryFn: () =>
      api(`/reports/monthly${queryString({ from, to })}`, { schema: monthlyReportResponseSchema }),
  });
}

export function useCategoryReport(month: string) {
  return useQuery({
    queryKey: [ROOT, 'reports', 'categories', month],
    queryFn: () =>
      api(`/reports/monthly/${month}/categories`, { schema: categoryReportResponseSchema }),
  });
}

export function useBalancesReport(at: string) {
  return useQuery({
    queryKey: [ROOT, 'reports', 'balances', at],
    queryFn: () =>
      api(`/reports/balances${queryString({ at })}`, { schema: balancesReportResponseSchema }),
  });
}

export function useBalanceHistory(from: string, to: string) {
  return useQuery({
    queryKey: [ROOT, 'reports', 'history', from, to],
    queryFn: () =>
      api(`/reports/balance-history${queryString({ from, to })}`, {
        schema: balanceHistoryResponseSchema,
      }),
  });
}

// --- exportación ---------------------------------------------------------------------------------

/**
 * Descarga la copia completa de los datos (`GET /export`, S+). Si la reautenticación ha caducado, la
 * API responde `REAUTH_REQUIRED` y la reacción común de `App.tsx` lleva a `/reautenticar`.
 */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const data = await api('/export', { schema: exportResponseSchema });
      saveJsonFile(
        `backoffice-export-${data.exportedAt.slice(0, 10)}.json`,
        JSON.stringify(data, null, 2),
      );
      return data;
    },
  });
}
