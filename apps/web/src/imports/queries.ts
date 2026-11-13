/**
 * Consultas y mutaciones de la importación del Excel. Las respuestas se validan con los esquemas de
 * `@backoffice/shared`; aquí no se redefine ningún tipo.
 */
import {
  confirmImportResponseSchema,
  importDetailResponseSchema,
  importUploadResponseSchema,
  uploadPlanExcelQuerySchema,
  type CategoryMappingDecision,
  type ConfirmImportResponse,
  type ImportDetailResponse,
  type ImportUploadResponse,
} from '@backoffice/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiWithStatus, type ApiResult } from '../api/client.ts';
import { contentTypeFor, spreadsheetExtension } from './fileCheck.ts';

const ROOT = 'imports';

/** Codifica el id como segmento de ruta: viene de la URL del navegador (ASVS 1.2.2). */
const segment = (id: string): string => encodeURIComponent(id);

const detailKey = (id: string) => [ROOT, 'detail', id] as const;

/** Vista previa (o resultado) de una importación. */
export function useImport(id: string) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: () => api(`/imports/${segment(id)}`, { schema: importDetailResponseSchema }),
  });
}

/**
 * Sube el archivo. 201: lote nuevo (vista previa o fallido). 200: ese contenido ya es el plan vigente del
 * mes y no se ha creado nada. El cuerpo es el archivo en binario, no multipart (ASVS 3.5.2).
 */
export function useUploadImport() {
  return useMutation<ApiResult<ImportUploadResponse>, Error, { month: string; file: File }>({
    mutationFn: ({ month, file }) => {
      const query = uploadPlanExcelQuerySchema.parse({ month, fileName: file.name });
      const extension = spreadsheetExtension(file.name);
      if (extension === null) throw new Error('Extensión no admitida');
      const search = new URLSearchParams({ month: query.month, fileName: query.fileName });
      return apiWithStatus(`/imports/plan-excel?${search.toString()}`, {
        method: 'POST',
        rawBody: { data: file, contentType: contentTypeFor(extension) },
        schema: importUploadResponseSchema,
      });
    },
  });
}

/** `PATCH /decisions`: la respuesta es la vista previa ya con las decisiones aplicadas. */
export function useUpdateDecisions(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryMappings: CategoryMappingDecision[]) =>
      api(`/imports/${segment(id)}/decisions`, {
        method: 'PATCH',
        body: { categoryMappings },
        schema: importDetailResponseSchema,
      }),
    onSuccess: (detail: ImportDetailResponse) => {
      queryClient.setQueryData(detailKey(id), detail);
    },
  });
}

/**
 * `POST /confirm`. 201: se creó la foto del plan. 200: ya estaba confirmado o el contenido es igual a la
 * foto vigente (`budgets: null`). En los dos casos se vuelve a leer el lote para saber en qué estado queda
 * (confirmado o, con el mismo contenido, todavía en vista previa).
 */
export function useConfirmImport(id: string) {
  const queryClient = useQueryClient();
  return useMutation<ApiResult<ConfirmImportResponse>, Error, void>({
    mutationFn: () =>
      apiWithStatus(`/imports/${segment(id)}/confirm`, {
        method: 'POST',
        schema: confirmImportResponseSchema,
      }),
    onSuccess: async () => {
      // Los presupuestos y el plan cambian: la lista de presupuestos tiene que volver a pedirse.
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
      await queryClient.invalidateQueries({ queryKey: detailKey(id) });
    },
  });
}

/** `DELETE /imports/:id` (204, idempotente). */
export function useDiscardImport(id: string) {
  return useMutation({
    mutationFn: () => api(`/imports/${segment(id)}`, { method: 'DELETE' }),
  });
}
