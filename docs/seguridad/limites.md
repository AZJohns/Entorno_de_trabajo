# Límites de negocio, límites de peticiones y funciones costosas

> ASVS 2.1.3, 6.1.1, 6.1.2 y 15.1.3. Estado de la **fase 1 (autenticación)**; las fases siguientes añaden sus límites (importación, búsqueda, ingesta). Sin datos reales.

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
