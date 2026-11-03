# Límites de negocio, límites de peticiones y funciones costosas

> ASVS 2.1.3, 2.3.2, 6.1.1, 6.1.2 y 15.1.3. Estado al cierre de la **fase 1**; las fases siguientes añaden sus límites (importación, ingesta). Sin datos reales.
>
> **Índice único de todos los límites: §7.** Las demás secciones explican el porqué.

## 1. Límites de peticiones (ASVS 2.4.1, 6.1.1, 6.3.1)

Implementados con `express-rate-limit` (`apps/api/src/http/rate-limit.ts`). Al superarlos: **429** con el código `RATE_LIMITED` y las cabeceras `RateLimit` y `RateLimit-Policy` (borrador 8 del IETF), que indican cuándo se puede volver a intentar.

| Qué | Límite | Clave | Motivo |
|---|---|---|---|
| `POST /auth/login` | 5 cada 15 min | IP | Frena la fuerza bruta desde un origen. Con un solo usuario, 5 intentos bastan para equivocarse al escribir |
| `POST /auth/login` | 20 por hora | Global (todas las IP) | Frena un ataque repartido entre muchas IP (*credential stuffing* con *botnet*). Se aplica **después** del límite por IP: las peticiones que este rechaza no gastan el cupo global |
| `POST /auth/login/second-factor`, `/auth/unlock`, `/auth/reauth` | 10 cada 15 min, **en total entre las tres rutas** (un solo contador por IP) | IP | Frena la prueba de códigos TOTP (10⁶ combinaciones) y de contraseñas en una sesión robada |
| Segundo factor, desbloqueo y reautenticación | 5 fallos | Sesión (`failed_attempts` en la base de datos) | Al quinto fallo, la sesión se revoca y hay que volver a empezar. Sobrevive a un reinicio |

- **Sin bloqueo de cuenta** (ASVS 6.1.1): con un solo usuario, bloquear la cuenta permitiría a cualquiera dejar fuera al propietario.
- **Orden**: en `/auth/login` el límite por IP va **antes** que el global. Con el orden inverso, el global contaba también las peticiones que luego rechazaba el límite por IP, y una sola IP agotaba el cupo global con 20 peticiones en unos segundos (corregido; test: «las peticiones que rechaza el límite por IP no gastan el cupo global…»).
- **Riesgo residual del límite global** ‡: quien pueda llegar a la API puede gastar los 20 intentos de cada hora e impedir **nuevos** inicios de sesión durante esa hora.
  - Desde **una sola IP**, al ritmo máximo que permite el límite por IP (5 cada 15 min), tarda **1 h** en agotarlo; con varias IP, antes.
  - No afecta a las sesiones abiertas ni al desbloqueo, que usan otro límite.
  - **Aceptable con la opción de despliegue D** (privada, Tailscale): solo llegan los dispositivos propios. Si se pasa a la A (pública), hay que revisarlo (p. ej., límite global más alto o retardo creciente en lugar de corte).
- **IPv6**: las direcciones se agrupan por prefijo /56 (valor por defecto de `express-rate-limit` 8), porque una sola conexión suele disponer de muchas direcciones del mismo prefijo.
- **Almacén en memoria**: hay una sola instancia de la API. Al reiniciarla, los contadores por IP y el global vuelven a cero; los fallos por sesión no, porque están en la base de datos.
- Tests:
  - `apps/api/test/auth/rate-limit.test.ts` (con varias IP simuladas): sexto login desde una IP → 429; el límite por IP no gasta el cupo global; intento 21 de la hora desde IP distintas → 429; y en el segundo factor, `/unlock` y `/reauth`, tras 10 fallos desde una IP el undécimo intento **con credenciales correctas y la sesión válida** → 429, y desde otra IP se acepta.
  - `apps/api/test/auth/login.test.ts`: «5 fallos de segundo factor revocan la sesión pendiente» y «5 intentos fallidos revocan la sesión» (desbloqueo); `apps/api/test/auth/account.test.ts`: «la reautenticación exige los dos factores».

