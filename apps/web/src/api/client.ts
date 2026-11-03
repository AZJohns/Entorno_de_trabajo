/**
 * Cliente HTTP de la API (`/api/v1`). Mismo origen que la web: la cookie de sesión (`__Host-sid`,
 * HttpOnly) la envía el navegador, y el JavaScript nunca la lee.
 *
 * En las peticiones que modifican datos añade `X-CSRF-Token`. El token se guarda SOLO en memoria: se
 * pierde al recargar y se recupera con `GET /auth/session`. Así no queda en `localStorage`, donde un
 * XSS podría leerlo después.
 */
import { problemDetailsSchema, type ErrorCode, type ProblemDetails } from '@backoffice/shared';
import type { z } from 'zod';

const BASE = '/api/v1';

let csrfToken: string | null = null;

/** Guarda el token CSRF de la sesión actual (o lo borra con `null`). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Error de la API en formato RFC 9457. `code` es estable: la interfaz decide por él, no por el texto. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly problem: ProblemDetails | null;

  constructor(status: number, code: ErrorCode | 'NETWORK_ERROR', problem: ProblemDetails | null) {
    super(problem?.detail ?? problem?.title ?? 'No se pudo conectar con el servidor');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.problem = problem;
  }
}

/** Indica si el error es de la API y tiene uno de los códigos dados. */
export function isApiError(error: unknown, ...codes: ErrorCode[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.some((c) => c === error.code));
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Esquema de la respuesta. Sin él, se espera una respuesta vacía (204). */
  schema?: z.ZodType<T>;
}

/**
 * Hace una petición a la API y valida la respuesta con su esquema compartido.
 *
 * @throws {ApiError} si la respuesta es un error, si no hay conexión o si no cumple el esquema.
 */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', null);
  }

  if (!response.ok) {
    const parsed = problemDetailsSchema.safeParse(await response.json().catch(() => null));
    if (parsed.success) throw new ApiError(response.status, parsed.data.code, parsed.data);
    throw new ApiError(response.status, 'INTERNAL_ERROR', null);
  }
  if (options.schema === undefined) return undefined as T;
  return options.schema.parse(await response.json());
}
