# Módulo `auth`

Autenticación del único usuario con dos factores (contraseña + TOTP), sesiones con estado, CSRF, reautenticación para las acciones sensibles y auditoría. Decisiones y alternativas: [ADR 0006](../../../../../docs/adr/0006-sesiones-y-dos-factores.md). Diseño: `docs/plan.md` §2.2, §2.10 y §6.2.

## Responsabilidad

- Verificar la identidad (contraseña con Argon2id, TOTP, códigos de recuperación) y gestionar el ciclo de vida de las sesiones.
- Decidir el **acceso** de cada petición: el resto de módulos no comprueba sesiones; la aplicación aplica `guard('active')` a toda ruta que no sea de `/auth`.
- Registrar los eventos de seguridad en `audit_events` (inventario en `docs/seguridad/logs.md`).
- No gestiona tokens de dispositivo (fase 2) ni passkeys (se evalúan en la fase 2).

## Estructura

| Carpeta / archivo | Contenido | E/S |
|---|---|---|
| `domain/` | TOTP (RFC 6238), códigos de recuperación, política de contraseñas, reglas de estado de la sesión | No (lógica pura) |
| `crypto/` | Argon2id (`crypto.argon2`), AES-256-GCM para la semilla TOTP, tokens de sesión y CSRF | Solo `node:crypto` |
| `infra/` | Cliente de Pwned Passwords (HIBP) y carga de la lista de contraseñas comunes | Red, disco |
| `data/common-passwords.txt` | 3.000 contraseñas comunes de 15 o más caracteres (SecLists, MIT). Se regenera con `pnpm --filter @backoffice/api build:common-passwords` (versión fijada por commit y SHA-256) | — |
| `auth.repository.ts` | Consultas de Kysely sobre las tablas del módulo | Base de datos |
| `auth.service.ts` | Casos de uso: login, segundo factor, desbloqueo, reautenticación, cambios de factor, sesiones, operaciones de servidor | — |
| `auth.middleware.ts` | `loadSession`, `verifyCsrf` y `guard(access)` | — |
| `auth.controller.ts`, `auth.routes.ts` | HTTP: validación con los esquemas de `@backoffice/shared` y respuestas | — |

## API pública (`index.ts`)

- `createAuthModule(deps)` → `{ service, router, loadSession, verifyCsrf, guard }`. Lo usa `app.ts`.
- `createAuthService(deps)` → `AuthService`. Lo usan los scripts de servidor.
- `getSession(res)`: sesión de la petición actual (para otros módulos, cuando la necesiten).
- `createHibpChecker()`, tipos `PasswordBreachChecker`, `SessionContext`, `Access`, `InitialCredentials`.

`deps`: `db`, `clock` (inyectable para los tests), `totpKey` y `totpKeyVersion`, `breachChecker` y `publicOrigin` (su dominio se añade a las palabras del contexto).

## Endpoints (`/api/v1/auth`)

| Método y ruta | Acceso | Límite | Respuesta |
|---|---|---|---|
| `POST /login` | `public` | 5/15 min por IP y, después, 20/h en total | 200 `{ next, csrfToken, expiresAt }` + cookie de una sesión `pending` (5 min) |
| `POST /login/second-factor` | `mfa_pending` | 10/15 min por IP (contador común con `/unlock` y `/reauth`); 5 fallos por sesión | 200 estado de la sesión + **cookie nueva** |
| `POST /unlock` | `locked` | Igual | 200 estado + cookie nueva. Solo contraseña |
| `POST /reauth` | `active` | Igual | 200 estado + cookie nueva. Contraseña + TOTP; vale 10 min |
| `POST /logout` | `session` | — | 204, cookie borrada y `Clear-Site-Data` |
| `GET /session` | `session` | — | Estado (`pending`, `locked` o `active`), token CSRF y caducidades |
| `GET /sessions` | `active` | — | Sesiones abiertas |
| `DELETE /sessions/:id` | `active_reauth` | — | 204 |
| `POST /password` | `active_reauth` | — | 204. Comprueba longitud, lista común, palabras del contexto y HIBP |
| `POST /totp/enroll` | `active_reauth` | — | 200 `{ secret, otpauthUri }` (alta pendiente) |
| `POST /totp/confirm` | `active_reauth` | — | 204. Activa la semilla nueva y borra la anterior |
| `POST /recovery-codes` | `active_reauth` | — | 200 `{ codes }`, una sola vez |

Acceso: `public` (sin sesión), `session` (cualquier sesión viva), `mfa_pending`, `locked`, `active` (sesión completa y sin bloquear) y `active_reauth` (además, reautenticación en los últimos 10 minutos). Todas las peticiones que modifican datos exigen el origen correcto y, si hay sesión, `X-CSRF-Token`.

## Tablas (migración `0002_auth`)

- `users`: un único usuario (índice único sobre `(true)`), `password_hash` en formato PHC y `disabled_at`.
- `sessions`: `token_hash` (SHA-256), `stage`, `failed_attempts`, `last_seen_at`, `expires_at`, `reauthenticated_at`, `revoked_at`, `user_agent`.
- `totp_authenticators`: semilla cifrada (`secret_ciphertext`, `secret_nonce`, `key_version`), `last_used_step` y `confirmed_at`. Como mucho una confirmada y una pendiente por usuario.
- `recovery_codes`: `code_hash` (Argon2id) y `used_at`.
- `audit_events`: solo inserción (trigger). Sin contraseñas, códigos ni tokens.

## Operaciones de servidor

Se ejecutan en el servidor con el `.env` cargado. Leen la contraseña sin mostrarla.

| Comando | Qué hace |
|---|---|
| `pnpm user:create` | Crea el único usuario: contraseña, TOTP (muestra la clave y el enlace `otpauth://` **una vez**) y 10 códigos de recuperación (**una vez**). |
| `pnpm --filter @backoffice/api user:reset-password` | Nueva contraseña; revoca todas las sesiones. **No** toca el TOTP (ASVS 6.4.3). |
| `pnpm --filter @backoffice/api user:revoke-sessions` | Revoca todas las sesiones. |
| `pnpm --filter @backoffice/api user:disable` | Deshabilita la cuenta y revoca sus sesiones. |

`user:create` y `user:reset-password` consultan HIBP: sin red hacia `api.pwnedpasswords.com`, fallan (fallo cerrado).

## Claves y rotación

- `TOTP_ENCRYPTION_KEY`: 32 bytes aleatorios en base64; copia en el gestor de contraseñas. `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
- **Rotarla**: cambiar la clave y subir `TOTP_ENCRYPTION_KEY_VERSION`. El TOTP antiguo deja de funcionar (el segundo factor responde 500, fallo cerrado). Entrar con un **código de recuperación** y, en Ajustes → Seguridad, generar una clave nueva y confirmarla. Lo prueba `test/auth/account.test.ts` («rotación de la clave de cifrado del TOTP»).

## Tests

`apps/api/test/auth/`: unitarios del dominio y la criptografía (sin base de datos) e integración con PostgreSQL real, reloj simulado y HIBP falso (`login.test.ts`, `account.test.ts`, `rate-limit.test.ts`, `proxy.test.ts`). Ningún test sale a la red.