## 2. IP de la petición: `TRUST_PROXY_HOPS` (ASVS 4.1.3, 15.3.4)

Los límites por IP solo funcionan si la IP es la del cliente real y el cliente no la puede falsificar.

- **Qué es**: el número de proxies inversos **de confianza** delante de la API. Express lo usa como `trust proxy`: con `N`, confía en los `N` saltos más cercanos (la conexión TCP y las `N − 1` últimas entradas de `X-Forwarded-For`) y toma como IP del cliente la entrada siguiente hacia la izquierda. Con `1`: la última entrada, la que añadió el proxy.
- **Por defecto, `0` (desactivado)**: la IP es la de la conexión TCP y **se ignora `X-Forwarded-For`**. Es lo correcto cuando la API recibe las conexiones directamente (desarrollo).
- **Fase 2, detrás de Caddy**: `TRUST_PROXY_HOPS=1`. Sin ello, todas las peticiones parecerían venir de la IP del proxy: los límites por IP se convertirían en globales y un atacante agotaría el límite del propietario.
- **Por qué no `trust proxy = true`**: confiaría en **cualquier** valor de `X-Forwarded-For`; cualquiera podría inventarse una IP en cada petición y saltarse los límites por IP.
- **Errores de configuración**:
  - Un valor **menor** que el número real de proxies: todas las peticiones comparten la IP de un proxy (límites por IP inútiles y riesgo de denegación de servicio contra uno mismo).
  - Un valor **mayor**: el cliente puede añadir direcciones falsas a `X-Forwarded-For` y elegir su IP.
  - El proxy de confianza debe añadir la IP real al final de `X-Forwarded-For` (o sobrescribir la cabecera). Caddy, sin `trusted_proxies`, no se fía del valor que recibe [VERIFICAR en la fase 2 con la versión desplegada].
- Valor permitido: entero de 0 a 5, validado al arrancar (`apps/api/src/config/env.ts`).
- Tests: `apps/api/test/auth/proxy.test.ts` (con 0, un `X-Forwarded-For` falso no cambia la IP; con 1, se usa la que añade el proxy) y `apps/api/test/config.test.ts`.

## 3. Interfaz de escucha: `HOST`

- Por defecto, `127.0.0.1`: la API solo acepta conexiones del propio equipo. En desarrollo va por HTTP sin cifrar, así que no debe ser accesible desde la red local.
- Valores permitidos: una IPv4, una IPv6 o `localhost`, validados al arrancar. En el contenedor de la fase 2 se fija de forma explícita (la red interna de Docker exige escuchar en la interfaz del contenedor, no en su `127.0.0.1`).
- Tests: `apps/api/test/config.test.ts` («HOST: por defecto 127.0.0.1…»). Comprobado a mano el 2026-11-03: el socket queda en `127.0.0.1:3000` y una conexión a la IP de red del equipo se rechaza.

## 4. Límites de negocio de la autenticación (ASVS 2.1.3, 2.3.2)

| Elemento | Límite | Dónde se aplica |
|---|---|---|
| Cuerpo JSON | 100 KB | `express.json` (413 si se supera) |
| Nombre de usuario | 1–64 caracteres; sin distinguir mayúsculas | Zod + `CHECK` + índice único `lower(username)` |
| Contraseña nueva | 15–256 caracteres (puntos de código); se admite cualquier carácter | Política de contraseñas |
| Cualquier campo de contraseña recibido | 1.024 unidades UTF-16 como mucho, antes de calcular el hash | Zod (evita trabajo inútil de Argon2 con cuerpos enormes) |
| Código TOTP | 6 cifras | Zod |
| Código de recuperación | 40 caracteres como mucho al normalizarlo | Dominio |
| Usuarios | 1 | Índice único `ON users ((true))` |
| Sesiones completas simultáneas | 5; la sexta revoca la más antigua | Servicio |
| Sesión pendiente del segundo factor | 5 min | Reglas de sesión |
| Inactividad / vida absoluta | 1 h (bloqueo) / 24 h | Reglas de sesión |
| Ventana de reautenticación | 10 min | Reglas de sesión |
| Códigos de recuperación | 10 por usuario; regenerarlos borra los anteriores | Servicio |
| Altas de TOTP pendientes | 1 por usuario | Índice único parcial |
| `User-Agent` guardado | 512 caracteres (se recorta) | `CHECK` |

