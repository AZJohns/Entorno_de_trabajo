# Clasificación de los datos y protección por nivel

> ASVS 14.1.1 (datos sensibles identificados y clasificados) y 14.1.2 (requisitos de protección por nivel). Estado al cierre de la **fase 1**. Cada fase que añada datos (importación, notas, tareas, tokens de dispositivo) los clasifica aquí en el mismo PR. Sin datos reales.

## 1. Niveles

| Nivel | Qué es | Si se filtra |
|---|---|---|
| **N3 · Secreto** | Permite suplantar al propietario o descifrar otros datos | Compromiso total y difícil de revertir |
| **N2 · Confidencial** | Datos personales y financieros del propietario | Daño a la privacidad; no permite entrar |
| **N1 · Interno** | Metadatos y registros técnicos sin importes ni credenciales | Ayuda a un atacante, pero no es dañino por sí mismo |
| **N0 · Público** | Código, documentación y configuración sin valores | Ninguno: ya es público (repositorio público) |

## 2. Clasificación

| Conjunto | Datos (tablas o ficheros) | Nivel |
|---|---|---|
| **Credenciales y secretos** | Valores de `.env` (`TOTP_ENCRYPTION_KEY`, `DATABASE_URL`, credenciales de copias); semilla TOTP descifrada; contraseña en claro (solo en memoria durante la petición); códigos de recuperación en claro; token de sesión en claro (cookie); tokens de dispositivo en claro (fase 2) | **N3** |
| **Credenciales almacenadas** | `users.password_hash` (Argon2id), `totp_authenticators.secret_ciphertext` y `secret_nonce` (AES-256-GCM), `recovery_codes.code_hash` (Argon2id), `sessions.token_hash` y `device_tokens.token_hash` (SHA-256) | **N3** (se tratan como secretos aunque estén protegidos: un hash filtrado permite ataques sin conexión) |
| **Datos financieros** | `accounts`, `categories`, `movements` (importes, conceptos, comercios), `transfers`, `reconciliations`; en la fase 2, `wallet_cards` y `raw_payload`; el Excel de origen y los extractos | **N2** |
| **Sesiones** | `sessions` (sin el token en claro): `stage`, `failed_attempts`, `last_seen_at`, `expires_at`, `user_agent` | **N1** (el hash del token, N3) |
| **Auditoría** | `audit_events` (actor, acción, entidad, `metadata` sin importes, tokens ni contraseñas) y la IP si se registra | **N1** |
| **Logs técnicos** | Salida estándar de pino: `requestId`, método, ruta sin query string, código de estado | **N1** |
| **Configuración** | `.env.example`, ADR, `docs/`, esquemas de `packages/shared`, `users.timezone` y preferencias de interfaz | **N0** (el valor real de una variable de entorno es N3; la preferencia de interfaz, N1) |
| **Copias de seguridad** | Volcados cifrados de PostgreSQL y repositorio restic (fase 2) | Hereda el nivel más alto que contienen: **N3** |
| **Exportación** | Archivo JSON de `GET /export` | **N2** (nunca contiene datos de autenticación) |

Las notas y las tareas (fases posteriores) se clasificarán como **N2** cuando existan: son texto libre del propietario.

## 3. Requisitos por nivel (ASVS 14.1.2)

La columna «Estado» distingue lo que ya cumple el código de lo que depende de una fase posterior.

