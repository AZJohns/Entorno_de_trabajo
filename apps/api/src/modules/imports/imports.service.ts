/**
 * Reglas de negocio de la importación del Excel del plan (docs/plan.md §3). No conoce `req` ni `res`.
 *
 * Códigos de error:
 * - 413 / 415 / 422 (nivel 1, el archivo): tamaño, no es un ZIP OOXML o extensión incorrecta, límites de
 *   descompresión, macros o vínculos externos. **No crea ningún lote.** `errors[].path` lleva el código del
 *   catálogo de problemas (`FILE_TOO_LARGE`…), para que el cliente decida sin leer textos.
 * - 404: el lote de la URL no existe.
 * - 409 (`CONFLICT`, con la razón en `errors[].path`): lo impide el estado del lote o del libro. Descartar un
 *   lote ya confirmado; decidir o confirmar un lote que no está en vista previa (`IMPORT_NOT_PREVIEW`) o
 *   que caducó (`IMPORT_EXPIRED`); confirmar con errores sin resolver (`IMPORT_HAS_ERRORS`); confirmar un
 *   contenido que ya fue la foto de ese mes y se sustituyó (`CONTENT_ALREADY_IMPORTED`); y, desde
 *   `BudgetService.applyImport`, un presupuesto creado a mano que choca con la foto nueva
 *   (`BUDGET_MANUAL_EXISTS`) o una categoría archivada.
 * - 422 (`UNPROCESSABLE`): una decisión incoherente con el lote o con el libro (la clave no está en el lote,
 *   la categoría no existe, no es de gasto o está archivada, o la clave se repite).
 *
 * Un libro con estructura inválida (nivel 2) crea un lote `failed` con sus problemas; uno con errores de
 * celda o de semántica (niveles 3 y 4), un lote `preview` que no se puede confirmar. Nunca se guarda el
 * archivo: solo su tamaño y su SHA-256.
 *
 * Confirmar (`confirm`) lo escribe **todo en una sola transacción** (ASVS 2.3.3): la foto del plan y sus
 * filas, `category_budgets`, las correspondencias de categorías y el estado del lote. Si falla cualquier
 * paso no queda nada escrito. Dos confirmaciones a la vez no se pisan: `pg_advisory_xact_lock` por mes
 * (serializa las del mismo mes) y `SELECT … FOR UPDATE` del lote (serializa las del mismo lote).
 */
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type {
  ConfirmImportResponse,
  ImportDetailResponse,
  ImportIssue,
  ImportListResponse,
  ImportStatus,
  ImportUploadResponse,
  UpdateImportDecisionsRequest,
} from '@backoffice/shared';
import type { Database } from '../../db/schema.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import type { BudgetService, LedgerService, PlanService } from '../finance/index.ts';
import { budgetsByCategory, effectiveIssues, effectivePlan } from './domain/decisions.ts';
import { normalizeKey } from './domain/normalize.ts';
import { parsePlanExcel } from './domain/parse-plan.ts';
import { summarize } from './domain/summary.ts';
import { ImportsRepository, type BatchRecord } from './imports.repository.ts';

export interface ImportsServiceDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  /** Categorías del libro: la correspondencia de las categorías de Presupuesto sale de aquí. */
  readonly categories: Pick<LedgerService, 'listCategories'>;
  /** Presupuesto por categoría y mes: la confirmación lo rellena a través de este servicio. */
  readonly budgets: BudgetService;
  /** Capa del plan: la foto del mes y las correspondencias persistentes de categorías. */
  readonly plan: PlanService;
}

/** Resultado de la subida: `created` es falso si ya había una foto vigente con ese contenido (200). */
export interface UploadResult {
  readonly created: boolean;
  readonly response: ImportUploadResponse;
}

/** Resultado de confirmar: `created` es falso si ya estaba confirmada (200 con el mismo `snapshotId`). */
export interface ConfirmResult {
  readonly created: boolean;
  readonly response: ConfirmImportResponse;
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

/** 409 con la razón estable en `errors[].path` para que el cliente decida sin leer textos. */
function conflict(reason: string, message: string): AppError {
  return new AppError('CONFLICT', 409, message, [{ path: reason, message }]);
}

/** Como mucho, cuántos errores bloqueantes se detallan en el 409 de una confirmación con errores. */
const MAX_LISTED_ERRORS = 20;

const NOT_FOUND_MESSAGE = 'La importación no existe';

function unprocessable(path: string, message: string): AppError {
  return new AppError('UNPROCESSABLE', 422, message, [{ path, message }]);
}

/** Cómo se nombra cada estado en los mensajes. */
const STATUS_LABEL: Record<ImportStatus, string> = {
  preview: 'en vista previa',
  confirmed: 'ya confirmada',
  discarded: 'descartada',
  failed: 'con la estructura inválida',
  expired: 'caducada',
};

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

