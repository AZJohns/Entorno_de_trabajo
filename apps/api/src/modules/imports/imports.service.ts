/**
 * Reglas de negocio de la importación del Excel del plan (docs/plan.md §3). No conoce `req` ni `res`.
 *
 * Códigos de error:
 * - 413 / 415 / 422 (nivel 1, el archivo): tamaño, no es un ZIP OOXML o extensión incorrecta, límites de
 *   descompresión, macros o vínculos externos. **No crea ningún lote.** `errors[].path` lleva el código del
 *   catálogo de problemas (`FILE_TOO_LARGE`…), para que el cliente decida sin leer textos.
 * - 404: el lote de la URL no existe.
 * - 409: descartar un lote ya confirmado.
 *
 * Un libro con estructura inválida (nivel 2) crea un lote `failed` con sus problemas; uno con errores de
 * celda o de semántica (niveles 3 y 4), un lote `preview` que no se puede confirmar. Nunca se guarda el
 * archivo: solo su tamaño y su SHA-256.
 */
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  ImportDetailResponse,
  ImportIssue,
  ImportListResponse,
  ImportStatus,
  ImportUploadResponse,
} from '@backoffice/shared';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import type { LedgerService } from '../finance/index.ts';
import { normalizeKey } from './domain/normalize.ts';
import { parsePlanExcel } from './domain/parse-plan.ts';
import { summarize } from './domain/summary.ts';
import { ImportsRepository, type BatchRecord } from './imports.repository.ts';

export interface ImportsServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Categorías del libro: la correspondencia de las categorías de Presupuesto sale de aquí. */
  readonly categories: Pick<LedgerService, 'listCategories'>;
}

/** Una vista previa caduca a las 24 h (docs/plan.md §3.6). */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

const LIST_LIMIT = 50;
const DEFAULT_FILE_NAME = 'sin-nombre.xlsx';

/** Nombre del archivo saneado: sin ruta, sin caracteres de control y de 255 caracteres como máximo. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/u).pop() ?? '';
  const clean = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim()
    .normalize('NFC');
  return clean === '' ? DEFAULT_FILE_NAME : clean.slice(0, 255);
}

/** Traduce los problemas de nivel 1 a una respuesta de error HTTP. */
function rejection(issues: readonly ImportIssue[]): AppError {
  const has = (code: ImportIssue['code']): boolean => issues.some((issue) => issue.code === code);
  const errors = issues.map((issue) => ({ path: issue.code, message: issue.message }));
  const message = issues[0]?.message ?? 'El archivo no se puede importar';
  if (has('FILE_TOO_LARGE')) return new AppError('PAYLOAD_TOO_LARGE', 413, message, errors);
  if (has('FILE_NOT_OOXML')) return new AppError('UNSUPPORTED_MEDIA_TYPE', 415, message, errors);
  return new AppError('UNPROCESSABLE', 422, message, errors);
}

/** Estado que ve el usuario: una vista previa pasada de su caducidad ya cuenta como caducada. */
function effectiveStatus(
  record: Pick<BatchRecord, 'status' | 'expiresAt'>,
  now: Date,
): ImportStatus {
  return record.status === 'preview' && record.expiresAt <= now ? 'expired' : record.status;
}

export class ImportsService {
  readonly #deps: ImportsServiceDeps;
  readonly #repo: ImportsRepository;

  constructor(deps: ImportsServiceDeps) {
    this.#deps = deps;
    this.#repo = new ImportsRepository(deps.db);
  }

  /** Nombre normalizado → categoría de gasto activa. Un nombre ambiguo no se resuelve: se pregunta. */
  async #categoryResolver(): Promise<(key: string) => string | undefined> {
    const categories = await this.#deps.categories.listCategories(false);
    const byKey = new Map<string, string | null>();
    for (const category of categories) {
      if (category.kind !== 'expense') continue;
      const key = normalizeKey(category.name);
      byKey.set(key, byKey.has(key) ? null : category.id);
    }
    return (key) => byKey.get(key) ?? undefined;
  }

  /**
   * Lee y valida el archivo y crea el lote. El archivo no se guarda.
   *
   * @param input.month Mes 1 del plan, `YYYY-MM`.
   */
  async uploadPlanExcel(input: {
    bytes: Buffer;
    fileName: string;
    month: string;
  }): Promise<ImportUploadResponse> {
    const fileName = sanitizeFileName(input.fileName);
    const outcome = parsePlanExcel(input.bytes, {
      fileName,
      month: input.month,
      resolveCategory: await this.#categoryResolver(),
    });
    if (outcome.stage === 'rejected') throw rejection(outcome.issues);

    const now = this.#deps.clock.now();
    const base = {
      month: `${input.month}-01`,
      fileName,
      fileSizeBytes: input.bytes.length,
      fileSha256: createHash('sha256').update(input.bytes).digest(),
      issues: outcome.issues,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
    };
    const record =
      outcome.stage === 'failed'
        ? await this.#repo.insert({
            ...base,
            contentHash: null,
            templateVersion: outcome.templateVersion,
            status: 'failed',
            extracted: null,
          })
        : await this.#repo.insert({
            ...base,
            contentHash: outcome.contentHash,
            templateVersion: outcome.templateVersion,
            status: 'preview',
            extracted: outcome.extracted,
          });
    return {
      id: record.id,
      status: record.status,
      issues: [...record.issues],
      summary: summarize(record.extracted, record.issues),
    };
  }

  /** Vista previa completa de un lote. */
  async get(id: string): Promise<ImportDetailResponse> {
    const record = await this.#repo.find(id);
    if (record === undefined) throw new AppError('NOT_FOUND', 404, 'La importación no existe');
    const status = effectiveStatus(record, this.#deps.clock.now());
    // Una vista previa caducada ya no enseña las entradas (el trabajo de limpieza las vacía después).
    const extracted = status === 'expired' ? null : record.extracted;
    return {
      id: record.id,
      status,
      month: record.month.slice(0, 7),
      fileName: record.fileName,
      fileSizeBytes: record.fileSizeBytes,
      templateVersion: record.templateVersion,
      issues: [...record.issues],
      summary: summarize(extracted, record.issues),
      extracted,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      confirmedAt: record.confirmedAt === null ? null : record.confirmedAt.toISOString(),
    };
  }

  /** Lotes recientes (hasta 50), opcionalmente de un mes. */
  async list(month: string | undefined): Promise<ImportListResponse> {
    const now = this.#deps.clock.now();
    const records = await this.#repo.list(
      month === undefined ? undefined : `${month}-01`,
      LIST_LIMIT,
    );
    return {
      items: records.map((record) => ({
        id: record.id,
        month: record.month.slice(0, 7),
        fileName: record.fileName,
        fileSizeBytes: record.fileSizeBytes,
        status: effectiveStatus(record, now),
        templateVersion: record.templateVersion,
        errors: record.issues.filter((issue) => issue.severity === 'error').length,
        warnings: record.issues.filter((issue) => issue.severity === 'warning').length,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        confirmedAt: record.confirmedAt === null ? null : record.confirmedAt.toISOString(),
      })),
    };
  }

  /** Descarta una vista previa (o un lote fallido). Idempotente; un lote confirmado no se descarta (409). */
  async discard(id: string): Promise<void> {
    const status = await this.#repo.discard(id);
    if (status === undefined) throw new AppError('NOT_FOUND', 404, 'La importación no existe');
    if (status === 'confirmed') {
      throw new AppError('CONFLICT', 409, 'Una importación confirmada no se puede descartar');
    }
  }
}