| Requisito | N3 · Secreto | N2 · Confidencial | N1 · Interno | N0 · Público |
|---|---|---|---|---|
| **Cifrado en tránsito** | HTTPS con HSTS (fase 2); cookie `Secure`, `HttpOnly`, `SameSite=Lax` y prefijo `__Host-` | HTTPS con HSTS (fase 2) | HTTPS con HSTS (fase 2) | No exigido |
| **Cifrado en reposo** | Hashes (Argon2id o SHA-256, nunca reversibles); la semilla TOTP, cifrada con AES-256-GCM y `key_version`; copias cifradas en el cliente (restic). Sin cifrado de columnas en general: quien compromete el servidor obtiene también la clave (`plan.md` §6) | Copias cifradas (fase 2). El cifrado del disco del servidor **no está decidido** (se decide en la fase 2, `plan.md` §6). No se cifran columnas | Sin requisito específico | No aplica |
| **Almacenamiento** | Nunca en el repositorio, en la URL, en `localStorage` ni en la respuesta de la API. Secretos solo en variables de entorno o en el almacén de secretos del host | Solo en PostgreSQL. Nunca en la URL (la búsqueda `q` es la excepción documentada en 14.2.1: no se registra la query string) ni en el almacenamiento del navegador (14.3.3) | En PostgreSQL y en los logs del contenedor | Repositorio público |
| **Logs** | Prohibido registrarlos, enteros o parciales. Pino sustituye por `[REDACTED]` las cabeceras `Cookie`, `Authorization`, `X-CSRF-Token` y `Set-Cookie` y los campos de contraseña y código. Un test lo comprueba (`apps/api/test/logger.test.ts`) | Prohibido registrar importes, conceptos, comercios y cuerpos de petición. Se registran los **nombres** de los campos inválidos, no sus valores (`logs.md` §2) | Permitido; sin cuerpos ni cookies | Libre |
| **Exportación** | **Nunca** se exporta, ni siquiera con reautenticación | Solo con `GET /export`: exige sesión completa y reautenticación reciente (S+), `Content-Disposition: attachment`, nombre generado y registro `data.exported` en la auditoría **con recuentos, sin importes** (`api-export.test.ts`) | Sin exportación; se consulta por la base de datos o los logs | Libre |
| **Acceso** | Solo el proceso de la API (variables de entorno) y el propietario en el host. Nunca en respuestas de la API | Solo con sesión completa. Un token de dispositivo (fase 2) solo llega a `/ingest/*` | Con sesión completa (la lista de sesiones) o desde el host | Cualquiera |
| **Retención** | Sesión: 24 h absolutas y 1 h de inactividad (`limites.md` §4); caducadas: se borran a los 30 días (§4, sin implementar). Tokens de dispositivo: ≤ 366 días y revocables. Códigos de recuperación: regenerarlos borra los anteriores | Mientras el propietario los conserve; se borran al pedirlo. Las copias: 7 diarias, 4 semanales, 12 mensuales y 3 anuales (`plan.md` §6.3). `raw_payload` se borra al confirmar el pendiente (fase 2) | `audit_events`: 1 año (pregunta 35, resuelta). Logs técnicos: 30 días | Indefinida |
| **Minimización** | Un secreto no se copia a otro sitio «por comodidad» | No se guardan números de tarjeta ni credenciales bancarias: de cada tarjeta, solo su nombre en Wallet. No se guardan datos derivados (saldos, totales) | `metadata` de auditoría sin importes, tokens ni contraseñas | — |
| **Rotación y revocación** | Contraseña: cambio con reautenticación. Semilla TOTP: reemplazo con reautenticación. `TOTP_ENCRYPTION_KEY`: rotación por `key_version` (ADR 0006). Si se filtra un secreto, se **rota primero** y luego se limpia (`docs/runbooks/github.md` §8) | No aplica | No aplica | No aplica |

## 4. Estado y huecos conocidos

- **Hecho en la fase 1**: hashes y cifrado de la semilla TOTP, redacción de logs, cookie `__Host-`, `no-store` en `/api`, reautenticación para exportar y auditoría de la exportación.
- **Depende de la fase 2** (despliegue): HTTPS, HSTS, decisión sobre el cifrado de disco, copias restic, cuentas del sistema y el borrado de `raw_payload`. Hasta entonces, N2 y N3 solo existen en el equipo de desarrollo, con datos ficticios.
- **Sin implementar**: la limpieza automática (ver «Retención» más abajo). La tabla `sessions` tiene el índice en `expires_at` para hacerla; hoy no se borra nada. Se hará en la fase 2 y se verificará con un test.

## Retención (pregunta 35, resuelta)

| Dato | Retención | Estado |
|---|---|---|
| `audit_events` | 1 año | Hoy no se borra nada. Limpieza automática en la **fase 2** |
| Sesiones caducadas (`sessions`) | 30 días desde la caducidad | Hoy no se borran. Limpieza automática en la **fase 2** |
| Logs técnicos | 30 días (y en las copias según su retención, `plan.md` §6.3) | Fase 2, con los destinos de producción |

- **Atención al borrado de `audit_events`:** un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` (migración `0002_auth`). La purga de la fase 2 necesita un camino explícito y separado del rol de la aplicación; se decide con los roles de la base de datos (ASVS 16.4.2).

## 5. Cómo se mantiene

- Una tabla o columna nueva con datos de usuario se añade a §2 en el mismo PR que la migración.
- Si un dato pasa a un nivel superior (p. ej., una nota que contiene cifras), se aplican los requisitos del nivel más alto.
- ASVS 14.2.4 (controles implementados por nivel) se verifica fase a fase contra §3.