  /**
   * Nombre normalizado → categoría de gasto activa. Primero la correspondencia elegida antes por el
   * usuario (`plan_category_mappings`, si su categoría sigue siendo de gasto y activa) y, si no hay, la
   * coincidencia por nombre. Un nombre ambiguo no se resuelve: se pregunta.
   */
  async #categoryResolver(): Promise<(key: string) => string | undefined> {
    const [categories, mappings] = await Promise.all([
      this.#deps.categories.listCategories(false),
      this.#deps.plan.listCategoryMappings(),
    ]);
    const active = new Set<string>();
    const byKey = new Map<string, string | null>();
    for (const category of categories) {
      if (category.kind !== 'expense') continue;
      active.add(category.id);
      const key = normalizeKey(category.name);
      byKey.set(key, byKey.has(key) ? null : category.id);
    }
    return (key) => {
      const remembered = mappings.get(key);
      if (remembered !== undefined && active.has(remembered)) return remembered;
      return byKey.get(key) ?? undefined;
    };
  }

  /**
   * Lee y valida el archivo y crea el lote. El archivo no se guarda.
   *
   * Idempotencia (plan.md §3.6): si el contenido es el mismo que el de la foto vigente de ese mes (aunque
   * Excel haya cambiado los metadatos al guardar y los bytes sean otros), no se crea nada y se devuelve el
   * lote que la creó (`created: false`, 200).
   *
   * @param input.month Mes 1 del plan, `YYYY-MM`.
   */
  async uploadPlanExcel(input: {
    bytes: Buffer;
    fileName: string;
    month: string;
  }): Promise<UploadResult> {
    const fileName = sanitizeFileName(input.fileName);
    const outcome = parsePlanExcel(input.bytes, {
      fileName,
      month: input.month,
      resolveCategory: await this.#categoryResolver(),
    });
    if (outcome.stage === 'rejected') throw rejection(outcome.issues);

    if (outcome.stage === 'preview') {
      const snapshot = await this.#deps.plan.findByContent(input.month, outcome.contentHash);
      if (snapshot?.status === 'active') {
        const existing = await this.#repo.find(snapshot.importBatchId);
        if (existing !== undefined) {
          return {
            created: false,
            response: {
              id: existing.id,
              status: existing.status,
              issues: [...existing.issues],
              summary: summarize(existing.extracted, existing.issues),
            },
          };
        }
      }
    }

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
      created: true,
      response: {
        id: record.id,
        status: record.status,
        issues: [...record.issues],
        summary: summarize(record.extracted, record.issues),
      },
    };
  }

  /** Vista previa completa de un lote, con sus decisiones ya aplicadas. */
  async get(id: string): Promise<ImportDetailResponse> {
    const record = await this.#repo.find(id);
    if (record === undefined) throw new AppError('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return this.#detail(record);
  }

  #detail(record: BatchRecord): ImportDetailResponse {
    const status = effectiveStatus(record, this.#deps.clock.now());
    // Una vista previa caducada ya no enseña las entradas (el trabajo de limpieza las vacía después).
    const extracted =
      status === 'expired' || record.extracted === null
        ? null
        : effectivePlan(record.extracted, record.decisions);
    const issues = effectiveIssues(record.issues, record.decisions);
    return {
      id: record.id,
      status,
      month: record.month.slice(0, 7),
      fileName: record.fileName,
      fileSizeBytes: record.fileSizeBytes,
      templateVersion: record.templateVersion,
      issues,
      summary: summarize(extracted, issues),
      extracted,
      decisions: record.decisions,
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
      items: records.map((record) => {
        const issues = effectiveIssues(record.issues, record.decisions);
        return {
          id: record.id,
          month: record.month.slice(0, 7),
          fileName: record.fileName,
          fileSizeBytes: record.fileSizeBytes,
          status: effectiveStatus(record, now),
          templateVersion: record.templateVersion,
          errors: issues.filter((issue) => issue.severity === 'error').length,
          warnings: issues.filter((issue) => issue.severity === 'warning').length,
          createdAt: record.createdAt.toISOString(),
          expiresAt: record.expiresAt.toISOString(),
          confirmedAt: record.confirmedAt === null ? null : record.confirmedAt.toISOString(),
        };
      }),
    };
  }

  /** Descarta una vista previa (o un lote fallido). Idempotente; un lote confirmado no se descarta (409). */
  async discard(id: string): Promise<void> {
    const status = await this.#repo.discard(id);
    if (status === undefined) throw new AppError('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    if (status === 'confirmed') {
      throw new AppError('CONFLICT', 409, 'Una importación confirmada no se puede descartar');
    }
  }

  /**
   * Marca como caducadas las vistas previas pasadas de las 24 h y vacía sus entradas (trabajo periódico).
   * Idempotente. @returns cuántas ha caducado.
   */
  expireStalePreviews(): Promise<number> {
    return this.#repo.expirePreviews(this.#deps.clock.now());
  }

  /**
   * Decide a qué categoría de gasto de la app corresponde el nombre de una categoría de Presupuesto
   * (`categoryId`), o retira una decisión anterior (`categoryId: null`). Es un parche: las claves que no
   * se mencionan conservan su decisión. Después se vuelve a validar: lo decidido deja de ser
   * `CATEGORY_UNMAPPED` y el lote puede pasar a confirmable.
   *
   * Orden de comprobaciones: 404 (no existe) → 409 (no está en vista previa vigente) → 422 (incoherente).
   * Las decisiones nuevas no se guardan en `plan_category_mappings` hasta confirmar.
   */
  async updateDecisions(
    id: string,
    request: UpdateImportDecisionsRequest,
  ): Promise<ImportDetailResponse> {
    const categories = new Map(
      (await this.#deps.categories.listCategories(true)).map((category) => [category.id, category]),
    );
    const record = await this.#deps.db.transaction().execute(async (trx) => {
      const repo = new ImportsRepository(trx);
      // Bloquea la fila: una confirmación a la vez no puede dejar pasar una decisión sobre un lote ya cerrado.
      const batch = await repo.findForUpdate(id);
      if (batch === undefined) throw new AppError('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
      this.#assertPreview(batch, 'decidir sobre');
      const known = new Set(batch.extracted?.budgetLines.map((line) => line.categoryKey));
      const seen = new Set<string>();
      const merged = { ...batch.decisions.categoryMappings };
      request.categoryMappings.forEach((decision, index) => {
        const at = `categoryMappings.${String(index)}`;
        if (seen.has(decision.categoryKey)) {
          throw unprocessable(`${at}.categoryKey`, 'La categoría aparece más de una vez');
        }
        seen.add(decision.categoryKey);
        if (!known.has(decision.categoryKey)) {
          throw unprocessable(`${at}.categoryKey`, 'Esa categoría no está en la importación');
        }
        if (decision.categoryId === null) {
          delete merged[decision.categoryKey];
          return;
        }
        const category = categories.get(decision.categoryId);
        if (category === undefined) {
          throw unprocessable(`${at}.categoryId`, 'La categoría no existe');
        }
        if (category.kind !== 'expense') {
          throw unprocessable(`${at}.categoryId`, 'Solo se pueden elegir categorías de gasto');
        }
        if (category.archivedAt !== null) {
          throw unprocessable(`${at}.categoryId`, `La categoría «${category.name}» está archivada`);
        }
        merged[decision.categoryKey] = decision.categoryId;
      });
      const decisions = { categoryMappings: merged };
      await repo.updateDecisions(id, decisions);
      return { ...batch, decisions };
    });
    return this.#detail(record);
  }

  /** 409 si el lote no está en vista previa vigente: confirmado, descartado, fallido o caducado. */
  #assertPreview(batch: BatchRecord, action: string): void {
    const status = effectiveStatus(batch, this.#deps.clock.now());
    if (status === 'expired') {
      throw conflict(
        'IMPORT_EXPIRED',
        `La vista previa caducó: vuelve a subir el archivo para ${action} ella`,
      );
    }
    if (status !== 'preview') {
      throw conflict(
        'IMPORT_NOT_PREVIEW',
        `No se puede ${action} una importación ${STATUS_LABEL[status]}`,
      );
    }
  }

  /**
   * Confirma la vista previa: crea la foto vigente del mes con todas sus filas, rellena el presupuesto por
   * categoría, guarda las correspondencias elegidas y pasa el lote a `confirmed`. **Todo en una sola
   * transacción** (ASVS 2.3.3): si falla cualquier paso no queda nada escrito.
   *
   * - Ya confirmada (también si otra petición la confirma a la vez) → `created: false`, el mismo
   *   `snapshotId` (plan.md §3.6). Nunca duplica.
   * - Mismo contenido que la foto vigente del mes (otro lote) → `created: false` con esa foto: no se crea
   *   nada. Si ese contenido fue una foto que ya se sustituyó → 409 `CONTENT_ALREADY_IMPORTED`.
   * - En vista previa con errores sin resolver → 409 `IMPORT_HAS_ERRORS`. Caducada, descartada o fallida → 409.
   * - Un contenido distinto para un mes que ya tiene foto la sustituye (la anterior queda `superseded`).
   * - Presupuestos del mes: los que creó la foto anterior se sustituyen por los de la nueva (también se borran
   *   los de las categorías que ahora suman 0); los creados a mano no se tocan y, si chocan, 409
   *   `BUDGET_MANUAL_EXISTS` y no se escribe nada (docs/plan.md, pregunta 39).
   */
  async confirm(id: string): Promise<ConfirmResult> {
    const known = await this.#repo.find(id);
    if (known === undefined) throw new AppError('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    const month = known.month.slice(0, 7);
    return this.#deps.db.transaction().execute(async (trx) => {
      const plan = this.#deps.plan.withDb(trx);
      const repo = new ImportsRepository(trx);
      // Primero el mes y después la fila del lote, siempre en este orden: evita los bloqueos cruzados.
      await plan.lockMonth(month);
      const batch = await repo.findForUpdate(id);
      if (batch === undefined) throw new AppError('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

      if (batch.status === 'confirmed') {
        const snapshot = await plan.findByBatch(id);
        if (snapshot === undefined) throw new Error('Un lote confirmado no tiene foto del plan');
        return { created: false, response: { snapshotId: snapshot.id, budgets: null } };
      }
      this.#assertPreview(batch, 'confirmar');
      const { extracted, contentHash, templateVersion } = batch;
      if (extracted === null || contentHash === null || templateVersion === null) {
        throw new Error('Una vista previa sin entradas');
      }
      const issues = effectiveIssues(batch.issues, batch.decisions);
      const effective = effectivePlan(extracted, batch.decisions);
      if (!summarize(effective, issues).canConfirm) {
        const blocking = issues.filter((issue) => issue.severity === 'error');
        throw new AppError(
          'CONFLICT',
          409,
          'La importación tiene errores sin resolver: corrígelos o resuelve las categorías antes de confirmar',
          blocking.slice(0, MAX_LISTED_ERRORS).map((issue) => ({
            path: 'IMPORT_HAS_ERRORS',
            message: `${issue.code}${issue.cell === null ? '' : ` (${issue.sheet ?? ''}!${issue.cell})`}: ${issue.message}`,
          })),
        );
      }

      const sameContent = await plan.findByContent(month, contentHash);
      if (sameContent !== undefined) {
        if (sameContent.status === 'active') {
          return { created: false, response: { snapshotId: sameContent.id, budgets: null } };
        }
        throw conflict(
          'CONTENT_ALREADY_IMPORTED',
          'Ese contenido ya se importó este mes y fue sustituido por otro: no se vuelve a activar',
        );
      }

      const snapshotId = await plan.createSnapshot({
        month,
        importBatchId: id,
        contentHash,
        templateVersion,
        plan: effective,
      });
      const { budgets, omitted } = budgetsByCategory(effective);
      const applied = await this.#deps.budgets
        .withDb(trx)
        .applyImport({ month, snapshotId, items: budgets });
      await plan.saveCategoryMappings(batch.decisions.categoryMappings);
      await repo.markConfirmed(id, this.#deps.clock.now());
      return {
        created: true,
        response: { snapshotId, budgets: { ...applied, omitted } },
      };
    });
  }
}
