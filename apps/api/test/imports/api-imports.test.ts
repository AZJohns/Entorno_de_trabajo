/**
 * Importaciones en la API (`/imports`): contra la base de datos real. Subida con vista previa, lote fallido,
 * rechazos del archivo (413/415/422 sin crear lote), lectura, lista, descarte, y que el archivo nunca se
 * guarda. Archivos FICTICIOS.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  importDetailResponseSchema,
  importListResponseSchema,
  problemDetailsSchema,
} from '@backoffice/shared';
import { REAUTH_WINDOW_MS } from '../../src/modules/auth/domain/session-rules.ts';
import { PREVIEW_TTL_MS } from '../../src/modules/imports/imports.service.ts';
import { buildValidWorkbook, DATOS } from '../fixtures/plan-workbook.ts';
import { useAuthTestContext } from '../support/auth.ts';
import {
  IMPORTS,
  UPLOAD,
  XLSX_TYPE,
  createFixtureCategories,
  resetImports,
  uploadOk,
  uploadUrl,
} from '../support/imports.ts';
import { createCategory, expectProblem } from '../support/ledger.ts';

const getCtx = useAuthTestContext();
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetImports(getCtx().database.db);
});

async function batchCount(): Promise<number> {
  const rows = await getCtx().database.db.selectFrom('import_batches').select('id').execute();
  return rows.length;
}

describe('subida válida', () => {
  it('crea una vista previa con los recuentos y sin errores', async () => {
    const client = await getCtx().loggedIn();
    await createFixtureCategories(client);
    const result = await uploadOk(client, buildValidWorkbook().toBuffer());
    expect(result.status).toBe('preview');
    expect(result.summary).toEqual({
      items: 24,
      budgetLines: 7,
      events: 5,
      goals: 4,
      scenarios: 4,
      errors: 0,
      warnings: 3,
      infos: 2,
      canConfirm: true,
    });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'VALUE_IN_CALCULATED_COLUMN',
      'EVENT_REF_MONTHLY',
      'EVENT_AFTER_HORIZON',
      'EVENT_ITEM_ALREADY_IN_BASE',
      'SCENARIO_ITEM_ALREADY_IN_BASE',
    ]);
  });

  it('la vista previa se puede leer: entradas, categorías resueltas y caducidad a las 24 h', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    const categories = await createFixtureCategories(client);
    const { id } = await uploadOk(client, buildValidWorkbook().toBuffer(), {
      fileName: 'plan.xlsx',
    });
    const res = await client.get(`${IMPORTS}/${id}`);
    expect(res.status).toBe(200);
    const detail = importDetailResponseSchema.parse(res.body);
    expect(detail).toMatchObject({
      id,
      status: 'preview',
      month: '2026-11',
      fileName: 'plan.xlsx',
      templateVersion: 2,
      confirmedAt: null,
    });
    expect(detail.extracted?.items).toHaveLength(24);
    expect(detail.extracted?.budgetLines[0]?.categoryId).toBe(categories['Vivienda']);
    expect(new Date(detail.expiresAt).getTime() - new Date(detail.createdAt).getTime()).toBe(
      PREVIEW_TTL_MS,
    );

    // Se adelanta la caducidad en la base de datos (adelantar el reloj bloquearía la sesión por inactividad).
    await ctx.database.db
      .updateTable('import_batches')
      .set({
        expires_at: new Date(ctx.t.clock.now().getTime() - 1000),
        created_at: new Date(ctx.t.clock.now().getTime() - 2000),
      })
      .where('id', '=', id)
      .execute();
    const expired = importDetailResponseSchema.parse((await client.get(`${IMPORTS}/${id}`)).body);
    expect(expired.status).toBe('expired');
    expect(expired.extracted).toBeNull();
    expect(expired.summary.canConfirm).toBe(false);
  });

  it('sin las categorías en la app, cada línea es CATEGORY_UNMAPPED y no se puede confirmar', async () => {
    const client = await getCtx().loggedIn();
    const result = await uploadOk(client, buildValidWorkbook().toBuffer());
    expect(result.status).toBe('preview');
    expect(result.issues.filter((issue) => issue.code === 'CATEGORY_UNMAPPED')).toHaveLength(7);
    expect(result.summary.canConfirm).toBe(false);
  });

  it('solo se resuelven las categorías de gasto activas (no las de ingreso ni las archivadas)', async () => {
    const client = await getCtx().loggedIn();
    const ids = await createFixtureCategories(client);
    expect((await client.post(`/api/v1/categories/${ids['Ocio'] ?? ''}/archive`)).status).toBe(200);
    // Una categoría de INGRESO con el mismo nombre que una de gasto no se confunde con ella.
    const income = await createCategory(client, 'income', { name: 'Préstamos' });
    const result = await uploadOk(client, buildValidWorkbook().toBuffer());
    const unmapped = result.issues.filter((issue) => issue.code === 'CATEGORY_UNMAPPED');
    expect(unmapped.map((issue) => issue.cell)).toEqual(['A11']); // Ocio archivada
    const detail = importDetailResponseSchema.parse(
      (await client.get(`${IMPORTS}/${result.id}`)).body,
    );
    expect(detail.extracted?.budgetLines[6]?.categoryId).toBe(ids['Préstamos']);
    expect(detail.extracted?.budgetLines[6]?.categoryId).not.toBe(income.id);
  });

  it('el archivo no se guarda: solo su tamaño y su SHA-256, y el nombre saneado', async () => {
    const client = await getCtx().loggedIn();
    await createFixtureCategories(client);
    const bytes = buildValidWorkbook().toBuffer();
    const { id } = await uploadOk(client, bytes, {
      fileName: 'C:\\Users\\alguien\\..\\plan\u0007.xlsx',
    });
    const row = await getCtx()
      .database.db.selectFrom('import_batches')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.file_sha256.equals(createHash('sha256').update(bytes).digest())).toBe(true);
    expect(row.file_size_bytes).toBe(bytes.length);
    expect(row.file_name).toBe('plan.xlsx');
    expect(row.kind).toBe('plan_excel');
    expect(row.month).toBe('2026-11-01');
    expect(row.status).toBe('preview');
    // Ninguna columna contiene los bytes del archivo (ni el hash binario de contenido es el del archivo).
    expect(Object.keys(row).sort()).toEqual(
      [
        'confirmed_at',
        'content_hash',
        'created_at',
        'decisions',
        'expires_at',
        'extracted',
        'file_name',
        'file_sha256',
        'file_size_bytes',
        'id',
        'issues',
        'kind',
        'month',
        'status',
        'template_version',
      ].sort(),
    );
    expect(row.content_hash?.equals(row.file_sha256)).toBe(false);
  });

  it('el mismo contenido guardado con otros bytes da el mismo hash de contenido', async () => {
    const client = await getCtx().loggedIn();
    await createFixtureCategories(client);
    const a = buildValidWorkbook();
    const b = buildValidWorkbook();
    b.extraFiles.push({
      name: 'docProps/app.xml',
      data: Buffer.from('<Properties>x</Properties>'),
    });
    const first = await uploadOk(client, a.toBuffer());
    const second = await uploadOk(client, b.toBuffer());
    const rows = await getCtx()
      .database.db.selectFrom('import_batches')
      .select(['id', 'content_hash', 'file_sha256'])
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(
      byId
        .get(first.id)
        ?.content_hash?.equals(byId.get(second.id)?.content_hash ?? Buffer.alloc(0)),
    ).toBe(true);
    expect(
      byId.get(first.id)?.file_sha256.equals(byId.get(second.id)?.file_sha256 ?? Buffer.alloc(0)),
    ).toBe(false);
  });
});

describe('lote fallido (nivel 2)', () => {
  it('una plantilla v1 crea un lote failed con los problemas y sin entradas', async () => {
    const client = await getCtx().loggedIn();
    const book = buildValidWorkbook();
    book.sheet(DATOS).clear('I5');
    const result = await uploadOk(client, book.toBuffer());
    expect(result.status).toBe('failed');
    expect(result.issues.map((issue) => issue.code)).toEqual(['TEMPLATE_VERSION_UNSUPPORTED']);
    expect(result.summary).toMatchObject({ items: 0, errors: 1, canConfirm: false });
    const row = await getCtx()
      .database.db.selectFrom('import_batches')
      .select(['status', 'extracted', 'content_hash', 'template_version'])
      .where('id', '=', result.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      status: 'failed',
      extracted: null,
      content_hash: null,
      template_version: null,
    });
  });
});

describe('rechazos del archivo (nivel 1): sin lote', () => {
  const rejected = async (
    bytes: Buffer,
    status: number,
    code: string,
    issueCode: string,
    options: { fileName?: string; contentType?: string } = {},
  ): Promise<void> => {
    const client = await getCtx().loggedIn();
    const res = await client.postBinary(
      uploadUrl({ fileName: options.fileName ?? 'plan.xlsx' }),
      bytes,
      options.contentType ?? XLSX_TYPE,
    );
    expectProblem(res, status, code);
    expect(problemDetailsSchema.parse(res.body).errors?.map((error) => error.path)).toContain(
      issueCode,
    );
    expect(await batchCount()).toBe(0);
  };

  it('más de 5 MB → 413 FILE_TOO_LARGE', async () => {
    await rejected(Buffer.alloc(5 * 1024 * 1024 + 1), 413, 'PAYLOAD_TOO_LARGE', 'FILE_TOO_LARGE');
  });

  it('no es un ZIP → 415 FILE_NOT_OOXML, aunque el tipo declarado sea el de Excel', async () => {
    await rejected(
      Buffer.from('<html>no soy un libro</html>'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'FILE_NOT_OOXML',
    );
  });

  it('extensión incorrecta → 415 FILE_NOT_OOXML', async () => {
    await rejected(
      buildValidWorkbook().toBuffer(),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'FILE_NOT_OOXML',
      {
        fileName: 'plan.pdf',
      },
    );
  });

  it('macros → 422 FILE_HAS_MACROS', async () => {
    const book = buildValidWorkbook();
    book.extraFiles.push({ name: 'xl/vbaProject.bin', data: Buffer.from('m') });
    await rejected(book.toBuffer(), 422, 'UNPROCESSABLE', 'FILE_HAS_MACROS', {
      contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      fileName: 'plan.xlsm',
    });
  });

  it('vínculos externos → 422 FILE_EXTERNAL_LINKS', async () => {
    const book = buildValidWorkbook();
    book.extraFiles.push({ name: 'xl/externalLinks/externalLink1.xml', data: Buffer.from('<a/>') });
    await rejected(book.toBuffer(), 422, 'UNPROCESSABLE', 'FILE_EXTERNAL_LINKS');
  });

  it('más de 200 entradas → 422 FILE_ZIP_LIMITS', async () => {
    const book = buildValidWorkbook();
    for (let index = 0; index < 201; index += 1) {
      book.extraFiles.push({ name: `r/${String(index)}`, data: Buffer.from('x') });
    }
    await rejected(book.toBuffer(), 422, 'UNPROCESSABLE', 'FILE_ZIP_LIMITS');
  });

  it('sin cuerpo o con un tipo de contenido que no es binario → 415 y sin lote', async () => {
    const client = await getCtx().loggedIn();
    expect((await client.postBinary(uploadUrl(), Buffer.alloc(0), XLSX_TYPE)).status).toBe(415);
    // text/plain y JSON no son admitidos: un formulario HTML podría enviar text/plain (CSRF).
    expect((await client.postBinary(uploadUrl(), Buffer.from('hola'), 'text/plain')).status).toBe(
      415,
    );
    expect((await client.post(uploadUrl(), { hola: 'mundo' })).status).toBe(415);
    expect(await batchCount()).toBe(0);
  });

  it('parámetros no válidos → 400', async () => {
    const client = await getCtx().loggedIn();
    const bytes = buildValidWorkbook().toBuffer();
    for (const url of [
      UPLOAD,
      `${UPLOAD}?month=2026-13&fileName=a.xlsx`,
      `${UPLOAD}?month=2026-11`,
      `${UPLOAD}?month=2026-11&fileName=`,
      `${UPLOAD}?month=2026-11&fileName=a.xlsx&otro=1`,
    ]) {
      expectProblem(await client.postBinary(url, bytes, XLSX_TYPE), 400, 'VALIDATION_ERROR');
    }
    expect(await batchCount()).toBe(0);
  });
});

describe('lista, lectura y descarte', () => {
  it('lista los lotes más recientes primero y filtra por mes', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await createFixtureCategories(client);
    const first = await uploadOk(client, buildValidWorkbook().toBuffer(), { month: '2026-10' });
    ctx.t.clock.advance(1000);
    const second = await uploadOk(client, buildValidWorkbook().toBuffer(), { month: '2026-11' });

    const all = importListResponseSchema.parse((await client.get(IMPORTS)).body);
    expect(all.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(all.items[0]).toMatchObject({
      month: '2026-11',
      status: 'preview',
      errors: 0,
      warnings: 3,
    });
    const october = importListResponseSchema.parse(
      (await client.get(`${IMPORTS}?month=2026-10`)).body,
    );
    expect(october.items.map((item) => item.id)).toEqual([first.id]);
    expect((await client.get(`${IMPORTS}?month=mal`)).status).toBe(400);
    // La lista no lleva las entradas extraídas.
    expect(JSON.stringify(all)).not.toContain('Salario neto');
  });

  it('un lote inexistente o un identificador mal formado: 404 y 400', async () => {
    const client = await getCtx().loggedIn();
    expectProblem(await client.get(`${IMPORTS}/${MISSING_ID}`), 404, 'NOT_FOUND');
    expectProblem(await client.get(`${IMPORTS}/no-es-un-uuid`), 400, 'VALIDATION_ERROR');
    expectProblem(await client.delete(`${IMPORTS}/${MISSING_ID}`), 404, 'NOT_FOUND');
  });

  it('descartar vacía las entradas y es idempotente', async () => {
    const client = await getCtx().loggedIn();
    await createFixtureCategories(client);
    const { id } = await uploadOk(client, buildValidWorkbook().toBuffer());
    expect((await client.delete(`${IMPORTS}/${id}`)).status).toBe(204);
    expect((await client.delete(`${IMPORTS}/${id}`)).status).toBe(204);
    const detail = importDetailResponseSchema.parse((await client.get(`${IMPORTS}/${id}`)).body);
    expect(detail.status).toBe('discarded');
    expect(detail.extracted).toBeNull();
    const row = await getCtx()
      .database.db.selectFrom('import_batches')
      .select('extracted')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.extracted).toBeNull();
  });

  it('un lote fallido también se puede descartar; uno confirmado, no (409)', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await createFixtureCategories(client);
    const book = buildValidWorkbook();
    book.sheet(DATOS).clear('I5');
    const failed = await uploadOk(client, book.toBuffer());
    expect((await client.delete(`${IMPORTS}/${failed.id}`)).status).toBe(204);

    const { id } = await uploadOk(client, buildValidWorkbook().toBuffer());
    // La confirmación llega en el PR 2; aquí se fuerza el estado para probar la guarda.
    await ctx.database.db
      .updateTable('import_batches')
      .set({ status: 'confirmed', confirmed_at: new Date(), extracted: null })
      .where('id', '=', id)
      .execute();
    expectProblem(await client.delete(`${IMPORTS}/${id}`), 409, 'CONFLICT');
  });
});

describe('subida S+ (reautenticación reciente)', () => {
  it('sin reautenticación reciente: 403 antes de leer el archivo y sin lote', async () => {
    const ctx = getCtx();
    const client = await ctx.loggedIn();
    await createFixtureCategories(client);
    ctx.t.clock.advance(REAUTH_WINDOW_MS);
    const res = await client.postBinary(uploadUrl(), buildValidWorkbook().toBuffer(), XLSX_TYPE);
    expectProblem(res, 403, 'REAUTH_REQUIRED');
    expect(await batchCount()).toBe(0);
    // Leer sí se puede (S): la reautenticación solo se exige para subir.
    expect((await client.get(IMPORTS)).status).toBe(200);
  });
});

describe('formato de las respuestas', () => {
  it('los errores de nivel 1 siguen RFC 9457 y no revelan rutas ni trazas', async () => {
    const client = await getCtx().loggedIn();
    const res = await client.postBinary(uploadUrl(), Buffer.from('basura'), XLSX_TYPE);
    expect(res.status).toBe(415);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/node_modules|\.ts:|at .*\(/u);
  });
});
