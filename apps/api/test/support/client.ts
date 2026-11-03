/**
 * Cliente de pruebas que se comporta como el navegador de la web: guarda la cookie de sesión, envía
 * el Origin de la web y el token CSRF.
 */
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { TEST_ORIGIN } from './app.ts';

export class TestClient {
  readonly #app: Express;
  cookie: string | undefined;
  csrf: string | undefined;
  origin: string | undefined = TEST_ORIGIN;
  sendCsrf = true;

  constructor(app: Express) {
    this.#app = app;
  }

  get(path: string): Promise<Response> {
    return this.#capture(this.#prepare(request(this.#app).get(path)));
  }

  post(path: string, body?: object): Promise<Response> {
    const req = this.#prepare(request(this.#app).post(path));
    return this.#capture(body === undefined ? req : req.send(body));
  }

  delete(path: string): Promise<Response> {
    return this.#capture(this.#prepare(request(this.#app).delete(path)));
  }

  #prepare(req: request.Test): request.Test {
    if (this.cookie !== undefined) req.set('Cookie', this.cookie);
    if (this.origin !== undefined) req.set('Origin', this.origin);
    if (this.sendCsrf && this.csrf !== undefined) req.set('X-CSRF-Token', this.csrf);
    return req;
  }

  async #capture(req: request.Test): Promise<Response> {
    const res = await req;
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const header of setCookie ?? []) {
      const [pair] = header.split(';');
      if (pair?.startsWith('__Host-sid=')) {
        this.cookie = pair.endsWith('=') ? undefined : pair;
      }
    }
    const body = res.body as { csrfToken?: unknown } | undefined;
    if (typeof body?.csrfToken === 'string') this.csrf = body.csrfToken;
    return res;
  }
}