## 5. Palabras del contexto (ASVS 6.1.2, 6.2.11)

Una contraseña nueva se rechaza si contiene (sin distinguir mayúsculas, tras normalizar a NFC) alguna de estas palabras de 4 o más caracteres:

1. La lista fija `CONTEXT_WORDS` (`apps/api/src/modules/auth/index.ts`): `backoffice`, `entorno`, `trabajo`, `password` y `contraseña`.
2. El **nombre de usuario**.
3. Las etiquetas del **dominio** de `PUBLIC_ORIGIN` (p. ej., `finanzas.ejemplo.test` → `finanzas`, `ejemplo`, `test`). Se calculan al arrancar: el dominio real nunca se escribe en el repositorio.

Además se comprueba la lista local de 3.000 contraseñas comunes de 15 o más caracteres (ASVS 6.2.4) y Pwned Passwords (ASVS 6.2.12).

## 6. Funciones costosas (ASVS 15.1.3, 15.2.2)

| Función | Coste | Dónde | Defensa |
|---|---|---|---|
| Argon2id de contraseñas | 64 MiB de memoria y unos 130 ms de CPU por hash (desarrollo) | Login, desbloqueo, reautenticación, cambio de contraseña (verificar la actual + calcular la nueva), scripts | Límites de peticiones de §1; el resto exige una sesión completa. Tope de 1.024 caracteres antes del hash |
| Argon2id de códigos de recuperación | 19 MiB por hash; hasta 10 hashes por intento | Segundo factor con código de recuperación | Límite por IP y 5 fallos por sesión |
| Consulta a Pwned Passwords | Una petición HTTPS saliente, 5 s como mucho | Cambio y restablecimiento de contraseña, alta del usuario | Exige reautenticación reciente; fallo cerrado si no responde |

## 7. Índice de todos los límites (ASVS 2.1.3)

Un solo sitio para encontrarlos. «Dónde» es la fuente de verdad; si un valor cambia, se cambia allí y aquí. Los tres estados: **Hecho** (en el código y con test), **Fase 2** (diseñado, aún sin implementar) y **Sin test** (en el código, pero sin un test propio).

### 7.1 Peticiones

| Límite | Valor | Dónde | Estado |
|---|---|---|---|
| Cuerpo JSON | 100 KB → 413 | `JSON_BODY_LIMIT` en `apps/api/src/app.ts` | Hecho (`apps/api/test/app.test.ts`) |
| Cabecera `Cookie` | 8.192 caracteres; más se ignora | `apps/api/src/http/cookies.ts` | Sin test |
| Login por IP / global | 5 cada 15 min / 20 por hora → 429 | §1 | Hecho |
| Segundo factor, desbloqueo y reautenticación | 10 cada 15 min por IP, en total | §1 | Hecho |
| Fallos por sesión (segundo factor, desbloqueo, reautenticación) | 5 → se revoca la sesión | §1 | Hecho |
| Resto de la API (lectura y escritura del libro) | **Sin límite hoy.** Diseño: 300 por minuto (`plan.md` §6) | — | **Fase 2** (ASVS 2.4.1) |
| Ingesta (`/ingest/*`) | Diseño: 30 por minuto por token | — | **Fase 2** |
| Subida del Excel | Diseño: 5 MB | `plan.md` (importación) | **Fase 3** |

La API del libro está tras una sesión completa y un solo usuario, y la opción de despliegue D es privada: por eso el límite general puede esperar a la fase 2. Con la opción A (pública) habría que adelantarlo.

### 7.2 Campos (Zod en `packages/shared` y `CHECK` en la base de datos)

