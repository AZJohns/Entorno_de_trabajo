# ADR 0006 — Sesiones con estado, Argon2id y dos factores (contraseña + TOTP)

- **Estado:** Aceptado
- **Fecha:** 2026-11-03
- **Modifica:** el punto 5 del ADR 0003 (tipos de la base de datos), ver la decisión 9.

## Contexto

La fase 1 necesita autenticación para un único usuario con nivel NIST AAL2 y OWASP ASVS 5.0 L2 (`plan.md` §6.2). Condiciones:

- Una sola aplicación web en el **mismo origen** que la API (Express sirve la SPA; en desarrollo, el proxy de Vite).
- El repositorio es público: ningún control puede depender de que el código sea secreto.
- Hay que poder **revocar** una sesión al instante (cerrar sesión, cerrar otras sesiones, deshabilitar la cuenta).
- Se quiere el mínimo de dependencias y entender cada pieza (objetivo de aprendizaje).

## Decisión

1. **Sesiones con estado en PostgreSQL** (tabla `sessions`), no JWT.
   - Token aleatorio de 256 bits (`crypto.randomBytes(32)`, base64url) en la cookie `__Host-sid; Path=/; HttpOnly; Secure; SameSite=Lax`. En la base de datos solo se guarda su **SHA-256**: un volcado no permite usar las sesiones. SHA-256 basta (sin sal ni función lenta) porque el token tiene 256 bits de entropía: no se puede atacar por diccionario.
   - Estados: `pending` (contraseña correcta, falta el segundo factor; 5 min), `active`, `locked` (1 h sin uso), `expired` (24 h desde la creación) y `revoked`. Se calculan al leer (`domain/session-rules.ts`) a partir de `stage`, `last_seen_at`, `expires_at` y `revoked_at`.
   - **Rotación del token** al completar el segundo factor, al desbloquear y al reautenticarse (ASVS 7.2.4; evita la fijación de sesión).
   - Como mucho 5 sesiones completas: al crear la sexta se revoca la más antigua.
   - 5 intentos fallidos de segundo factor, desbloqueo o reautenticación en una sesión la revocan.
2. **Desbloqueo con un solo factor** tras 1 h de inactividad (`POST /auth/unlock`, solo contraseña), dentro de las 24 h. NIST SP 800-63B-4 lo permite (*MAY*) para AAL2 junto con el secreto de sesión. No cuenta como reautenticación completa.
3. **Reautenticación completa** (contraseña + TOTP) válida 10 minutos para las acciones sensibles (`active_reauth`): cambiar la contraseña o el TOTP, regenerar los códigos de recuperación y cerrar sesiones. Completar el segundo factor del login cuenta como reautenticación.
4. **Argon2id nativo** (`crypto.argon2`, Node ≥ 24.12) en formato PHC:
   - Contraseñas: 64 MiB, t = 3, p = 4 (segunda recomendación de RFC 9106; por encima del mínimo de OWASP, 19 MiB, t = 2, p = 1). Unos 130 ms por hash en desarrollo. Si los parámetros cambian, el hash se recalcula en el siguiente login correcto (`needsRehash`).
   - Códigos de recuperación: 19 MiB, t = 2, p = 1 (mínimo de OWASP): tienen 80 bits y al verificar uno hay que probar hasta 10 hashes.
   - Si el usuario no existe, se verifica contra un hash ficticio con los mismos parámetros: el tiempo de respuesta no revela si existe.
5. **TOTP implementado en el proyecto** (`domain/totp.ts`, RFC 6238/4226): HMAC-SHA1, 6 cifras, pasos de 30 s.
   - Se acepta el paso actual y el anterior (desfase de reloj). Desviación documentada de ASVS 6.5.5 (`asvs-l2.md`).
   - HMAC-SHA-1 es *Legacy* según el apéndice C de ASVS 5.0: desviación documentada de 11.4.1, por compatibilidad con las apps de autenticación. Antes del alta de producción se probará HMAC-SHA-256 (pregunta 36 de `plan.md`).
   - **Cada código vale una vez**: `last_used_step` se actualiza con una sentencia condicional atómica (`claimTotpStep`), así que dos peticiones simultáneas con el mismo código no pueden ganar las dos.
   - La semilla (20 bytes) se cifra con **AES-256-GCM** (`TOTP_ENCRYPTION_KEY`, nonce de 12 bytes) y se guarda con `key_version`. No puede ir con hash porque hay que recalcular los códigos.
   - Se prueba con los vectores oficiales del apéndice B de RFC 6238.
6. **Códigos de recuperación**: 10 códigos de 80 bits (`XXXX-XXXX-XXXX-XXXX`, base32 de Crockford), de un solo uso (`claimRecoveryCode` atómico), guardados con Argon2id porque tienen menos de 112 bits (ASVS 6.5.2). Al escribirlos se admiten minúsculas, espacios y letras confundibles (I/L → 1, O → 0).
7. **CSRF en tres capas** (ASVS 3.5):
   - `SameSite=Lax` en la cookie.
   - **Origen**: toda petición que modifica datos debe traer `Origin` igual a `PUBLIC_ORIGIN` o, si no hay `Origin`, `Sec-Fetch-Site: same-origin`. Si no, 403. También en el login (evita el *login CSRF*).
   - **Token sincronizado** en `X-CSRF-Token`, **derivado** del token de sesión: `HMAC-SHA256(token de sesión, "csrf-v1")`. No se guarda en la base de datos (ver «Cambios respecto al plan»). Además, las peticiones con cuerpo deben ser `application/json` (415 si no).
