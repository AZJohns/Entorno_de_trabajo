/**
 * Formato único de error de la API: "Problem Details" (RFC 9457), con el tipo de contenido
 * `application/problem+json`. El frontend y el backend comparten este esquema.
 */
import { z } from 'zod';

/** Tipo de contenido de las respuestas de error. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Códigos de error estables de la API. Se amplían en cada fase; nunca se reutiliza un código. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'MALFORMED_JSON',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  // Autenticación y sesión (fase 1)
  'UNAUTHENTICATED',
  'SESSION_LOCKED',
  'INVALID_CREDENTIALS',
  'CSRF_FAILED',
  'REAUTH_REQUIRED',
  'RATE_LIMITED',
  'PASSWORD_REJECTED',
  'BREACH_CHECK_UNAVAILABLE',
] as const;

/** Código de error estable (para que el cliente decida qué hacer sin leer textos). */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Detalle de un campo no válido. */
export const fieldErrorSchema = z.object({
  /** Ruta del campo, p. ej. `amount` o `items.0.name`. */
  path: z.string(),
  message: z.string(),
});

/** Cuerpo de una respuesta de error (RFC 9457 + extensiones `code`, `errors` y `requestId`). */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  code: z.enum(ERROR_CODES),
  errors: z.array(fieldErrorSchema).optional(),
  requestId: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type FieldError = z.infer<typeof fieldErrorSchema>;
