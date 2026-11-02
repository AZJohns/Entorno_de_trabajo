import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHttpLogger } from '../src/http/logger.ts';
import { captureLogger } from './helpers.ts';

describe('logger', () => {
  it('oculta cookies, autorización y token CSRF, y no registra la query string', async () => {
    const { logger, lines } = captureLogger();
    const app = express();
    app.use(createHttpLogger(logger));
    app.get('/buscar', (_req, res) => {
      res.setHeader('Set-Cookie', '__Host-sid=valor-secreto; Path=/; Secure; HttpOnly');
      res.json({ ok: true });
    });

    await request(app)
      .get('/buscar?q=texto-privado')
      .set('Cookie', '__Host-sid=cookie-secreta')
      .set('Authorization', 'Bearer token-secreto')
      .set('X-CSRF-Token', 'csrf-secreto');

    const output = JSON.stringify(lines());
    for (const secret of [
      'cookie-secreta',
      'token-secreto',
      'csrf-secreto',
      'texto-privado',
      'valor-secreto',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('"url":"/buscar"');
  });

  it('oculta campos sensibles anidados en objetos registrados', () => {
    const { logger, lines } = captureLogger();
    logger.info({ body: { password: 'p4ss', totp: '123456', name: 'visible' } }, 'prueba');
    const output = JSON.stringify(lines());
    expect(output).not.toContain('p4ss');
    expect(output).not.toContain('123456');
    expect(output).toContain('visible');
  });
});
