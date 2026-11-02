import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { problemDetailsSchema } from '@backoffice/shared';
import { createApp } from '../src/app.ts';
import { AppError, errorHandler, notFoundHandler } from '../src/http/errors.ts';
import { createHttpLogger } from '../src/http/logger.ts';
import { captureLogger } from './helpers.ts';

describe('GET /api/v1/health', () => {
  it('responde 200 con { status: "ok" } y sin detalles internos', async () => {
    const app = createApp(captureLogger('silent'));
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8/);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('formato de error (RFC 9457)', () => {
  it('una ruta inexistente devuelve 404 problem+json con requestId', async () => {
    const app = createApp(captureLogger('silent'));
    const res = await request(app).get('/api/v1/no-existe');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = problemDetailsSchema.parse(res.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('JSON mal formado → 400 MALFORMED_JSON', async () => {
    const app = createApp(captureLogger('silent'));
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(problemDetailsSchema.parse(res.body).code).toBe('MALFORMED_JSON');
  });

  it('cuerpo por encima del límite → 413 PAYLOAD_TOO_LARGE', async () => {
    const app = createApp(captureLogger('silent'));
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
    expect(problemDetailsSchema.parse(res.body).code).toBe('PAYLOAD_TOO_LARGE');
  });

  /** App mínima con rutas que fallan a propósito, para probar el gestor de errores. */
  function failingApp(): { app: express.Express; lines: () => Record<string, unknown>[] } {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(createHttpLogger(logger));
    app.get('/app-error', () => {
      throw new AppError('VALIDATION_ERROR', 400, 'Importe no válido', [
        { path: 'amount', message: 'Demasiados decimales' },
      ]);
    });
    app.get('/zod-error', () => {
      z.object({ name: z.string() }).parse({ name: 1 });
    });
    // Express 5 pasa al gestor de errores las promesas rechazadas sin necesidad de next(err).
    app.get('/unexpected', async () => {
      await Promise.resolve();
      throw new Error('detalle interno secreto: SELECT * FROM users');
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    return { app, lines };
  }

  it('AppError conserva su código, estado, detalle y errores de campo', async () => {
    const res = await request(failingApp().app).get('/app-error');
    expect(res.status).toBe(400);
    const body = problemDetailsSchema.parse(res.body);
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      detail: 'Importe no válido',
      errors: [{ path: 'amount', message: 'Demasiados decimales' }],
    });
  });

  it('ZodError → 400 VALIDATION_ERROR con la ruta del campo', async () => {
    const res = await request(failingApp().app).get('/zod-error');
    expect(res.status).toBe(400);
    const body = problemDetailsSchema.parse(res.body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.path).toBe('name');
  });

  it('un error inesperado → 500 genérico, sin filtrar detalles, y queda registrado', async () => {
    const { app, lines } = failingApp();
    const res = await request(app).get('/unexpected');
    expect(res.status).toBe(500);
    const body = problemDetailsSchema.parse(res.body);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
    const logged = lines().find((line) => line['msg'] === 'Error no controlado');
    expect(logged).toBeDefined();
    expect((logged?.['req'] as { id?: string } | undefined)?.id).toBe(body.requestId);
  });
});