8. **Denegar por defecto**: después de las rutas de `/auth`, el router de la API aplica `guard('active')` a todo lo demás. Cada ruta de `/auth` declara su acceso: `public`, `session`, `mfa_pending`, `locked`, `active` o `active_reauth`. Un test enumera las rutas públicas.
9. **Tipos de Kysely escritos a mano** (`apps/api/src/db/schema.ts`) en lugar de `kysely-codegen` (cambia el punto 5 del ADR 0003): son 5 tablas, `kysely-codegen` sería una dependencia más y exigiría una base de datos en marcha para generar los tipos. Los tests de integración contra PostgreSQL real detectan las discrepancias.
10. **Auditoría** en `audit_events`, de **solo inserción**: un trigger lanza una excepción en `UPDATE`, `DELETE` y `TRUNCATE`. Los roles separados de la base de datos (la app solo con `INSERT` y `SELECT`) llegan en la fase 2 con el despliegue.
11. **Rotación de la clave del TOTP**: no hay re-cifrado automático. Al cambiar `TOTP_ENCRYPTION_KEY` se sube `TOTP_ENCRYPTION_KEY_VERSION`. La semilla antigua deja de poder abrirse: el login con TOTP **falla cerrado** (500). Procedimiento: entrar con un código de recuperación (que cuenta como reautenticación) y dar de alta un TOTP nuevo en Ajustes → Seguridad. Con un solo usuario, esto es más simple y seguro que mantener varias claves activas.
12. **Contraseñas filtradas**: API de rangos de Pwned Passwords (k-anonimato: solo se envían los 5 primeros caracteres del SHA-1), con `Add-Padding`, `redirect: 'error'` y 5 s de tiempo máximo. Si no responde, el cambio de contraseña **se rechaza** (503, fallo cerrado).

## Cambios respecto a `plan.md` (actualizado en el mismo PR)

- **Sin columna `csrf_token_hash`**: el token CSRF se deriva por HMAC del token de sesión. Es igual de imprevisible (quien no tiene la cookie no puede calcularlo), rota con la sesión y elimina una columna y una consulta.
- **`GET /auth/session` responde también a una sesión bloqueada** (`state: 'locked'`, con su token CSRF): la web lo necesita para mostrar la pantalla de desbloqueo y enviar `POST /auth/unlock` con CSRF. No devuelve datos de negocio.
- `sessions` tiene además `failed_attempts`; `users`, `disabled_at` (deshabilitar la cuenta sin borrarla); `totp_authenticators`, un índice único parcial para como mucho **un alta pendiente** por usuario.
- `POST /auth/login/second-factor`, `/auth/unlock` y `/auth/reauth` responden **200 con el estado de la sesión** (incluido el token CSRF nuevo) en lugar de 204: el token CSRF cambia al rotar la sesión y la web lo necesita.
- `DELETE /auth/sessions/:id` exige reautenticación (S+), como ya decía §6.2 («cerrarlas exige reautenticación»); la tabla de endpoints decía S.
- Límite global del login: **20 intentos por hora en total**, en lugar de una «espera creciente global» (más simple de razonar y de probar).
- HIBP: User-Agent fijo y genérico (`backoffice-personal`), sin la variable `HIBP_USER_AGENT`: no es un secreto ni identifica al usuario.
- Configuración nueva: `HOST` (127.0.0.1 por defecto) y `TRUST_PROXY_HOPS` (0 por defecto); ver `docs/seguridad/limites.md`.

## Alternativas descartadas

- **JWT en cookie o en `Authorization`**: no se puede revocar una sesión sin una lista de revocación en el servidor (que la convierte en una sesión con estado), el contenido es legible y hay errores clásicos de configuración (`alg`, claves). Con una sola API y un solo origen no aporta nada. ASVS V9 queda «No aplica».
- **`express-session` + `connect-pg-simple`**: dos dependencias para unas 150 líneas propias. Además, el almacén guarda el identificador de sesión en claro (un volcado de la base de datos permitiría usar las sesiones) y los estados `pending`/`locked` y la rotación habría que construirlos encima igualmente.
- **`csurf`**: obsoleto. Un token guardado en la base de datos: válido, pero no aporta seguridad frente al derivado.
- **`SameSite=Strict`**: una navegación iniciada fuera de la app (una notificación, un enlace) llegaría sin cookie. Con `Lax` + comprobación de origen + token, el riesgo de CSRF está cubierto.
- **bcrypt** (límite de 72 bytes, sin coste de memoria) y **scrypt**: Argon2id es la primera opción de OWASP y Node ya lo trae.
- **`otplib`, `speakeasy`**: el algoritmo son unas 60 líneas con vectores de prueba oficiales; una dependencia no reduce el riesgo.
- **Bloqueo de cuenta tras N fallos**: con un solo usuario, cualquiera podría dejar fuera al propietario (ASVS 6.1.1). Se limitan las peticiones por IP y en total.
- **WebAuthn/passkeys ahora**: se evalúa en la fase 2 en el iPhone (`plan.md` §6.2).

## Consecuencias

- Cada petición autenticada hace una consulta a `sessions` (y una escritura de `last_seen_at`): irrelevante con un usuario.
- Los contadores de los límites de peticiones están en memoria: se pierden al reiniciar. Aceptable con una sola instancia.
- Perder `TOTP_ENCRYPTION_KEY` obliga a usar un código de recuperación y volver a dar de alta el TOTP (decisión 11). La clave se guarda en el gestor de contraseñas.
- La CSP y HSTS se envían también en desarrollo (HTTP): el navegador ignora HSTS por HTTP, así que no afecta.
