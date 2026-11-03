# Inventario de logs y eventos de seguridad

> ASVS 16.1.1 (inventario) y 16.2.x–16.3.x. Estado de la **fase 1 (autenticación)**: cada fase añade sus eventos aquí en el mismo PR. Los destinos de producción (ASVS 16.2.3) se cierran en la fase 2.

## 1. Destinos

| Destino | Qué contiene | Formato | Retención |
|---|---|---|---|
| Salida estándar (pino) | Una línea por petición, rechazos de seguridad (`warn`) y errores inesperados (`error`) | JSON, una línea por evento, hora ISO 8601 en UTC | Desarrollo: la terminal. Fase 2: logs de Docker y copia diaria al almacén de solo añadir (`plan.md` §6.2) |
| Tabla `audit_events` (PostgreSQL) | Eventos de autenticación y de cambios de seguridad (§3) | Filas con columnas fijas y `metadata` JSON | Indefinida. **Solo inserción**: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` |

## 2. Log de peticiones (pino + pino-http)

- **Por petición** (nivel `info`): `requestId` (UUID generado por el servidor; nunca se acepta el del cliente), método, ruta **sin la query string**, cabeceras y código de estado.
- **Nunca se registran** (ASVS 16.2.5): el cuerpo de la petición ni de la respuesta; las cabeceras `Cookie`, `Authorization`, `X-CSRF-Token` y `Set-Cookie` (pino las sustituye por `[REDACTED]`); los campos `password`, `newPassword`, `currentPassword`, `totp`, `code`, `recoveryCode` y `token` de cualquier objeto registrado. Lista en `apps/api/src/http/logger.ts` (`REDACTED_PATHS`).
- **Rechazos de seguridad** (nivel `warn`, mensaje `Petición rechazada`, campo `code`), ASVS 16.3.2 y 16.3.3:

  | `code` | Cuándo |
  |---|---|
  | `UNAUTHENTICATED` | Ruta protegida sin sesión, con una sesión caducada o revocada, o con una sesión pendiente del segundo factor |
  | `INVALID_CREDENTIALS` | Contraseña, código TOTP o código de recuperación incorrectos |
  | `CSRF_FAILED` | Origen no permitido o token CSRF ausente o incorrecto |
  | `REAUTH_REQUIRED` | Acción sensible sin reautenticación reciente |
  | `RATE_LIMITED` | Límite de peticiones superado |
  | `VALIDATION_ERROR` | El cuerpo o los parámetros no cumplen el esquema (se registran los **nombres** de los campos, no sus valores) |
  | `MALFORMED_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Cuerpo que no es JSON válido, de más de 100 KB o de otro tipo |

  La web valida con los mismos esquemas antes de enviar: estos rechazos en la API indican un cliente manipulado o un error.

- **Errores inesperados** (nivel `error`, mensaje `Error no controlado`): la traza solo queda en el log; el cliente recibe un 500 genérico con el `requestId` para poder relacionarlos (ASVS 16.5.1).

## 3. Eventos de `audit_events`

Columnas: `occurred_at`, `actor` (`user:<id>`, `anonymous` o `system:cli`), `action`, `entity_type` y `entity_id` (p. ej., la sesión), `ip` y `metadata`. **Sin** contraseñas, códigos, tokens ni nombres de usuario introducidos en un login fallido (podrían ser una contraseña escrita en el campo equivocado).

| `action` | Actor | Cuándo | `metadata` |
|---|---|---|---|
| `user.created` | `system:cli` | `pnpm user:create` | — |
| `login.password_success` | `user:<id>` | Contraseña correcta (sesión pendiente del segundo factor) | — |
| `login.failure` | `anonymous` | Contraseña incorrecta, usuario inexistente o cuenta deshabilitada (no se distingue) | — |
| `mfa.success` | `user:<id>` | Segundo factor correcto con TOTP | — |
| `recovery_code.used` | `user:<id>` | Segundo factor correcto con un código de recuperación | — |
| `mfa.failure` | `user:<id>` | Segundo factor incorrecto | `method`, `attempts`, `sessionRevoked` |
| `unlock.success` / `unlock.failure` | `user:<id>` | Desbloqueo tras inactividad | En el fallo: `attempts`, `sessionRevoked` |
| `reauth.success` / `reauth.failure` | `user:<id>` | Reautenticación completa | En el fallo: `attempts`, `sessionRevoked` |
| `logout` | `user:<id>` | Cierre de la sesión actual | — |
| `session.revoked` | `user:<id>` | Cierre de una sesión desde la lista | — |
| `password.changed` / `password.change_failure` | `user:<id>` | Cambio de contraseña (el fallo: contraseña actual incorrecta) | `otherSessionsRevoked` |
| `totp.enroll_started` / `totp.changed` | `user:<id>` | Alta de una semilla nueva / confirmación | `otherSessionsRevoked` |
| `recovery_codes.regenerated` | `user:<id>` | Regeneración de los 10 códigos | — |
| `password.reset` | `system:cli` | `user:reset-password` | `sessionsRevoked` |
| `sessions.revoked_all` | `system:cli` | `user:revoke-sessions` | `sessionsRevoked` |
| `user.disabled` | `system:cli` | `user:disable` | `sessionsRevoked` |

Tests: `apps/api/test/auth/account.test.ts` («registra los eventos de autenticación…», «la auditoría es de solo inserción…», «ni los logs ni la auditoría contienen contraseñas, códigos ni tokens») y `apps/api/test/security.test.ts` (rechazos registrados con su código y sin el cuerpo).

## 4. Pendiente en fases posteriores

- Fase 2: roles separados de la base de datos (la app solo con `INSERT` y `SELECT` en `audit_events`), destinos de producción, copia diaria y eventos de los tokens de dispositivo y de la exportación (`data.exported`).
- Fases 1b–3: eventos de negocio relevantes para la seguridad (confirmación de importaciones, `authz.denied` cuando haya permisos distintos de la sesión).
