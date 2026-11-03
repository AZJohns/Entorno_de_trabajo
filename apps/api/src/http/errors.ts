/**
 * Gestión centralizada de errores: toda respuesta de error sigue RFC 9457 ("Problem Details") con
 * el esquema compartido de `@backoffice/shared`. Ningún controlador construye errores a mano.
 */
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { z } from 'zod';
import {
  PROBLEM_CONTENT_TYPE,
  type ErrorCode,
  type FieldError,
  type ProblemDetails,
} from '@backoffice/shared';

/** Error de aplicación con código estable y estado HTTP. Los servicios lanzan este tipo. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly errors: readonly FieldError[] | undefined;

  constructor(code: ErrorCode, status: number, message: string, errors?: readonly FieldError[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

const TITLES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Datos no válidos',
  MALFORMED_JSON: 'JSON mal formado',
  PAYLOAD_TOO_LARGE: 'Petición demasiado grande',
  UNSUPPORTED_MEDIA_TYPE: 'Tipo de contenido no admitido',
  NOT_FOUND: 'Recurso no encontrado',
  CONFLICT: 'Conflicto con el estado actual',
  UNPROCESSABLE: 'Datos incoherentes con el libro',
  INTERNAL_ERROR: 'Error interno',
  UNAUTHENTICATED: 'Sesión no iniciada',
  SESSION_LOCKED: 'Sesión bloqueada por inactividad',
  INVALID_CREDENTIALS: 'Credenciales incorrectas',
  CSRF_FAILED: 'Petición rechazada (CSRF)',
  REAUTH_REQUIRED: 'Hace falta volver a autenticarse',
  RATE_LIMITED: 'Demasiados intentos',
  PASSWORD_REJECTED: 'Contraseña no válida',
  BREACH_CHECK_UNAVAILABLE: 'No se pudo comprobar la contraseña',
};

/**
 * Rechazos que indican un posible intento de saltarse un control: se registran como aviso (ASVS
 * 16.3.2, 16.3.3). La web valida con los mismos esquemas antes de enviar, así que un fallo de
 * validación o de formato en la API es un cliente manipulado o un error que conviene ver.
 */
const LOGGED_REJECTIONS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'VALIDATION_ERROR',
  'MALFORMED_JSON',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'CSRF_FAILED',
  'REAUTH_REQUIRED',
  'RATE_LIMITED',
]);

function problem(
  code: ErrorCode,
  status: number,
  requestId: string | undefined,
  detail?: string,
  errors?: readonly FieldError[],
): ProblemDetails {
  return {
    type: `about:blank#${code}`,
    title: TITLES[code],
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors: [...errors] }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/** Identificador de la petición que asigna pino-http (siempre un UUID generado por el servidor). */
function requestIdOf(req: Request): string | undefined {
  return typeof req.id === 'string' ? req.id : undefined;
}

/** Respuesta 404 para rutas que no existen. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .type(PROBLEM_CONTENT_TYPE)
    .json(problem('NOT_FOUND', 404, requestIdOf(req)));
};

/** Errores que lanza el parser de JSON de Express (body-parser). */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

/**
 * Último middleware: convierte cualquier error en una respuesta RFC 9457.
 *
 * Un error inesperado devuelve un 500 genérico, sin trazas ni mensajes internos (ASVS 16.5.1). La
 * traza solo se registra en el log del servidor, junto con el `requestId` para localizarla.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = requestIdOf(req);
  let body: ProblemDetails;

  if (err instanceof AppError) {
    body = problem(err.code, err.status, requestId, err.message, err.errors);
  } else if (err instanceof z.ZodError) {
    const errors = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    body = problem('VALIDATION_ERROR', 400, requestId, undefined, errors);
  } else if (isBodyParserError(err) && err.type === 'entity.parse.failed') {
    body = problem('MALFORMED_JSON', 400, requestId);
  } else if (isBodyParserError(err) && err.type === 'entity.too.large') {
    body = problem('PAYLOAD_TOO_LARGE', 413, requestId);
  } else {
    req.log.error({ err }, 'Error no controlado');
    body = problem('INTERNAL_ERROR', 500, requestId);
  }

  if (LOGGED_REJECTIONS.has(body.code)) {
    // Solo el código y, si los hay, los nombres de los campos: nunca sus valores ni el cuerpo.
    const fields = body.errors?.map((error) => error.path);
    req.log.warn(
      { code: body.code, ...(fields === undefined ? {} : { fields }) },
      'Petición rechazada',
    );
  }
  res.status(body.status).type(PROBLEM_CONTENT_TYPE).json(body);
};
