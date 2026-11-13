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

/** Cuerpo binario (la subida del Excel): el tipo lo fija el llamador, nunca el archivo. */
export interface RawBody {
  readonly data: Blob;
  readonly contentType: string;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Cuerpo binario en lugar de JSON. No se combina con `body`. */
  rawBody?: RawBody;
  /** Esquema de la respuesta. Sin él, se espera una respuesta vacía (204). */
  schema?: z.ZodType<T>;
}

/** Respuesta ya validada junto con su código HTTP (p. ej. 201 «creado» frente a 200 «ya existía»). */
export interface ApiResult<T> {
  readonly status: number;
  readonly data: T;
}

/**
 * Hace una petición a la API y devuelve la respuesta validada con su código HTTP.
 *
 * @throws {ApiError} si la respuesta es un error, si no hay conexión o si no cumple el esquema.
 */
export async function apiWithStatus<T = void>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.rawBody !== undefined) headers['Content-Type'] = options.rawBody.contentType;
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body:
        options.rawBody !== undefined
          ? options.rawBody.data
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
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
  if (options.schema === undefined) return { status: response.status, data: undefined as T };
  return { status: response.status, data: options.schema.parse(await response.json()) };
}

/**
 * Hace una petición a la API y valida la respuesta con su esquema compartido.
 *
 * @throws {ApiError} si la respuesta es un error, si no hay conexión o si no cumple el esquema.
 */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  return (await apiWithStatus(path, options)).data;
}