| Campo | Límite | Esquema | `CHECK` en la base de datos |
|---|---|---|---|
| Nombre de cuenta o categoría | 1–100 caracteres, sin espacios en los extremos | `name` | `char_length(name) BETWEEN 1 AND 100` |
| Concepto (`description`) | ≤ 500 | `optionalText(500)` | `char_length(description) <= 500` |
| Comercio (`merchant`) | ≤ 200 | `optionalText(200)` | `char_length(merchant) <= 200` |
| Nota de transferencia o conciliación | ≤ 500 | `optionalText(500)` | `char_length(note) <= 500` |
| Búsqueda `q` | 1–100 | `listMovementsQuerySchema` | — |
| Cursor de paginación | 1–200 | `pageParams` | — |
| Tamaño de página (`limit`) | 1–100; 50 por defecto | `pageParams` | — |
| Texto de un importe escrito | ≤ 64 caracteres, antes de interpretarlo | `MAX_AMOUNT_INPUT_LENGTH` (`money.ts`) | — |
| Campos de autenticación | §4 | `auth/schemas.ts` | §4 |

### 7.3 Importes

| Elemento | Límite | Dónde |
|---|---|---|
| Unidad | Céntimos, entero; nunca decimales | `*_cents` (`bigint`), `z.int()` |
| Máximo | `Number.MAX_SAFE_INTEGER` céntimos (≈ 90 billones de euros) | `money.ts` y `apps/api/src/db/cents.ts` (error si se supera al leer o escribir) |
| Movimiento confirmado y transferencia | Estrictamente positivo (> 0) | `positiveCents` y `CHECK (amount_cents > 0)` en `transfers` |
| Movimiento pendiente (borrador) | ≥ 0 | `CHECK (amount_cents >= 0)` en `movements` |
| Saldo de apertura y saldo del banco (conciliación) | Con signo (puede ser negativo) | `signedCents` |
| Moneda | Solo EUR | `CHECK (currency = 'EUR')` |

### 7.4 Fechas y rangos

| Elemento | Límite | Dónde |
|---|---|---|
| Día | `YYYY-MM-DD` válido en el calendario (`2026-02-30` se rechaza) | `localDateSchema` |
| Mes | `YYYY-MM` | `monthSchema` |
| Filtro de movimientos y transferencias | `from` ≤ `to` → 400 | `fromNotAfterTo` |
| Informes por rango | `from` ≤ `to` → 400; **máximo 60 meses → 422** | `MAX_REPORT_MONTHS` (`schemas.ts`), `reports.service.ts` |
| Informe de saldos en un día (`at`) | Obligatorio (formato `YYYY-MM-DD`) | `plan.md` §2.10 |
| Movimiento o transferencia | No puede ser anterior a la fecha de apertura de la cuenta → 422 | Servicio del libro |
| Conciliación | `asOf` dentro de su mes → 400; un solo ajuste por cuenta y mes | `createReconciliationRequestSchema` y `CHECK as_of >= month AND as_of < month + 1 mes` |

### 7.5 Cantidades

| Elemento | Límite | Dónde |
|---|---|---|
| Usuarios | 1 | Índice único `ON users ((true))` |
| Sesiones completas simultáneas | 5 (la sexta revoca la más antigua) | §4 |
| Códigos de recuperación | 10 | §4 |
| Altas de TOTP pendientes | 1 | §4 |
| Cuentas, categorías, movimientos | **Sin tope.** Un solo usuario; la paginación acota cada respuesta a 100 filas | — |
| Exportación (`GET /export`) | **Sin paginar:** devuelve el libro entero. Requiere reautenticación (S+) | `GET /export` |

El último punto es un riesgo aceptado: con miles de movimientos la respuesta pesa unos MB, no GB. Si el libro creciera mucho, se pasaría a un flujo (*streaming*) y se documentaría aquí.

### 7.6 Duraciones

| Elemento | Valor | Dónde |
|---|---|---|
| Sesión pendiente del segundo factor | 5 min | §4 |
| Inactividad (bloqueo) / vida absoluta | 1 h / 24 h | §4 |
| Ventana de reautenticación | 10 min | §4 |
| Token de dispositivo | ≤ 366 días | `CHECK` de `device_tokens` (fase 2) |
| Consulta a Pwned Passwords | 5 s | §6 |
