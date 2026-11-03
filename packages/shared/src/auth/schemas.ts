/**
 * Esquemas de las peticiones y respuestas de autenticación, compartidos por la web y la API.
 *
 * Las peticiones usan objetos estrictos: un campo desconocido es un error (protección contra la
 * asignación masiva, ASVS 15.3.3). Las contraseñas NUNCA se recortan ni se transforman: se verifican
 * exactamente como llegan (ASVS 6.2.8).
 */
import { z } from 'zod';

/** Longitud mínima de una contraseña nueva, en caracteres (puntos de código). NIST 800-63B-4 / ASVS 6.2.1. */
export const PASSWORD_MIN_LENGTH = 15;
/** Longitud máxima admitida de una contraseña nueva, en caracteres. ASVS 6.2.9 exige admitir al menos 64. */
export const PASSWORD_MAX_LENGTH = 256;

/** Tope de longitud de cualquier campo de contraseña recibido (en unidades UTF-16), antes de hashearlo. */
const PASSWORD_INPUT_MAX = 1024;

const password = z.string().min(1).max(PASSWORD_INPUT_MAX);
const totpCode = z.string().regex(/^\d{6}$/, 'El código tiene 6 cifras');

export const loginRequestSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password,
});

export const secondFactorRequestSchema = z.union([
  z.strictObject({ totp: totpCode }),
  z.strictObject({ recoveryCode: z.string().min(1).max(64) }),
]);

export const unlockRequestSchema = z.strictObject({ password });

export const reauthRequestSchema = z.strictObject({ password, totp: totpCode });

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: password,
  newPassword: password,
  terminateOtherSessions: z.boolean(),
});

export const totpConfirmRequestSchema = z.strictObject({
  code: totpCode,
  terminateOtherSessions: z.boolean(),
});

/** Estado de la sesión actual. `csrfToken` debe enviarse en `X-CSRF-Token` en las peticiones que modifican datos. */
export const sessionResponseSchema = z.object({
  user: z.object({ username: z.string() }),
  stage: z.enum(['mfa_pending', 'full']),
  /** `locked`: sin uso durante 1 h; se desbloquea con la contraseña (`POST /auth/unlock`). */
  state: z.enum(['pending', 'locked', 'active']),
  csrfToken: z.string(),
  expiresAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
  reauthenticatedUntil: z.iso.datetime().nullable(),
});

/** Respuesta del primer paso del inicio de sesión: falta el segundo factor. */
export const loginResponseSchema = z.object({
  next: z.literal('second-factor'),
  csrfToken: z.string(),
  expiresAt: z.iso.datetime(),
});

export const sessionListResponseSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.uuid(),
      createdAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
      userAgent: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
});

export const totpEnrollResponseSchema = z.object({
  /** Clave en base32, para introducirla a mano en la app de autenticación. */
  secret: z.string(),
  /** URI `otpauth://` (en iOS, abre la app Contraseñas para añadir el código). */
  otpauthUri: z.string(),
});

export const recoveryCodesResponseSchema = z.object({ codes: z.array(z.string()) });

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SecondFactorRequest = z.infer<typeof secondFactorRequestSchema>;
export type UnlockRequest = z.infer<typeof unlockRequestSchema>;
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type TotpConfirmRequest = z.infer<typeof totpConfirmRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type TotpEnrollResponse = z.infer<typeof totpEnrollResponseSchema>;
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;
