/**
 * Acceso a la tabla `import_batches`. Solo consultas: ninguna decisión de negocio.
 *
 * Los `jsonb` se insertan como texto JSON y se validan con los esquemas compartidos al leerlos: lo que
 * hay en la base de datos nunca llega a la API sin pasar por ellos.
 */
import type { Kysely } from 'kysely';
import {
  extractedPlanSchema,
  importDecisionsSchema,
  importIssueSchema,
  type ExtractedPlan,
  type ImportDecisions,
  type ImportIssue,
  type ImportStatus,
} from '@backoffice/shared';
import { z } from 'zod';
import type { Database } from '../../db/schema.ts';

export interface BatchRecord {
  readonly id: string;
  /** Primer día del mes 1 (`YYYY-MM-01`). */
  readonly month: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly fileSha256: Buffer;
  readonly contentHash: Buffer | null;
  readonly templateVersion: number | null;
  readonly status: ImportStatus;
  /** `null` si ya no hay entradas (confirmado, descartado, caducado o fallido). */
  readonly extracted: ExtractedPlan | null;
  readonly issues: readonly ImportIssue[];
  /** Lo elegido en la vista previa (correspondencias de categorías). */
  readonly decisions: ImportDecisions;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly confirmedAt: Date | null;
}

export interface NewBatch {
  readonly month: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly fileSha256: Buffer;
  readonly contentHash: Buffer | null;
  readonly templateVersion: number | null;
  readonly status: 'preview' | 'failed';
  readonly extracted: ExtractedPlan | null;
  readonly issues: readonly ImportIssue[];
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

const issuesSchema = z.array(importIssueSchema);

const COLUMNS = [
  'id',
  'month',
  'file_name',
  'file_size_bytes',
  'file_sha256',
  'content_hash',
  'template_version',
  'status',
  'extracted',
  'issues',
  'decisions',
  'created_at',
  'expires_at',
  'confirmed_at',
] as const;

type Row = {
  id: string;
  month: string;
  file_name: string;
  file_size_bytes: number;
  file_sha256: Buffer;
  content_hash: Buffer | null;
  template_version: number | null;
  status: ImportStatus;
  extracted: unknown;
  issues: unknown;
  decisions: unknown;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
};

function toRecord(row: Row): BatchRecord {
  return {
    id: row.id,
    month: row.month,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    fileSha256: row.file_sha256,
    contentHash: row.content_hash,
    templateVersion: row.template_version,
    status: row.status,
    extracted: row.extracted === null ? null : extractedPlanSchema.parse(row.extracted),
    issues: issuesSchema.parse(row.issues),
    decisions: importDecisionsSchema.parse(row.decisions),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
  };
}

export class ImportsRepository {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async insert(batch: NewBatch): Promise<BatchRecord> {
    const row = await this.#db
      .insertInto('import_batches')
      .values({
        kind: 'plan_excel',
        month: batch.month,
        file_name: batch.fileName,
        file_size_bytes: batch.fileSizeBytes,
        file_sha256: batch.fileSha256,
        content_hash: batch.contentHash,
        template_version: batch.templateVersion,
        status: batch.status,
        extracted: batch.extracted === null ? null : JSON.stringify(batch.extracted),
        issues: JSON.stringify(batch.issues),
        created_at: batch.createdAt,
        expires_at: batch.expiresAt,
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }

  async find(id: string): Promise<BatchRecord | undefined> {
    const row = await this.#db
      .selectFrom('import_batches')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  /**
   * Lee el lote **bloqueando su fila** (`SELECT … FOR UPDATE`) hasta el final de la transacción: quien la
   * pide después espera y, al leer, ya ve el estado que dejó la primera. Solo tiene sentido dentro de una
   * transacción. Así dos confirmaciones del mismo lote no pueden avanzar a la vez.
   */
  async findForUpdate(id: string): Promise<BatchRecord | undefined> {
    const row = await this.#db
      .selectFrom('import_batches')
      .select(COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async updateDecisions(id: string, decisions: ImportDecisions): Promise<void> {
    await this.#db
      .updateTable('import_batches')
      .set({ decisions: JSON.stringify(decisions) })
      .where('id', '=', id)
      .execute();
  }

  /** Pasa el lote a `confirmed` y vacía sus entradas (ya están en las tablas del plan). */
  async markConfirmed(id: string, now: Date): Promise<void> {
    const result = await this.#db
      .updateTable('import_batches')
      .set({ status: 'confirmed', confirmed_at: now, extracted: null })
      .where('id', '=', id)
      .where('status', '=', 'preview')
      .executeTakeFirst();
    // El lote está bloqueado por la transacción y se acaba de leer como `preview`: no debería fallar.
    if (result.numUpdatedRows !== 1n)
      throw new Error('El lote no estaba en vista previa al confirmarlo');
  }

  /**
   * Marca como `expired` las vistas previas cuya caducidad ya pasó y vacía sus entradas. Idempotente.
   * @returns cuántas ha caducado.
   */
  async expirePreviews(now: Date): Promise<number> {
    const result = await this.#db
      .updateTable('import_batches')
      .set({ status: 'expired', extracted: null })
      .where('status', '=', 'preview')
      .where('expires_at', '<=', now)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** Lotes más recientes primero, sin leer las entradas extraídas (pueden ser grandes). */
  async list(month: string | undefined, limit: number): Promise<BatchRecord[]> {
    let query = this.#db
      .selectFrom('import_batches')
      .select(COLUMNS.filter((column) => column !== 'extracted'))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
    if (month !== undefined) query = query.where('month', '=', month);
    const rows = await query.execute();
    // Sin las entradas: `extracted` llega siempre a `null` en la lista.
    return rows.map((row) => toRecord({ ...row, extracted: null }));
  }

  /**
   * Pasa un lote a `discarded` y vacía sus entradas. Solo desde `preview` o `failed`; devuelve el estado
   * resultante o `undefined` si no existe.
   */
  async discard(id: string): Promise<ImportStatus | undefined> {
    const updated = await this.#db
      .updateTable('import_batches')
      .set({ status: 'discarded', extracted: null })
      .where('id', '=', id)
      .where('status', 'in', ['preview', 'failed'])
      .returning('status')
      .executeTakeFirst();
    if (updated !== undefined) return updated.status;
    const current = await this.#db
      .selectFrom('import_batches')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirst();
    return current?.status;
  }
}
