# Matriz de cumplimiento OWASP ASVS 5.0 — nivel 2

> Referencia de seguridad del proyecto (decisión de `docs/plan.md` §6). Este documento **no contiene datos reales**.

## Cómo leer este documento

- **Fuente:** el texto de los requisitos se ha tomado del [repositorio oficial de ASVS](https://github.com/OWASP/ASVS/tree/master/5.0/en) (carpeta `5.0/en`, consultado el 2026-11-02). Los resúmenes en español son míos: ante cualquier duda manda el texto original en inglés.
- **Alcance:** los **253 requisitos de nivel 1 y 2** (el nivel 2 incluye el 1). No se ha omitido ninguno: cada requisito está en una tabla de cumplimiento o en la lista «No aplica» de su capítulo. Un script comprobó esa cobertura al generar el documento.
- **Estado:**
  - **Planificado:** el diseño lo cumple y la fase indicada lo implementa. Todavía no hay código, así que **ninguna fila está verificada**. Al cerrar cada fase, la columna «Verificación» debe pasar a enlazar el test o la evidencia concreta.
  - **Desviación:** no se cumple al pie de la letra; la fila explica el motivo y la mitigación (ASVS permite desviaciones documentadas en varios requisitos).
  - **No aplica:** la funcionalidad no existe en este sistema; se indica el motivo.
- **‡ Sensible a la exposición:** son las filas que hay que revisar si el despliegue pasa de la opción D (privada, Tailscale) a la A (pública) (`plan.md` §7.3).
- **Fase · módulo:** F0–F6 según `plan.md` §8.
- **Mantenimiento:** cualquier cambio de diseño que afecte a una fila actualiza este documento en el mismo PR.

## Resumen

| Estado | Requisitos |
|---|---|
| Planificado | 176 |
| Desviación documentada | 7 |
| No aplica | 70 |
| **Total L1 + L2** | **253** |

**Desviaciones documentadas:**

- **6.5.5**: TOTP con una vida máxima de 30 s.
- **12.3.1**: TLS en todas las conexiones entrantes y salientes, también internas y de monitorización.
- **12.3.3**: TLS entre servicios HTTP internos.
- **12.3.4**: Certificados de confianza en los servicios internos.
- **13.2.1**: Componentes autenticados sin credenciales fijas.
- **13.3.1**: Gestor de secretos (*vault*).
- **16.4.3**: Logs enviados a un sistema separado.

## V1 — Codificación y saneamiento

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 1.1.1 | L2 | Decodificar a forma canónica una sola vez y antes de validar | Planificado | Express parsea el JSON una sola vez; Zod valida después; no hay decodificaciones manuales | F0 · http | Revisión |
| 1.1.2 | L2 | Codificar la salida como último paso, para el intérprete de destino | Planificado | React escapa al renderizar; la API solo emite JSON serializado por Express | F1 · web | Revisión |
| 1.2.1 | L1 | Codificación de salida según el contexto (HTML, atributos, cabeceras) | Planificado | React; las cabeceras solo llevan valores generados por el servidor | F1 · web, http | Test XSS (F5) + revisión |
| 1.2.2 | L1 | Codificar los datos al construir URLs | Planificado | El cliente de la API usa `URL` y `encodeURIComponent`; nunca concatena | F1 · web/lib | Revisión |
| 1.2.3 | L1 | Codificar al generar JavaScript o JSON dinámico | Planificado | No se genera JavaScript; el JSON sale de `res.json` | F0 · http | Revisión |
| 1.2.4 | L1 | Consultas parametrizadas | Planificado | Kysely parametriza; `sql.raw` prohibido salvo justificación (regla de lint) | F0–F5 · repositorios | Lint + revisión |
| 1.2.5 | L1 | Sin inyección de comandos del sistema | Planificado | La app no ejecuta comandos; las copias las hace el host con argumentos fijos | F0 · — | Revisión |
| 1.2.9 | L2 | Escapar los metacaracteres al construir expresiones regulares | Planificado | La búsqueda usa la búsqueda de texto completo de PostgreSQL; si se construye alguna regex con entrada del usuario, se escapa | F5 · notes | Revisión |
| 1.3.1 | L1 | Sanitizar el HTML de editores WYSIWYG | Planificado | No hay WYSIWYG ni HTML del usuario; Markdown sin HTML crudo | F5 · notes | Test XSS |
| 1.3.2 | L1 | Sin `eval` ni ejecución dinámica de código | Planificado | Reglas de ESLint `no-eval` y `no-implied-eval`; CSP sin `unsafe-eval` | F0 · todos | Lint + cabeceras |
| 1.3.3 | L2 | Sanitizar los datos que van a contextos peligrosos | Planificado | Nombre de archivo de la exportación generado; textos de push sin HTML | F1–F2 · finance, notifications | Revisión |
| 1.3.5 | L2 | Sanitizar o desactivar contenido de plantillas o Markdown | Planificado | react-markdown sin `rehype-raw`; solo enlaces `http`, `https` y `mailto` | F5 · notes | Test XSS (`javascript:`, `<img onerror>`) |
| 1.3.6 | L2 | Protección contra SSRF | Planificado | **Lista de hosts permitidos para los endpoints de push** (servicios de push de Apple, Google y Mozilla) al suscribirse y al enviar; solo `https`. El resto de destinos salientes es fijo | F2 · notifications | Test: suscripción con un endpoint interno → 400 |
| 1.3.7 | L2 | Sin inyección de plantillas | Planificado | No se construyen plantillas con entrada del usuario | F0 · — | Revisión |
| 1.3.10 | L2 | Sanitizar las cadenas de formato | Planificado | Logs estructurados (pino con objetos); sin `printf` con entrada del usuario | F0 · http | Revisión |
| 1.4.2 | L2 | Evitar desbordamientos de enteros | Planificado | Importes `bigint`; `Number.isSafeInteger` en la conversión; límites en Zod | F0–F1 · shared/money | Test |
| 1.5.1 | L1 | Analizadores XML sin entidades externas (XXE) | Planificado | El lector OOXML no debe resolver entidades externas [VERIFICAR en el spike] | F3 · imports | Test con un XLSX que declara una entidad externa |
| 1.5.2 | L2 | Deserialización segura | Planificado | Solo JSON validado con Zod; no se reconstruyen tipos de objeto | F0 · http | Revisión |

**No aplica** (9): 1.2.6, 1.2.7, 1.2.8, 1.3.4, 1.3.8, 1.3.9, 1.3.11, 1.4.1, 1.4.3. Motivo: No hay LDAP, XPath, LaTeX, SVG subidos, JNDI, memcache ni envío de correo; el runtime gestiona la memoria y no hay código nativo propio.

## V2 — Validación y lógica de negocio

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 2.1.1 | L1 | Reglas de validación documentadas | Planificado | Los esquemas Zod de `packages/shared` + `plantilla-excel.md` | F0+ · shared | Revisión |
| 2.1.2 | L2 | Coherencia de datos combinados documentada | Planificado | Restricciones de `plan.md` §2 (confirmado = completo, categoría del mismo tipo…) | F1+ · finance | Revisión |
| 2.1.3 | L2 | Límites de negocio documentados | Planificado | `docs/seguridad/limites.md`: tamaños, longitudes, número de sesiones y límites de peticiones | F1 · todos | Revisión |
| 2.2.1 | L1 | Validación positiva (listas permitidas, rangos) | Planificado | Zod estricto con enumeraciones, rangos y longitudes | F1+ · todos | Tests de validación |
| 2.2.2 | L1 | Validación en una capa de servicio de confianza | Planificado | El backend valida siempre, aunque el frontend use los mismos esquemas | F1+ · http | Tests de API |
| 2.2.3 | L2 | Combinaciones de datos razonables | Planificado | `CHECK` en la base de datos + reglas combinadas de Zod (origen ≠ destino, fecha ≥ apertura…) | F1+ · finance | Tests |
| 2.3.1 | L1 | Flujos en el orden previsto, sin saltar pasos | Planificado | Login `mfa_pending` → `full`; importación vista previa → confirmación; conciliación | F1, F3 · auth, imports | Tests: saltar un paso → rechazo |
| 2.3.2 | L2 | Límites de negocio implementados | Planificado | Los de 2.1.3 | F1+ · todos | Tests |
| 2.3.3 | L2 | Transacciones en la lógica de negocio | Planificado | Confirmar una importación, conciliar + ajuste, reordenar tareas | F1, F3, F4 | Tests |
| 2.3.4 | L2 | Bloqueos para recursos limitados | Planificado | Bloqueo consultivo por mes al importar; cronómetro único; `SKIP LOCKED` en los recordatorios | F3, F4 | Tests de concurrencia |
| 2.4.1 ‡ | L2 | Controles contra la automatización | Planificado | Límites de peticiones (login, segundo factor, ingesta, API) | F1–F2 · http | Tests |

## V3 — Seguridad del frontend web

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 3.2.1 | L1 | Evitar renderizar en un contexto incorrecto | Planificado | La API responde siempre JSON con `nosniff`; la exportación con `Content-Disposition: attachment` | F1 · http | Test de cabeceras |
| 3.2.2 | L1 | Mostrar texto con funciones seguras | Planificado | React; `react/no-danger` en ESLint | F1 · web | Lint |
| 3.3.1 | L1 | Cookies `Secure` con prefijo | Planificado | `__Host-sid` | F1 · auth | Test |
| 3.3.2 | L2 | `SameSite` según el propósito | Planificado | `Lax`, justificado en `plan.md` §6.2 | F1 · auth | Test |
| 3.3.3 | L2 | Prefijo `__Host-` | Planificado | Sí | F1 · auth | Test |
| 3.3.4 | L2 | `HttpOnly` en la cookie de sesión | Planificado | Sí | F1 · auth | Test |
| 3.4.1 ‡ | L1 | HSTS de ≥ 1 año e `includeSubDomains` | Planificado | helmet | F1–F2 · http | Test de cabeceras |
| 3.4.2 | L1 | CORS con un origen fijo | Planificado | No se habilita CORS (mismo origen); no se envía `Access-Control-Allow-Origin` | F0 · http | Test |
| 3.4.3 | L2 | Content-Security-Policy | Planificado | CSP estricta (helmet), sin `unsafe-inline` en los scripts | F1–F2 · http | Test + consola sin errores |
| 3.4.4 | L2 | `X-Content-Type-Options: nosniff` | Planificado | helmet | F1 · http | Test |
| 3.4.5 | L2 | Referrer-Policy | Planificado | `no-referrer` | F1 · http | Test |
| 3.4.6 | L2 | CSP `frame-ancestors` | Planificado | `'none'` | F1 · http | Test |
| 3.5.1 | L1 | Protección CSRF sin depender del preflight | Planificado | Token sincronizado en `X-CSRF-Token` + comprobación de `Origin`/`Sec-Fetch-Site` | F1 · http | Test: sin token → 403 |
| 3.5.2 | L1 | Si se depende del preflight, no poder evitarlo | Planificado | No se depende solo de él (3.5.1); además, las mutaciones exigen `Content-Type: application/json` | F1 · http | Test |
| 3.5.3 | L1 | Métodos HTTP adecuados para las funciones sensibles | Planificado | Ningún GET con efectos | F1+ · todos | Revisión + test |
| 3.5.4 | L2 | Aplicaciones distintas en hosts distintos | Planificado | El backoffice tiene su propio host; el portfolio está en otro dominio (GitHub Pages) | F2 · deploy | Revisión |
| 3.5.5 | L2 | Descartar `postMessage` de origen no fiable o mal formados | Planificado | El mensaje SW → ventana (navegación desde una notificación) se valida con un esquema y por su origen | F2 · web/sw | Test unitario |
| 3.7.1 | L2 | Tecnologías de cliente soportadas | Planificado | Navegadores actuales; sin plugins | F0 · web | Revisión |
| 3.7.2 | L2 | Redirigir a otros dominios solo con aviso | Planificado | La app no redirige a dominios externos | F0 · web | Revisión |

## V4 — API y servicios web

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 4.1.1 | L1 | `Content-Type` correcto y con charset | Planificado | `application/json` y `application/problem+json` con `charset=utf-8` | F0 · http | Test |
| 4.1.2 ‡ | L2 | Solo las rutas de usuario redirigen de HTTP a HTTPS | Planificado | En D no hay puerto 80. En A, Caddy redirige la web y responde 400 en `/api/*` por HTTP (sin redirigir) | F2 · deploy | Revisión del Caddyfile + `curl` |
| 4.1.3 ‡ | L2 | Las cabeceras de intermediarios no las puede sobrescribir el usuario | Planificado | Caddy reescribe `X-Forwarded-For`; Express `trust proxy` = 1 (solo el proxy local) | F2 · http, deploy | Test |
| 4.2.1 ‡ | L2 | Límites de mensaje HTTP coherentes (*request smuggling*) | Planificado | Caddy y Node actualizados, con la configuración por defecto; sin balanceadores intermedios | F2 · deploy | Revisión |

**No aplica** (6): 4.3.1, 4.3.2, 4.4.1, 4.4.2, 4.4.3, 4.4.4. Motivo: No hay GraphQL ni WebSockets.

## V5 — Gestión de archivos

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 5.1.1 | L2 | Tipos, extensiones y tamaños (descomprimido incluido) documentados | Planificado | `plantilla-excel.md` §2 | F3 · imports | Revisión |
| 5.2.1 | L1 | Tamaño de archivo procesable | Planificado | 5 MB en el parser | F3 · imports | Test |
| 5.2.2 | L1 | La extensión coincide con el contenido | Planificado | Extensión + bytes iniciales + estructura OOXML | F3 · imports | Test |
| 5.2.3 | L2 | Comprimidos: tamaño descomprimido y número de entradas antes de descomprimir | Planificado | Límites del ZIP | F3 · imports | Test con un *zip bomb* sintético |
| 5.3.1 | L1 | Los archivos subidos no se ejecutan desde una carpeta pública | Planificado | Nunca se escriben en disco | F3 · imports | Revisión |
| 5.3.2 | L1 | Rutas de archivo con datos internos | Planificado | No se usan nombres del usuario en rutas | F3 · imports | Revisión |
| 5.4.1 | L2 | Ignorar el nombre de archivo del usuario y fijarlo en `Content-Disposition` | Planificado | El nombre del Excel solo se muestra, saneado; la exportación usa un nombre generado | F1, F3 | Test |
| 5.4.2 | L2 | Nombres de archivo servidos y codificados (RFC 6266) | Planificado | Nombre ASCII generado | F1 · export | Test |

**No aplica** (1): 5.4.3. Motivo: Los archivos subidos nunca se sirven ni se guardan; solo los sube el usuario autenticado y se leen en memoria sin ejecutar nada. Un antivirus no reduciría ningún riesgo real.

## V6 — Autenticación

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 6.1.1 ‡ | L1 | Límites de peticiones y defensas contra la fuerza bruta documentados, sin bloqueos maliciosos | Planificado | `plan.md` §6.2 (sin bloqueo de cuenta) | F1 · auth | Revisión + tests |
| 6.1.2 | L2 | Lista documentada de palabras del contexto | Planificado | `docs/seguridad/limites.md`; el usuario y el dominio se añaden en tiempo de ejecución (no se escriben en el repositorio) | F1 · auth | Revisión |
| 6.1.3 | L2 | Vías de autenticación documentadas | Planificado | `plan.md` §6.2 | F1 · auth | Revisión |
| 6.2.1 | L1 | Longitud mínima (8; se recomiendan 15) | Planificado | 15 | F1 · auth | Test |
| 6.2.2 | L1 | Se puede cambiar la contraseña | Planificado | `POST /auth/password` | F1 · auth | Test |
| 6.2.3 | L1 | El cambio exige la contraseña actual y la nueva | Planificado | Sí | F1 · auth | Test |
| 6.2.4 | L1 | Comprobar contra las 3.000 contraseñas más comunes | Planificado | Lista local | F1 · auth | Test |
| 6.2.5 | L1 | Sin reglas de composición | Planificado | Sí | F1 · auth | Test |
| 6.2.6 | L1 | `type=password` con la opción de verla | Planificado | Formulario web | F1 · web | Revisión |
| 6.2.7 | L1 | Se permite pegar y usar gestores de contraseñas | Planificado | `autocomplete` correcto (`current-password`, `new-password`, `one-time-code`) | F1 · web | Revisión |
| 6.2.8 | L1 | Verificar sin modificar (sin truncar ni cambiar mayúsculas) | Planificado | Sí | F1 · auth | Test (espacios conservados) |
| 6.2.9 | L2 | Se admiten ≥ 64 caracteres | Planificado | Máximo de 256 | F1 · auth | Test |
| 6.2.10 | L2 | Sin rotación periódica obligatoria | Planificado | Sí | F1 · auth | Revisión |
| 6.2.11 | L2 | Usar la lista de palabras del contexto | Planificado | Sí | F1 · auth | Test |
| 6.2.12 | L2 | Comprobar contra contraseñas filtradas | Planificado | API de rangos de Pwned Passwords; si falla, se rechaza el cambio | F1 · auth | Test con un doble |
| 6.3.1 ‡ | L1 | Controles contra el relleno de credenciales y la fuerza bruta | Planificado | Límites de peticiones en el login y en el segundo factor | F1 · auth | Tests |
| 6.3.2 | L1 | Sin cuentas por defecto | Planificado | El usuario lo crea el script; no hay semillas de usuarios | F1 · auth | Revisión |
| 6.3.3 | L2 | Autenticación multifactor obligatoria | Planificado | Contraseña + TOTP (o passkey, si se adopta) | F1 · auth | Test: sin segundo factor → sin sesión completa |
| 6.3.4 | L2 | Sin vías de autenticación no documentadas | Planificado | Test que enumera las rutas de autenticación registradas | F1 · auth | Test |
| 6.4.1 | L1 | Contraseñas iniciales aleatorias y con caducidad | Planificado | El sistema no genera contraseñas iniciales: el usuario la introduce en el script | F1 · auth | Revisión |
| 6.4.2 | L1 | Sin pistas ni preguntas secretas | Planificado | Sí | F1 · auth | Revisión |
| 6.4.3 | L2 | Restablecer la contraseña no anula el segundo factor | Planificado | El script de recuperación no toca el TOTP | F1 · auth | Test del servicio |
| 6.4.4 | L2 | Perder un factor exige una verificación de identidad equivalente al alta | Planificado | Códigos de recuperación (generados en el alta) o acceso SSH al servidor | F1 · auth | Revisión |
| 6.5.1 | L2 | TOTP y códigos de recuperación de un solo uso | Planificado | `last_used_step` y `used_at` | F1 · auth | Test |
| 6.5.2 | L2 | Secretos de búsqueda < 112 bits guardados con un hash de contraseñas y sal | Planificado | Códigos de recuperación de 80 bits con Argon2id | F1 · auth | Revisión |
| 6.5.3 | L2 | Generados con un CSPRNG | Planificado | `crypto.randomBytes` | F1 · auth | Revisión |
| 6.5.4 | L2 | ≥ 20 bits de entropía | Planificado | 80 bits | F1 · auth | Revisión |
| 6.5.5 | L2 | TOTP con una vida máxima de 30 s | **Desviación** | Paso de 30 s; se acepta también el anterior por el desfase de reloj (RFC 6238 §5.2). **Desviación**: hasta 60 s en el peor caso; mitigada porque cada código vale una vez y los intentos están limitados | F1 · auth | Test |

**No aplica** (7): 6.6.1, 6.6.2, 6.6.3, 6.8.1, 6.8.2, 6.8.3, 6.8.4. Motivo: No hay autenticación fuera de banda (SMS, teléfono, push) ni proveedores de identidad federados.

## V7 — Gestión de sesiones

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 7.1.1 | L2 | Inactividad y vida máxima documentadas y justificadas frente a NIST | Planificado | `plan.md` §6.2 (24 h / 1 h y la desviación posible si fallan T18 y T19) | F1 · auth | Revisión |
| 7.1.2 | L2 | Sesiones simultáneas documentadas | Planificado | Como máximo 5; se cierra la más antigua | F1 · auth | Test |
| 7.2.1 | L1 | Verificar la sesión en un backend de confianza | Planificado | Sesiones en PostgreSQL | F1 · auth | Test |
| 7.2.2 | L1 | Tokens dinámicos, no claves estáticas | Planificado | Token de sesión aleatorio. Los tokens del atajo no son sesiones: tienen permisos limitados, caducan y se pueden revocar | F1–F2 · auth | Revisión |
| 7.2.3 | L1 | Tokens de referencia únicos y de un CSPRNG | Planificado | 256 bits | F1 · auth | Revisión |
| 7.2.4 | L1 | Token nuevo al autenticar **y al reautenticar** | Planificado | Token nuevo al pasar a `full` y en cada reautenticación | F1 · auth | Test |
| 7.3.1 | L2 | Caducidad por inactividad según el análisis de riesgos | Planificado | 1 h | F1 · auth | Test con un reloj simulado |
| 7.3.2 | L2 | Vida máxima absoluta | Planificado | 24 h | F1 · auth | Test con un reloj simulado |
| 7.4.1 | L1 | Una sesión terminada no se puede volver a usar | Planificado | `revoked_at` y caducidad comprobadas en cada petición | F1 · auth | Test |
| 7.4.2 | L1 | Deshabilitar la cuenta termina todas las sesiones | Planificado | El script de deshabilitar revoca todas las sesiones y los tokens | F1 · auth | Test del servicio |
| 7.4.3 | L2 | Opción de cerrar las demás sesiones al cambiar un factor | Planificado | Contraseña, TOTP y passkeys | F1 · auth | Test |
| 7.4.4 | L2 | Botón de salir visible | Planificado | En todas las pantallas autenticadas | F1 · web | Revisión |
| 7.4.5 | L2 | El administrador puede terminar sesiones | Planificado | El usuario es el administrador: «Cerrar todas» + script | F1 · auth | Test |
| 7.5.1 | L2 | Reautenticación completa antes de cambiar atributos de autenticación | Planificado | S+ (contraseña + TOTP, o passkey) | F1 · auth | Test |
| 7.5.2 | L2 | Ver y cerrar sesiones reautenticándose | Planificado | Sí | F1 · auth | Test |
| 7.6.2 | L2 | Crear una sesión exige una acción explícita | Planificado | Login explícito; sin inicio de sesión automático por enlace | F1 · auth | Revisión |

**No aplica** (2): 7.1.3, 7.6.1. Motivo: No hay federación (SSO) ni IdP.

## V8 — Autorización

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 8.1.1 | L1 | Reglas de autorización por función y por dato documentadas | Planificado | Columna Auth de `plan.md` §2.10 + matriz de permisos | F1 · todos | Revisión |
| 8.1.2 | L2 | Reglas por campo documentadas | Planificado | Esquemas de salida: nunca `password_hash`, `token_hash` ni las semillas; el token del atajo solo escribe los campos de la ingesta | F1 · todos | Revisión |
| 8.2.1 | L1 | Acceso por función con permisos explícitos | Planificado | Denegar por defecto + permisos de los tokens | F1 · http | Test de la matriz de rutas |
| 8.2.2 | L1 | Acceso por dato (IDOR) | Planificado | Un solo usuario; el token del atajo no puede leer datos | F1–F2 · todos | Test: token → `GET /movements/:id` → 401/403 |
| 8.2.3 | L2 | Acceso por campo | Planificado | Esquemas de entrada estrictos y de salida explícitos | F1+ · todos | Test |
| 8.3.1 | L1 | Autorización en una capa de confianza | Planificado | Middleware del backend | F1 · http | Test |

**No aplica** (1): 8.4.1. Motivo: No es multiinquilino.

## V9 — Tokens autocontenidos

**No aplica** (7): 9.1.1, 9.1.2, 9.1.3, 9.2.1, 9.2.2, 9.2.3, 9.2.4. Motivo: No se usan tokens autocontenidos (JWT): las sesiones y los tokens del atajo son tokens de referencia comprobados en la base de datos.

## V10 — OAuth y OIDC

**No aplica** (29): 10.1.1, 10.1.2, 10.2.1, 10.2.2, 10.3.1, 10.3.2, 10.3.3, 10.3.4, 10.4.1, 10.4.2, 10.4.3, 10.4.4, 10.4.5, 10.4.6, 10.4.7, 10.4.8, 10.4.9, 10.4.10, 10.4.11, 10.5.1, 10.5.2, 10.5.3, 10.5.4, 10.5.5, 10.6.1, 10.6.2, 10.7.1, 10.7.2, 10.7.3. Motivo: No hay OAuth ni OIDC. La fase 6 usa un *fine-grained token* de GitHub (no un flujo OAuth); si eso cambia, se reevalúa.

## V11 — Criptografía

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 11.1.1 | L2 | Política de gestión de claves y su ciclo de vida | Planificado | `docs/seguridad/criptografia.md`: clave de cifrado del TOTP (rotación con `key_version`), VAPID, restic y TLS (automático) | F1–F2 | Revisión |
| 11.1.2 | L2 | Inventario criptográfico | Planificado | El mismo documento | F1–F2 | Revisión |
| 11.2.1 | L2 | Implementaciones validadas | Planificado | `node:crypto` (OpenSSL), Caddy (Go) y restic | F1–F2 | Revisión |
| 11.2.2 | L2 | Agilidad criptográfica | Planificado | Formato PHC (parámetros en el hash), `key_version` | F1 · auth | Revisión |
| 11.2.3 | L2 | ≥ 128 bits de seguridad | Planificado | AES-256-GCM, SHA-256, tokens de 256 bits; TOTP con HMAC-SHA1 de 160 bits de semilla (ver 11.4.1) | F1 · auth | Revisión |
| 11.3.1 | L1 | Sin ECB ni rellenos débiles | Planificado | AES-GCM | F1 · auth | Revisión |
| 11.3.2 | L1 | Solo cifrados aprobados (AES-GCM) | Planificado | Sí | F1 · auth | Revisión |
| 11.3.3 | L2 | Cifrado autenticado | Planificado | GCM | F1 · auth | Revisión |
| 11.4.1 | L1 | Solo funciones hash aprobadas | Planificado | SHA-256. El TOTP usa HMAC-SHA1 por compatibilidad con las apps de autenticación (RFC 6238); NIST admite SHA-1 dentro de HMAC [VERIFICAR] | F1 · auth | Revisión |
| 11.4.2 | L2 | Contraseñas con una función costosa de derivación | Planificado | Argon2id, con parámetros iguales o superiores a los de OWASP | F1 · auth | Test |
| 11.4.3 | L2 | Hashes resistentes a colisiones para la integridad | Planificado | SHA-256 (`content_hash`, `file_sha256`) | F3 · imports | Revisión |
| 11.4.4 | L2 | KDF con estiramiento al derivar claves de contraseñas | Planificado | La app no deriva claves de contraseñas; restic sí, con su KDF | F2 · copias | Revisión |
| 11.5.1 | L2 | CSPRNG para todo valor no adivinable | Planificado | `crypto.randomBytes` y `randomUUID`; `Math.random` prohibido en la API (lint) | F0 · todos | Lint |
| 11.6.1 | L2 | Algoritmos aprobados para generar claves y firmar | Planificado | VAPID (ECDSA P-256); WebAuthn mediante una librería | F2 · notifications, auth | Revisión |

## V12 — Comunicación segura

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 12.1.1 ‡ | L1 | Solo TLS 1.2 y 1.3 | Planificado | Configuración por defecto de Caddy | F2 · deploy | Prueba externa de TLS |
| 12.1.2 ‡ | L2 | Solo suites de cifrado recomendadas | Planificado | Configuración por defecto de Caddy | F2 · deploy | Prueba externa de TLS |
| 12.2.1 ‡ | L1 | TLS en todo lo externo, sin alternativa insegura | Planificado | Solo HTTPS + HSTS | F2 · deploy | Revisión |
| 12.2.2 | L1 | Certificados de confianza pública | Planificado | Let's Encrypt (DNS-01 también en la opción D) | F2 · deploy | Revisión |
| 12.3.1 | L2 | TLS en todas las conexiones entrantes y salientes, también internas y de monitorización | **Desviación** | Salientes (push, HIBP, copias): HTTPS. App ↔ PostgreSQL y Caddy ↔ Express: **sin TLS dentro del mismo host** (red interna de Docker). **Desviación**: el tráfico no sale del host; si un atacante ya puede leerlo, el host está comprometido | F2 · deploy | Revisión |
| 12.3.2 | L2 | Los clientes TLS validan los certificados | Planificado | Configuración por defecto de Node; prohibido `rejectUnauthorized: false` (lint/revisión) | F2 · todos | Revisión |
| 12.3.3 | L2 | TLS entre servicios HTTP internos | **Desviación** | Igual que 12.3.1 (desviación) | F2 · deploy | Revisión |
| 12.3.4 | L2 | Certificados de confianza en los servicios internos | **Desviación** | No aplica mientras no haya TLS interno (ver 12.3.1) | F2 · deploy | Revisión |

**No aplica** (1): 12.1.3. Motivo: No hay mTLS.

## V13 — Configuración

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 13.1.1 | L2 | Comunicaciones necesarias documentadas | Planificado | `docs/seguridad/`: servicios de push, HIBP, DNS (ACME), almacén de copias, Tailscale y monitorización | F2 | Revisión |
| 13.2.1 | L2 | Componentes autenticados sin credenciales fijas | **Desviación** | PostgreSQL con contraseña. **Desviación**: red interna, rol de mínimo privilegio y rotación documentada | F2 · deploy | Revisión |
| 13.2.2 | L2 | Mínimo privilegio entre componentes | Planificado | Rol de la base de datos sin superusuario; contenedor sin `root`; las credenciales de copias solo en el host | F2 · deploy | Revisión |
| 13.2.3 | L2 | Sin credenciales por defecto | Planificado | Contraseña de PostgreSQL generada; nunca `postgres/postgres` en producción | F2 · deploy | Revisión |
| 13.2.4 | L2 | Lista de destinos salientes permitidos | Planificado | En la app: los hosts de push y HIBP. Opcional: cortafuegos de salida en el host | F2 · notifications, auth | Test (push) |
| 13.2.5 | L2 | Lista de recursos que el servidor puede cargar | Planificado | El de 13.2.4; CSP `connect-src 'self'` | F2 · http | Revisión |
| 13.3.1 | L2 | Gestor de secretos (*vault*) | **Desviación** | Archivo `600` + gestor de contraseñas. **Desviación** justificada en `plan.md` §6.2 | F2 · deploy | Revisión |
| 13.3.2 | L2 | Acceso a secretos con mínimo privilegio | Planificado | Cada secreto solo donde se usa (las copias, fuera de la app) | F2 · deploy | Revisión |
| 13.4.1 ‡ | L1 | Sin metadatos del control de versiones en el despliegue | Planificado | `.dockerignore` excluye `.git` | F2 · deploy | Test: `GET /.git/HEAD` → 404 |
| 13.4.2 ‡ | L2 | Modos de depuración desactivados | Planificado | `NODE_ENV=production`; sin trazas en las respuestas | F2 · http | Test |
| 13.4.3 ‡ | L2 | Sin listados de directorios | Planificado | `express.static` sin listado; Caddy sin `browse` | F2 · http, deploy | Test |
| 13.4.4 ‡ | L2 | Sin el método TRACE | Planificado | Express no lo implementa; Caddy lo bloquea | F2 · deploy | Test |
| 13.4.5 ‡ | L2 | Sin documentación ni monitorización expuestas | Planificado | `/health` mínimo; sin Swagger en producción | F2 · http | Test |

## V14 — Protección de datos

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 14.1.1 | L2 | Datos sensibles identificados y clasificados | Planificado | `docs/seguridad/datos.md`: credenciales (hashes, semillas, tokens), datos financieros, notas y metadatos | F1 | Revisión |
| 14.1.2 | L2 | Requisitos de protección por nivel | Planificado | El mismo documento | F1 | Revisión |
| 14.2.1 | L1 | Datos sensibles solo en el cuerpo o en cabeceras, nunca en la URL | Planificado | Tokens en cabeceras. La búsqueda `q` va en la URL: los logs de Caddy y de pino **no registran la query string** | F1–F2 · http, deploy | Test (redacción) + revisión |
| 14.2.2 | L2 | Sin caché de datos sensibles en componentes del servidor | Planificado | `Cache-Control: no-store`; Caddy sin caché | F1–F2 | Test |
| 14.2.3 | L2 | Sin envío de datos a terceros (rastreadores) | Planificado | Sin analíticas ni CDN de terceros; la CSP lo impone | F0 · web | Revisión |
| 14.2.4 | L2 | Controles por nivel de protección implementados | Planificado | Según 14.1.2 | F1+ | Revisión |
| 14.3.1 | L1 | Limpiar los datos del cliente al terminar la sesión | Planificado | `Clear-Site-Data` + vaciado de la caché de TanStack Query; el SW no cachea `/api` | F1–F2 · web | Test e2e |
| 14.3.2 | L2 | `Cache-Control: no-store` | Planificado | En todo `/api` | F1 · http | Test |
| 14.3.3 | L2 | Sin datos sensibles en el almacenamiento del navegador | Planificado | Solo preferencias de interfaz en `localStorage` | F1+ · web | Revisión |

## V15 — Codificación y arquitectura seguras

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 15.1.1 | L1 | Plazos de corrección de dependencias documentados | Planificado | 7, 30 y 90 días (`plan.md` §6.2) | F0 | Revisión |
| 15.1.2 | L2 | Inventario de dependencias (SBOM) | Planificado | Exportación del *dependency graph* de GitHub (SPDX) | F0 | Revisión |
| 15.1.3 | L2 | Funciones costosas documentadas | Planificado | Importación del Excel, búsqueda e informes, en `docs/seguridad/limites.md` | F1–F3 | Revisión |
| 15.2.1 | L1 | Componentes dentro de los plazos | Planificado | Dependabot + revisión mensual | F0+ | Revisión |
| 15.2.2 | L2 | Defensas contra la pérdida de disponibilidad en funciones costosas | Planificado | Límites de tamaño, de peticiones y `statement_timeout` en PostgreSQL | F1–F3 | Test |
| 15.2.3 | L2 | En producción, solo lo necesario | Planificado | Imagen sin `devDependencies` ni herramientas de test | F2 · deploy | Revisión |
| 15.3.1 | L1 | Devolver solo los campos necesarios | Planificado | Esquemas de salida (DTO) | F1+ · todos | Test |
| 15.3.2 | L2 | No seguir redirecciones en las llamadas salientes | Planificado | `fetch(…, { redirect: "error" })` en HIBP; web-push [VERIFICAR] | F1–F2 | Revisión |
| 15.3.3 | L2 | Protección contra la asignación masiva | Planificado | Zod estricto (rechaza los campos desconocidos) | F1+ · todos | Test |
| 15.3.4 ‡ | L2 | IP original correcta tras el proxy | Planificado | `trust proxy` = 1 | F2 · http | Test |
| 15.3.5 | L2 | Tipos estrictos e igualdad estricta | Planificado | TypeScript estricto + `eqeqeq` | F0 · todos | Lint |
| 15.3.6 | L2 | Sin contaminación de prototipos | Planificado | `Map` u `Object.create(null)` para las claves que vienen del usuario; Zod descarta `__proto__` | F1+ · todos | Test con `__proto__` |
| 15.3.7 | L2 | Sin contaminación de parámetros HTTP | Planificado | Zod espera cadenas: los parámetros repetidos (arrays) se rechazan | F1 · http | Test |

## V16 — Registro de seguridad y gestión de errores

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 16.1.1 | L2 | Inventario de logs | Planificado | `docs/seguridad/logs.md` | F1 | Revisión |
| 16.2.1 | L2 | Metadatos: cuándo, dónde, quién y qué | Planificado | pino + `requestId` + `audit_events` | F1 · http | Revisión |
| 16.2.2 | L2 | Relojes sincronizados y marcas de tiempo en UTC | Planificado | NTP en el host; ISO 8601 en UTC | F2 · deploy | Revisión |
| 16.2.3 | L2 | Solo los destinos de log documentados | Planificado | stdout → logs de Docker → copia diaria | F2 | Revisión |
| 16.2.4 | L2 | Formato común y legible por máquina | Planificado | JSON | F0 · http | Revisión |
| 16.2.5 | L2 | Registro según el nivel de protección del dato | Planificado | `redact` en pino; sin cuerpos con datos financieros | F0–F1 · http | Test de redacción |
| 16.3.1 | L2 | Todas las operaciones de autenticación | Planificado | `audit_events` (login, segundo factor, reautenticación y recuperación) | F1 · auth | Test |
| 16.3.2 | L2 | Autorizaciones fallidas | Planificado | `authz.denied` | F1 · http | Test |
| 16.3.3 | L2 | Eventos de seguridad e intentos de saltarse los controles | Planificado | Fallos de validación y de CSRF registrados con su código, sin el cuerpo | F1 · http | Test |
| 16.3.4 | L2 | Errores inesperados y fallos de los controles | Planificado | El gestor de errores registra la traza solo en el servidor | F0 · http | Test |
| 16.4.1 | L2 | Codificación contra la inyección en logs | Planificado | JSON escapa los saltos de línea | F0 · http | Revisión |
| 16.4.2 | L2 | Logs protegidos y no modificables | Planificado | `audit_events`: el rol de la app solo tiene `INSERT` y `SELECT`; copias de solo añadir | F1–F2 | Test de permisos de la base de datos |
| 16.4.3 | L2 | Logs enviados a un sistema separado | **Desviación** | Copia diaria al almacén de solo añadir, fuera del servidor. **Desviación**: sin SIEM ni alertas en tiempo real; riesgo aceptado | F2 | Revisión |
| 16.5.1 | L2 | Mensaje genérico ante errores inesperados | Planificado | RFC 9457 con un 500 genérico y `requestId` | F0 · http | Test |
| 16.5.2 | L2 | Funcionamiento seguro cuando falla un recurso externo | Planificado | Un fallo del push no afecta a la ingesta; si HIBP falla, se rechaza el cambio de contraseña | F1–F2 | Test |
| 16.5.3 | L2 | Fallar de forma segura (sin *fail-open*) | Planificado | Transacciones; los errores del middleware de autenticación devuelven 401/500 y nunca dejan pasar | F0–F1 · http | Test |

## V17 — WebRTC

**No aplica** (7): 17.1.1, 17.2.1, 17.2.2, 17.2.3, 17.2.4, 17.3.1, 17.3.2. Motivo: No hay WebRTC.

## Documentos de apoyo que crean las fases

| Documento | Requisitos | Fase |
|---|---|---|
| `docs/seguridad/limites.md`: límites de negocio, funciones costosas y lista de palabras del contexto | 2.1.3, 6.1.2, 15.1.3 | F1 |
| `docs/seguridad/datos.md`: clasificación de los datos y protección por nivel | 14.1.1, 14.1.2 | F1 |
| `docs/seguridad/logs.md`: inventario de los eventos y sus destinos | 16.1.1, 16.2.3 | F1 |
| `docs/seguridad/criptografia.md`: inventario y ciclo de vida de las claves | 11.1.1, 11.1.2 | F1–F2 |
| `docs/seguridad/comunicaciones.md`: destinos salientes permitidos | 13.1.1, 13.2.4 | F2 |
