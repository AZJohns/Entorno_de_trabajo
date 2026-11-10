# Matriz de cumplimiento OWASP ASVS 5.0 — nivel 2

> Referencia de seguridad del proyecto (decisión de `docs/plan.md` §6). Este documento **no contiene datos reales**.

## Cómo leer este documento

- **Fuente:** el texto de los requisitos se ha tomado del [repositorio oficial de ASVS](https://github.com/OWASP/ASVS/tree/master/5.0/en) (carpeta `5.0/en`, consultado el 2026-11-02). Los resúmenes en español son míos: ante cualquier duda manda el texto original en inglés.
- **Alcance:** los **253 requisitos de nivel 1 y 2** (el nivel 2 incluye el 1). No se ha omitido ninguno: cada requisito está en una tabla de cumplimiento o en la lista «No aplica» de su capítulo. Un script comprobó esa cobertura al generar el documento.
- **Estado:**
  - **Planificado:** el diseño lo cumple y la fase indicada lo implementa; todavía no está verificado.
  - **Verificado (Fn):** implementado en la fase n con la evidencia indicada (test, regla de lint o documento). Al cerrar cada fase, la columna «Verificación» debe pasar a enlazar el test o la evidencia concreta.
  - **Desviación:** no se cumple al pie de la letra; la fila explica el motivo y la mitigación (ASVS permite desviaciones documentadas en varios requisitos).
  - **No aplica:** la funcionalidad no existe en este sistema; se indica el motivo.
- **‡ Sensible a la exposición:** son las filas que hay que revisar si el despliegue pasa de la opción D (privada, Tailscale) a la A (pública) (`plan.md` §7.3).
- **Fase · módulo:** F0–F6 según `plan.md` §8.
- **Cada fase implementa solo las filas que tiene asignadas.**
  - Una fila de una fase posterior no se adelanta, aunque parezca fácil: se implementa cuando llega su fase y con su test.
  - Una fila con un rango (p. ej., «F1–F2») se cumple por partes: cada fase implementa la parte que corresponde a la funcionalidad que construye (en «F1–F2 · http», las cabeceras se configuran en F1 y se comprueban sobre HTTPS real en F2). La fila solo pasa a «verificado» cuando termina la **última** fase del rango.
  - Si durante una fase aparece la necesidad de cumplir una fila de otra fase, se anota aquí y se trata en su fase, salvo que bloquee la actual. En ese caso se reasigna de forma explícita, en el mismo PR.
  - Las filas sin una fase concreta (revisiones de diseño) se comprueban al cerrar cada fase que toca el módulo indicado.
- **Mantenimiento:** cualquier cambio de diseño que afecte a una fila actualiza este documento en el mismo PR.

## Resumen

| Estado | Requisitos |
|---|---|
| Verificado (fase 0) | 9 |
| Verificado (fase 1) | 92 |
| Planificado | 75 |
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

**Fase 1 (revisión de las filas de F0):** se cierran 1.1.1, 1.2.3, 1.2.5, 1.3.7, 1.3.10, 1.5.2, 3.7.1, 14.2.3 y 15.1.2 (revisión del código del 2026-11-03, más una regla de lint nueva para 1.2.5 y la comprobación del SBOM) y 16.1.1 (inventario `logs.md`). Después de integrar el #15 se cierra también 1.4.2 (test nuevo `packages/shared/test/finance-schemas.test.ts`); 5.4.1 conserva su parte de F1 anotada y se completa en la F3; 2.3.3 se cierra en la F1 con el test de atomicidad de la conciliación (`reconciliation-atomicity.test.ts`). Ninguna fila asignada solo a F0 queda sin cerrar (las que tienen un rango, como «F0+» o «F0–F1», siguen su regla).

**Fase 1 (cierre con la exportación):** las filas de V6, V7 y V8 asignadas solo a la fase 1 están verificadas (V8: 8.1.1, 8.1.2, 8.2.1 y 8.3.1); 8.2.2 y 8.2.3 siguen «Planificado» porque su rango acaba en F2 (tokens de dispositivo). También se cierran 3.2.1 y 5.4.2 con la exportación. **Fase 1, autenticación (PR de la parte 3a):** las filas de V6 y V7 asignadas a la fase 1 están verificadas. Las filas «F1 · todos», «F1+» o con un rango que acaba después siguen «Planificado» hasta su última fase; en «Cómo se cumple» se anota la parte ya hecha. Las filas de V8 asignadas a F1 se cierran con el resto de la fase 1 (cuentas, movimientos y exportación), salvo 8.3.1, que ya no depende de ellas.

## V1 — Codificación y saneamiento

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 1.1.1 | L2 | Decodificar a forma canónica una sola vez y antes de validar | **Verificado (F1)** | Express parsea el JSON una sola vez (`express.json`, `apps/api/src/app.ts`) y Zod valida después; no hay decodificaciones manuales | F0 · http | Revisión (2026-11-03): sin `decodeURI*`, `decodeURIComponent` ni `unescape` en `apps/` ni `packages/`. Test: `apps/api/test/app.test.ts` («JSON mal formado → 400 MALFORMED_JSON») |
| 1.1.2 | L2 | Codificar la salida como último paso, para el intérprete de destino | **Verificado (F1)** | React escapa al renderizar; la API solo emite JSON serializado por Express · `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` y `document.write` prohibidos por lint en `apps/web` | F1 · web | Lint: `no-restricted-syntax` en `eslint.config.js` · Test: `apps/web/test/finance-pages.test.tsx` («una descripción con <script> se muestra como texto…») |
| 1.2.1 | L1 | Codificación de salida según el contexto (HTML, atributos, cabeceras) | **Verificado (F1)** | React; las cabeceras solo llevan valores generados por el servidor | F1 · web, http | Test: `apps/web/test/finance-pages.test.tsx` («una descripción con <script> se muestra como texto…») + lint. Las cabeceras no llevan datos del usuario (`security.test.ts`) |
| 1.2.2 | L1 | Codificar los datos al construir URLs | **Verificado (F1)** | Query strings con `URLSearchParams` (`queryString`) y segmentos de ruta con `encodeURIComponent` (`segment`, en `apps/web/src/finance/queries.ts`); el id de `useParams` lo controla quien escribe la URL | F1 · web/lib | Test: `apps/web/test/finance-pages.test.tsx` («codifica el id de la ruta del navegador…») |
| 1.2.3 | L1 | Codificar al generar JavaScript o JSON dinámico | **Verificado (F1)** | No se genera JavaScript; el JSON sale de `res.json` | F0 · http | Revisión (2026-11-03): sin JSONP, `<script>` dinámico ni `innerHTML` en `apps/`; lint: `no-eval`, `no-new-func` y `dangerouslySetInnerHTML` prohibido (`eslint.config.js`) |
| 1.2.4 | L1 | Consultas parametrizadas | Planificado | Kysely parametriza; `sql.raw` prohibido salvo justificación (regla de lint) | F0–F5 · repositorios | Lint + revisión |
| 1.2.5 | L1 | Sin inyección de comandos del sistema | **Verificado (F1)** | La app no ejecuta comandos; las copias las hace el host con argumentos fijos. Solo los scripts de desarrollo y CI (`scripts/`, `apps/api/scripts/`) usan `execFileSync` con argumentos fijos | F0 · — | Lint: `no-restricted-imports` de `child_process` en `apps/api/src`, `apps/web/src` y `packages/*/src` (`eslint.config.js`) |
| 1.2.9 | L2 | Escapar los metacaracteres al construir expresiones regulares | Planificado | La búsqueda usa la búsqueda de texto completo de PostgreSQL; si se construye alguna regex con entrada del usuario, se escapa | F5 · notes | Revisión |
| 1.3.1 | L1 | Sanitizar el HTML de editores WYSIWYG | Planificado | No hay WYSIWYG ni HTML del usuario; Markdown sin HTML crudo | F5 · notes | Test XSS |
| 1.3.2 | L1 | Sin `eval` ni ejecución dinámica de código | **Verificado (F0)** | Reglas de ESLint `no-eval` y `no-implied-eval`; CSP sin `unsafe-eval` | F0 · todos | Lint: `no-eval`, `no-new-func`, `@typescript-eslint/no-implied-eval` (`eslint.config.js`) |
| 1.3.3 | L2 | Sanitizar los datos que van a contextos peligrosos | Planificado | Nombre de archivo de la exportación generado (hecho en F1, `apps/api/test/finance/api-export.test.ts`); textos de push sin HTML (F2) | F1–F2 · finance, notifications | Revisión |
| 1.3.5 | L2 | Sanitizar o desactivar contenido de plantillas o Markdown | Planificado | react-markdown sin `rehype-raw`; solo enlaces `http`, `https` y `mailto` | F5 · notes | Test XSS (`javascript:`, `<img onerror>`) |
| 1.3.6 | L2 | Protección contra SSRF | Planificado | **Lista de hosts permitidos para los endpoints de push** (servicios de push de Apple, Google y Mozilla) al suscribirse y al enviar; solo `https`. El resto de destinos salientes es fijo | F2 · notifications | Test: suscripción con un endpoint interno → 400 |
| 1.3.7 | L2 | Sin inyección de plantillas | **Verificado (F1)** | No se construyen plantillas con entrada del usuario | F0 · — | Revisión (2026-11-03): sin motor de plantillas entre las dependencias ni `res.render`; lint: `no-eval`, `no-new-func` |
| 1.3.10 | L2 | Sanitizar las cadenas de formato | **Verificado (F1)** | Logs estructurados (pino con objetos); sin `printf` con entrada del usuario | F0 · http | Revisión (2026-11-03): los mensajes de log son literales y los datos van en el objeto (`apps/api/src/http/errors.ts`, `apps/api/src/server.ts`); test de la redacción: `apps/api/test/logger.test.ts` |
| 1.4.2 | L2 | Evitar desbordamientos de enteros | **Verificado (F1)** | Importes `bigint`; `Number.isSafeInteger` en la conversión; `z.int()` (solo enteros seguros) en los esquemas de la API | F0–F1 · shared/money | Test: `packages/shared/test/money.test.ts` («acepta el máximo entero seguro y rechaza el siguiente»), `packages/shared/test/finance-schemas.test.ts` (movimientos y transferencias) y `apps/api/test/db-cents.test.ts` (`centsFromDb` rechaza lo que excede el entero seguro) |
| 1.5.1 | L1 | Analizadores XML sin entidades externas (XXE) | Planificado | El lector OOXML no debe resolver entidades externas [VERIFICAR en el spike] | F3 · imports | Test con un XLSX que declara una entidad externa |
| 1.5.2 | L2 | Deserialización segura | **Verificado (F1)** | Solo JSON validado con Zod; no se reconstruyen tipos de objeto | F0 · http | Revisión (2026-11-03): sin `JSON.parse` de entrada ni deserializadores de objetos en `apps/api/src`; el test con `__proto__` llega con 15.3.6. El importador del Excel (F3) tiene sus propias filas |

**No aplica** (9): 1.2.6, 1.2.7, 1.2.8, 1.3.4, 1.3.8, 1.3.9, 1.3.11, 1.4.1, 1.4.3. Motivo: No hay LDAP, XPath, LaTeX, SVG subidos, JNDI, memcache ni envío de correo; el runtime gestiona la memoria y no hay código nativo propio.

## V2 — Validación y lógica de negocio

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 2.1.1 | L1 | Reglas de validación documentadas | Planificado | Los esquemas Zod de `packages/shared` + `plantilla-excel.md` | F0+ · shared | Revisión |
| 2.1.2 | L2 | Coherencia de datos combinados documentada | Planificado | Restricciones de `plan.md` §2 (confirmado = completo, categoría del mismo tipo…) | F1+ · finance | Revisión |
| 2.1.3 | L2 | Límites de negocio documentados | **Verificado (F1)** | `docs/seguridad/limites.md` §7: índice único de límites de peticiones, campos, importes, fechas, cantidades y duraciones, con su fuente de verdad. Los límites de peticiones de la API general y de la ingesta están marcados como fase 2 (2.4.1) | F1 · todos | Revisión: `docs/seguridad/limites.md` §7 |
| 2.2.1 | L1 | Validación positiva (listas permitidas, rangos) | Planificado | Zod estricto con enumeraciones, rangos y longitudes | F1+ · todos | Tests de validación |
| 2.2.2 | L1 | Validación en una capa de servicio de confianza | Planificado | El backend valida siempre, aunque el frontend use los mismos esquemas · Libro: esquemas de `packages/shared/src/finance/schemas.ts` en los controladores y reglas entre filas en `ledger.service.ts` (`apps/api/test/finance/api-movements.test.ts`, `api-transfers.test.ts`, `api-reconciliations.test.ts`) · Presupuesto: esquemas estrictos de `/budgets` y reglas entre filas en `budget.service.ts` (`api-budgets.test.ts`) · Tareas: esquemas estrictos de `packages/shared/src/tasks/schemas.ts` (sin posición ni fechas de sistema fijadas por el cliente) y reglas entre filas y con el reloj en `tasks.service.ts` y `time-entries.service.ts` (`tasks/api-tasks.test.ts`, `tasks/api-time.test.ts`) | F1+ · http | Tests de API |
| 2.2.3 | L2 | Combinaciones de datos razonables | Planificado | `CHECK` en la base de datos + reglas combinadas de Zod (origen ≠ destino, fecha ≥ apertura…) · Libro: restricciones de `0003_ledger` (`apps/api/test/finance/ledger-schema.test.ts`) y 422 por categoría de otro tipo, fecha anterior a la apertura o conciliación anterior a ella (`api-movements.test.ts`, `api-transfers.test.ts`, `api-reconciliations.test.ts`) · Presupuesto: restricciones de `0005_category_budgets` (mes en día 1, importe > 0, solo categorías de gasto, único por mes y categoría; `budget-schema.test.ts`) y 422 por categoría inexistente o de ingreso (`api-budgets.test.ts`) · Tareas: restricciones de `0006_tasks` (título, columna, posición única diferible, `completed_at` ligado a la columna, intervalo con fin posterior al inicio, un solo cronómetro y sin solapes; `tasks/tasks-schema.test.ts`) y 400/404/409/422 en `tasks/api-tasks.test.ts` y `tasks/api-time.test.ts` | F1+ · finance, tasks | Tests |
| 2.3.1 | L1 | Flujos en el orden previsto, sin saltar pasos | Planificado | Login `mfa_pending` → `full`; importación vista previa → confirmación; conciliación · **Auth hecho**: `apps/api/test/auth/login.test.ts` («la sesión pendiente no da acceso: solo permite el segundo factor») | F1, F3 · auth, imports | Tests: saltar un paso → rechazo |
| 2.3.2 | L2 | Límites de negocio implementados | Planificado | Los de 2.1.3 | F1+ · todos | Tests |
| 2.3.3 | L2 | Transacciones en la lógica de negocio | **Verificado (F1)** | Cada operación compuesta del libro (transferencias, conciliación + ajuste, borrado de la conciliación) corre en una sola transacción (`#transaction` en `ledger.service.ts`). Si falla el guardado del ajuste, la conciliación tampoco se guarda | F1 · finance | Test: `apps/api/test/finance/reconciliation-atomicity.test.ts` (fuerza un fallo en `insertMovement` y comprueba que no quedan ni la conciliación ni el ajuste, y que el mes se puede volver a conciliar) |
| 2.3.4 | L2 | Bloqueos para recursos limitados | Planificado | Bloqueo consultivo por mes al importar; cronómetro único; `SKIP LOCKED` en los recordatorios | F3, F4 | Tests de concurrencia |
| 2.4.1 ‡ | L2 | Controles contra la automatización | Planificado | Límites de peticiones (login, segundo factor, ingesta, API) · **Login y segundos factores hechos** (`apps/api/test/auth/rate-limit.test.ts`: por IP y global en el login; 429 en el segundo factor, `/unlock` y `/reauth`) | F1–F2 · http | Tests |

## V3 — Seguridad del frontend web

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 3.2.1 | L1 | Evitar renderizar en un contexto incorrecto | **Verificado (F1)** | La API responde siempre JSON con `nosniff`; la exportación con `Content-Disposition: attachment` | F1 · http | Test: `apps/api/test/security.test.ts` («HSTS de 1 año, nosniff…») y `apps/api/test/finance/api-export.test.ts` («exporta todo el libro…»: `application/json`, `attachment` y `nosniff`) |
| 3.2.2 | L1 | Mostrar texto con funciones seguras | **Verificado (F1)** | React escapa el texto; `dangerouslySetInnerHTML` prohibido por lint | F1 · web | Lint: `no-restricted-syntax` sobre `dangerouslySetInnerHTML` en `apps/web` (`eslint.config.js`) |
| 3.3.1 | L1 | Cookies `Secure` con prefijo | **Verificado (F1)** | `__Host-sid` | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («correcto: crea una sesión pendiente… con cookie segura»: `__Host-sid; Path=/; HttpOnly; Secure; SameSite=Lax`) |
| 3.3.2 | L2 | `SameSite` según el propósito | **Verificado (F1)** | `Lax`, justificado en `plan.md` §6.2 y ADR 0006 | F1 · auth | Test: `apps/api/test/auth/login.test.ts` (misma aserción que 3.3.1) |
| 3.3.3 | L2 | Prefijo `__Host-` | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/login.test.ts` (misma aserción que 3.3.1) |
| 3.3.4 | L2 | `HttpOnly` en la cookie de sesión | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/login.test.ts` (misma aserción que 3.3.1) |
| 3.4.1 ‡ | L1 | HSTS de ≥ 1 año e `includeSubDomains` | Planificado | helmet · Cabecera enviada desde F1 (test: `apps/api/test/security.test.ts`); falta comprobarla sobre HTTPS real en F2 | F1–F2 · http | Test de cabeceras |
| 3.4.2 | L1 | CORS con un origen fijo | **Verificado (F1)** | No se habilita CORS (mismo origen); no se envía `Access-Control-Allow-Origin` | F0 · http | Test: `apps/api/test/security.test.ts` (con un `Origin` de otra web no hay `Access-Control-Allow-Origin`) |
| 3.4.3 | L2 | Content-Security-Policy | Planificado | CSP estricta (helmet), sin `unsafe-inline` en los scripts · CSP de la API desde F1 (test: `apps/api/test/security.test.ts`); la de la SPA servida por Express, en F2 | F1–F2 · http | Test + consola sin errores |
| 3.4.4 | L2 | `X-Content-Type-Options: nosniff` | **Verificado (F1)** | helmet | F1 · http | Test: `apps/api/test/security.test.ts` |
| 3.4.5 | L2 | Referrer-Policy | **Verificado (F1)** | `no-referrer` | F1 · http | Test: `apps/api/test/security.test.ts` |
| 3.4.6 | L2 | CSP `frame-ancestors` | **Verificado (F1)** | `'none'` | F1 · http | Test: `apps/api/test/security.test.ts` (`frame-ancestors 'none'`) |
| 3.5.1 | L1 | Protección CSRF sin depender del preflight | **Verificado (F1)** | Token en `X-CSRF-Token` derivado del de sesión (HMAC, ADR 0006) + `Origin` igual a `PUBLIC_ORIGIN` o `Sec-Fetch-Site: same-origin`, también en el login | F1 · http | Test: `apps/api/test/auth/login.test.ts` («CSRF y origen»: sin token o con otro → 403; `Origin` de otra web o ausente → 403) |
| 3.5.2 | L1 | Si se depende del preflight, no poder evitarlo | **Verificado (F1)** | No se depende solo de él (3.5.1); además, las mutaciones exigen `Content-Type: application/json` | F1 · http | Test: `apps/api/test/auth/login.test.ts` («las peticiones con cuerpo deben ser JSON (415)») |
| 3.5.3 | L1 | Métodos HTTP adecuados para las funciones sensibles | Planificado | Ningún GET con efectos · Auth: ningún GET modifica datos (solo `GET /auth/session` y `GET /auth/sessions`, sin efectos salvo `last_seen_at`) | F1+ · todos | Revisión + test |
| 3.5.4 | L2 | Aplicaciones distintas en hosts distintos | Planificado | El backoffice tiene su propio host; el portfolio está en otro dominio (GitHub Pages) | F2 · deploy | Revisión |
| 3.5.5 | L2 | Descartar `postMessage` de origen no fiable o mal formados | Planificado | El mensaje SW → ventana (navegación desde una notificación) se valida con un esquema y por su origen | F2 · web/sw | Test unitario |
| 3.7.1 | L2 | Tecnologías de cliente soportadas | **Verificado (F1)** | Navegadores actuales; sin plugins | F0 · web | Revisión (2026-11-03): `apps/web/index.html` solo carga el módulo propio (sin `<object>`/`<embed>`); test: `apps/api/test/security.test.ts` («CSP estricta…»: `object-src 'none'`) |
| 3.7.2 | L2 | Redirigir a otros dominios solo con aviso | **Verificado (F1)** | La app no redirige a dominios externos; el parámetro `volver` de las pantallas de acceso solo admite rutas internas (`safeInternalPath`) | F0 · web | Test: `apps/web/test/session.test.ts` (rechaza `//dominio`, `https://…`, `javascript:` y `/\…`) |

## V4 — API y servicios web

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 4.1.1 | L1 | `Content-Type` correcto y con charset | **Verificado (F0)** | `application/json` y `application/problem+json` con `charset=utf-8` | F0 · http | Test: `apps/api/test/app.test.ts` (health → `application/json; charset=utf-8`; errores → `application/problem+json`) |
| 4.1.2 ‡ | L2 | Solo las rutas de usuario redirigen de HTTP a HTTPS | Planificado | En D no hay puerto 80. En A, Caddy redirige la web y responde 400 en `/api/*` por HTTP (sin redirigir) | F2 · deploy | Revisión del Caddyfile + `curl` |
| 4.1.3 ‡ | L2 | Las cabeceras de intermediarios no las puede sobrescribir el usuario | Planificado | Caddy reescribe `X-Forwarded-For`; Express `trust proxy` = `TRUST_PROXY_HOPS` (0 por defecto, 1 en F2). Con 0, `X-Forwarded-For` se ignora | F2 · http, deploy | Test: `apps/api/test/auth/proxy.test.ts` (F1) + revisión del Caddyfile (F2) |
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
| 5.4.1 | L2 | Ignorar el nombre de archivo del usuario y fijarlo en `Content-Disposition` | Planificado | El nombre del Excel solo se muestra, saneado; la exportación usa un nombre generado · **Exportación hecha (F1)**: `apps/api/test/finance/api-export.test.ts`; falta la subida del Excel (F3) | F1, F3 | Test |
| 5.4.2 | L2 | Nombres de archivo servidos y codificados (RFC 6266) | **Verificado (F1)** | Nombre ASCII generado por el servidor (`backoffice-export-AAAA-MM-DD.json`), entre comillas | F1 · export | Test: `apps/api/test/finance/api-export.test.ts` («exporta todo el libro…», expresión regular sobre `Content-Disposition`) |

**No aplica** (1): 5.4.3. Motivo: Los archivos subidos nunca se sirven ni se guardan; solo los sube el usuario autenticado y se leen en memoria sin ejecutar nada. Un antivirus no reduciría ningún riesgo real.

## V6 — Autenticación

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 6.1.1 ‡ | L1 | Límites de peticiones y defensas contra la fuerza bruta documentados, sin bloqueos maliciosos | **Verificado (F1)** | `docs/seguridad/limites.md` §1: límites por IP y global, 5 fallos por sesión, **sin bloqueo de cuenta** | F1 · auth | Documento + test: `apps/api/test/auth/rate-limit.test.ts` (todos los límites por ruta y el global) y `login.test.ts` («5 fallos de segundo factor revocan la sesión pendiente», «5 intentos fallidos revocan la sesión») |
| 6.1.2 | L2 | Lista documentada de palabras del contexto | **Verificado (F1)** | `docs/seguridad/limites.md` §5: lista fija + usuario + etiquetas del dominio de `PUBLIC_ORIGIN`, calculadas al arrancar | F1 · auth | Documento + test: `apps/api/test/auth/password-policy.test.ts` («el dominio del origen público aporta sus etiquetas…») |
| 6.1.3 | L2 | Vías de autenticación documentadas | **Verificado (F1)** | `plan.md` §6.2 | F1 · auth | Documento: `plan.md` §6.2 y `apps/api/src/modules/auth/README.md` |
| 6.2.1 | L1 | Longitud mínima (8; se recomiendan 15) | **Verificado (F1)** | 15 | F1 · auth | Test: `apps/api/test/auth/password-policy.test.ts` («exige 15 caracteres…») |
| 6.2.2 | L1 | Se puede cambiar la contraseña | **Verificado (F1)** | `POST /auth/password` | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («cambia la contraseña…») |
| 6.2.3 | L1 | El cambio exige la contraseña actual y la nueva | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («exige la contraseña actual») |
| 6.2.4 | L1 | Comprobar contra las 3.000 contraseñas más comunes | **Verificado (F1)** | Lista local de las 3.000 más frecuentes de ≥ 15 caracteres (SecLists, `docs/dependencias.md`) | F1 · auth | Test: `apps/api/test/auth/password-policy.test.ts` y `apps/api/test/auth/account.test.ts` («rechaza una contraseña %s», caso «común (lista local de 15+ caracteres)») |
| 6.2.5 | L1 | Sin reglas de composición | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/password-policy.test.ts` («acepta una contraseña larga sin reglas de composición») |
| 6.2.6 | L1 | `type=password` con la opción de verla | **Verificado (F1)** | Campos `type=password` con botón «Mostrar» (`apps/web/src/ui/forms.tsx`) | F1 · web | Revisión + prueba manual en Chromium (2026-11-03) |
| 6.2.7 | L1 | Se permite pegar y usar gestores de contraseñas | **Verificado (F1)** | `autocomplete` correcto (`current-password`, `new-password`, `one-time-code`) | F1 · web | Revisión: `autocomplete` en `apps/web/src/pages/*` y `ui/forms.tsx`; sin bloqueo de pegado |
| 6.2.8 | L1 | Verificar sin modificar (sin truncar ni cambiar mayúsculas) | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/password-policy.test.ts` («no modifica la contraseña…») y `apps/api/test/auth/login.test.ts` («…la contraseña sí y no se recorta») |
| 6.2.9 | L2 | Se admiten ≥ 64 caracteres | **Verificado (F1)** | Máximo de 256 | F1 · auth | Test: `apps/api/test/auth/password-policy.test.ts` («admite al menos 64 caracteres…») |
| 6.2.10 | L2 | Sin rotación periódica obligatoria | **Verificado (F1)** | Sí | F1 · auth | Revisión: no existe caducidad de contraseña en el código ni en el esquema |
| 6.2.11 | L2 | Usar la lista de palabras del contexto | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/password-policy.test.ts` y `apps/api/test/auth/account.test.ts` (usuario, nombre de la app y dominio rechazados) |
| 6.2.12 | L2 | Comprobar contra contraseñas filtradas | **Verificado (F1)** | API de rangos de Pwned Passwords; si falla, se rechaza el cambio | F1 · auth | Test: `apps/api/test/auth/hibp.test.ts` (k-anonimato, relleno, fallo cerrado) y `apps/api/test/auth/account.test.ts` («rechaza una contraseña filtrada», «si HIBP no responde, NO se cambia») |
| 6.3.1 ‡ | L1 | Controles contra el relleno de credenciales y la fuerza bruta | **Verificado (F1)** | Límites de peticiones en el login (por IP y global) y en el segundo factor, el desbloqueo y la reautenticación; 5 fallos por sesión | F1 · auth | Test: `apps/api/test/auth/rate-limit.test.ts` («límite global: el intento 21…», «segundo factor / desbloqueo / reautenticación: tras 10 fallos desde una IP, el undécimo intento… recibe 429») |
| 6.3.2 | L1 | Sin cuentas por defecto | **Verificado (F1)** | El usuario lo crea el script; no hay semillas de usuarios | F1 · auth | Revisión + test: `apps/api/test/auth/account.test.ts` («solo puede existir un usuario») |
| 6.3.3 | L2 | Autenticación multifactor obligatoria | **Verificado (F1)** | Contraseña + TOTP (o código de recuperación). Passkey: se evalúa en F2 | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («la sesión pendiente no da acceso…», «la sesión pendiente caduca a los 5 minutos») |
| 6.3.4 | L2 | Sin vías de autenticación no documentadas | **Verificado (F1)** | Test que enumera las rutas de autenticación registradas | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («las únicas rutas públicas son GET /health y POST /auth/login») |
| 6.4.1 | L1 | Contraseñas iniciales aleatorias y con caducidad | **Verificado (F1)** | El sistema no genera contraseñas iniciales: el usuario la introduce en el script | F1 · auth | Revisión: `apps/api/scripts/create-user.ts` |
| 6.4.2 | L1 | Sin pistas ni preguntas secretas | **Verificado (F1)** | Sí | F1 · auth | Revisión |
| 6.4.3 | L2 | Restablecer la contraseña no anula el segundo factor | **Verificado (F1)** | El script de recuperación no toca el TOTP | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («restablecer la contraseña… NO desactiva el TOTP») |
| 6.4.4 | L2 | Perder un factor exige una verificación de identidad equivalente al alta | **Verificado (F1)** | Códigos de recuperación (generados en el alta) o acceso SSH al servidor | F1 · auth | Documento: `apps/api/src/modules/auth/README.md` (operaciones de servidor) y ADR 0006 |
| 6.5.1 | L2 | TOTP y códigos de recuperación de un solo uso | **Verificado (F1)** | `last_used_step` y `used_at`, reclamados con una sentencia condicional atómica | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («un código TOTP solo vale una vez», «código de recuperación: vale una sola vez…») y `apps/api/test/auth/totp.test.ts` |
| 6.5.2 | L2 | Secretos de búsqueda < 112 bits guardados con un hash de contraseñas y sal | **Verificado (F1)** | Códigos de recuperación de 80 bits con Argon2id | F1 · auth | Revisión: `RECOVERY_CODE_ARGON2` (`crypto/password-hash.ts`) |
| 6.5.3 | L2 | Generados con un CSPRNG | **Verificado (F1)** | `crypto.randomBytes` | F1 · auth | Revisión + lint (`Math.random` prohibido en la API) |
| 6.5.4 | L2 | ≥ 20 bits de entropía | **Verificado (F1)** | 80 bits | F1 · auth | Test: `apps/api/test/auth/recovery-codes.test.ts` («10 bytes (80 bits)…») |
| 6.5.5 | L2 | TOTP con una vida máxima de 30 s | **Desviación** | Paso de 30 s; se acepta también el anterior por el desfase de reloj (RFC 6238 §5.2). **Desviación**: hasta 60 s en el peor caso; mitigada porque cada código vale una vez y los intentos están limitados | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («acepta el código del paso anterior… y rechaza el de hace dos pasos») y `totp.test.ts` |

**No aplica** (7): 6.6.1, 6.6.2, 6.6.3, 6.8.1, 6.8.2, 6.8.3, 6.8.4. Motivo: No hay autenticación fuera de banda (SMS, teléfono, push) ni proveedores de identidad federados.

## V7 — Gestión de sesiones

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 7.1.1 | L2 | Inactividad y vida máxima documentadas y justificadas frente a NIST | **Verificado (F1)** | `plan.md` §6.2: 24 h de caducidad absoluta y 1 h de inactividad, con desbloqueo de un factor tras la inactividad. Todo dentro de lo que permite NIST SP 800-63B-4 para AAL2: **sin desviaciones** | F1 · auth | Documento: `plan.md` §6.2 y ADR 0006 |
| 7.1.2 | L2 | Sesiones simultáneas documentadas | **Verificado (F1)** | Como máximo 5; se cierra la más antigua | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («como mucho 5 sesiones completas…») |
| 7.2.1 | L1 | Verificar la sesión en un backend de confianza | **Verificado (F1)** | Sesiones en PostgreSQL | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («cerrar sesión revoca la sesión…») y `apps/api/test/auth/login.test.ts` |
| 7.2.2 | L1 | Tokens dinámicos, no claves estáticas | Planificado | Token de sesión aleatorio. Los tokens del atajo no son sesiones: tienen permisos limitados, caducan y se pueden revocar · Sesiones hechas en F1 (token aleatorio, `apps/api/test/auth/account.test.ts`); tokens del atajo en F2 | F1–F2 · auth | Revisión |
| 7.2.3 | L1 | Tokens de referencia únicos y de un CSPRNG | **Verificado (F1)** | 256 bits | F1 · auth | Test: `apps/api/test/auth/crypto.test.ts` («token de sesión de 256 bits…») |
| 7.2.4 | L1 | Token nuevo al autenticar **y al reautenticar** | **Verificado (F1)** | Token nuevo al pasar a `full`, en cada reautenticación y en cada desbloqueo tras inactividad | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («TOTP correcto: token NUEVO», desbloqueo «rota el token») y `apps/api/test/auth/account.test.ts` (reautenticación) |
| 7.3.1 | L2 | Caducidad por inactividad según el análisis de riesgos | **Verificado (F1)** | 1 h. Tras ella hay que reautenticarse: contraseña o passkey + el secreto de sesión (`/auth/unlock`), como permite NIST | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («tras 1 h sin uso, la sesión se bloquea…», «desbloqueo tras inactividad…») y `session-rules.test.ts`. Cada petición con sesión renueva el plazo, así que la web **no sondea** (la campana de notificaciones se actualiza al navegar, al volver a la ventana y tras actuar): `apps/web/src/notifications/queries.ts` y su test («no sondea») |
| 7.3.2 | L2 | Vida máxima absoluta | **Verificado (F1)** | 24 h | F1 · auth | Test: `apps/api/test/auth/login.test.ts` («a las 24 h la sesión caduca aunque se use continuamente») |
| 7.4.1 | L1 | Una sesión terminada no se puede volver a usar | **Verificado (F1)** | `revoked_at` y caducidad comprobadas en cada petición | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («cerrar sesión revoca la sesión…») y `apps/api/test/auth/login.test.ts` (token anterior a la rotación → 401) |
| 7.4.2 | L1 | Deshabilitar la cuenta termina todas las sesiones | **Verificado (F1)** | El script `user:disable` marca `disabled_at` y revoca todas las sesiones. **F2**: los tokens de dispositivo se añaden a este test | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («deshabilitar la cuenta revoca las sesiones e impide el login») |
| 7.4.3 | L2 | Opción de cerrar las demás sesiones al cambiar un factor | **Verificado (F1)** | Contraseña y TOTP (`terminateOtherSessions`). Passkeys: si se adoptan en F2 | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («cambia la contraseña y, si se pide, cierra las demás sesiones», «al confirmar el TOTP nuevo se pueden cerrar las demás sesiones») |
| 7.4.4 | L2 | Botón de salir visible | **Verificado (F1)** | En todas las pantallas autenticadas | F1 · web | Revisión: `apps/web/src/pages/Layout.tsx` (cabecera de todas las pantallas internas) + prueba manual |
| 7.4.5 | L2 | El administrador puede terminar sesiones | **Verificado (F1)** | El usuario es el administrador: cierre de sesiones en Ajustes + script `user:revoke-sessions` | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («lista las sesiones abiertas y permite cerrar otra», «revocar todas las sesiones desde el servidor») |
| 7.5.1 | L2 | Reautenticación completa antes de cambiar atributos de autenticación | **Verificado (F1)** | S+ (contraseña + TOTP en los últimos 10 min; el segundo factor del login cuenta) | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («reautenticación para acciones sensibles») y `apps/api/test/auth/login.test.ts` (el desbloqueo no la concede) |
| 7.5.2 | L2 | Ver y cerrar sesiones reautenticándose | **Verificado (F1)** | Sí | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («lista las sesiones abiertas y permite cerrar otra (con reautenticación)») |
| 7.6.2 | L2 | Crear una sesión exige una acción explícita | **Verificado (F1)** | Login explícito; sin inicio de sesión automático por enlace | F1 · auth | Revisión: solo `POST /auth/login` crea sesiones |

**No aplica** (2): 7.1.3, 7.6.1. Motivo: No hay federación (SSO) ni IdP.

## V8 — Autorización

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 8.1.1 | L1 | Reglas de autorización por función y por dato documentadas | **Verificado (F1)** | Columna Auth de `plan.md` §2.10 + matriz de permisos. Un solo usuario: no hay reglas por dato distintas de «sesión activa». Las rutas de cada fase se añaden a la matriz en el mismo PR | F1 · todos | Test: `apps/api/test/api-permissions.test.ts` (la lista coincide con las rutas registradas del libro, informes, exportación, presupuesto, tareas, recordatorios y notificaciones; cada una probada sin sesión, con sesión a medias, sin CSRF y, las S+, sin reautenticación) y `apps/api/test/auth/login.test.ts` («denegar por defecto») |
| 8.1.2 | L2 | Reglas por campo documentadas | **Verificado (F1)** | Esquemas de salida explícitos: nunca `password_hash`, `token_hash` ni las semillas (la exportación se construye campo a campo). El token del atajo solo escribe los campos de la ingesta (F2) | F1 · todos | Test: `apps/api/test/finance/api-output-fields.test.ts` (ninguna respuesta lleva claves de credenciales) y `apps/api/test/finance/api-export.test.ts` («no incluye secretos ni datos de autenticación») |
| 8.2.1 | L1 | Acceso por función con permisos explícitos | **Verificado (F1)** | Denegar por defecto + niveles de acceso explícitos por ruta (`public`, `session`, `active`, `active_reauth`) (`apps/api/test/auth/login.test.ts`, «denegar por defecto»; rutas del libro, informes, exportación, presupuesto, tareas, recordatorios y notificaciones en `apps/api/test/api-permissions.test.ts`: sin sesión, con sesión a medias, sin CSRF, desde otro origen y S+ sin reautenticación → 403). Los permisos de los tokens de dispositivo se verifican en F2 con ellos | F1 · http | Test de la matriz de rutas |
| 8.2.2 | L1 | Acceso por dato (IDOR) | Planificado | Un solo usuario; el token del atajo no puede leer datos | F1–F2 · todos | Test: token → `GET /movements/:id` → 401/403 |
| 8.2.3 | L2 | Acceso por campo | Planificado | Esquemas de entrada estrictos y de salida explícitos · Libro: los ajustes de conciliación no se editan ni se borran por la API y `source`/`status` no se aceptan en las peticiones (`apps/api/test/finance/api-movements.test.ts`) | F1+ · todos | Test |
| 8.3.1 | L1 | Autorización en una capa de confianza | **Verificado (F1)** | Middleware del backend | F1 · http | Test: `apps/api/test/auth/login.test.ts` («denegar por defecto»: toda ruta sin sesión → 401) |

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
| 11.2.2 | L2 | Agilidad criptográfica | **Verificado (F1)** | Formato PHC (parámetros en el hash), `key_version` | F1 · auth | Test: `crypto.test.ts` («detecta hashes con parámetros antiguos…») y `apps/api/test/auth/account.test.ts` («rotación de la clave de cifrado del TOTP») |
| 11.2.3 | L2 | ≥ 128 bits de seguridad | **Verificado (F1)** | AES-256-GCM, SHA-256, tokens de 256 bits; TOTP con HMAC-SHA-256 y semilla de 256 bits en las altas nuevas (ver 11.4.1) | F1 · auth | Revisión: ADR 0006 |
| 11.3.1 | L1 | Sin ECB ni rellenos débiles | **Verificado (F1)** | AES-GCM | F1 · auth | Revisión: `crypto/secret-box.ts` |
| 11.3.2 | L1 | Solo cifrados aprobados (AES-GCM) | **Verificado (F1)** | Sí | F1 · auth | Revisión: `crypto/secret-box.ts` |
| 11.3.3 | L2 | Cifrado autenticado | **Verificado (F1)** | GCM | F1 · auth | Test: `crypto.test.ts` («detecta una modificación del texto cifrado o una clave incorrecta») |
| 11.4.1 | L1 | Solo funciones hash aprobadas | **Verificado (F1)** | SHA-256 y HMAC-SHA-256 en todo lo propio (tokens, CSRF) y en el TOTP de las altas nuevas: cada credencial guarda su algoritmo (`totp_authenticators.algorithm`, con `CHECK` en `SHA1`/`SHA256`, sin valor por defecto) y las altas usan SHA256 con una semilla de 32 bytes. Las credenciales anteriores a la migración 0004 quedan en SHA1 (HMAC-SHA-1 es *Legacy* en el apéndice C de ASVS 5.0, «no se considera una vulnerabilidad en sí») para no dejar al usuario sin acceso; desaparecen al cambiar el TOTP en Seguridad. Las apps solo aplican `algorithm=SHA256` al escanear el QR del `otpauth://`: con la clave escrita a mano, Google Authenticator usa SHA-1, y por eso la web y `user:create` muestran el QR (generado en local) con ese aviso. El SHA-1 de la consulta a Pwned Passwords no protege nada: lo impone el protocolo de rangos y no se guarda | F1 · auth | Tests: `apps/api/test/auth/totp.test.ts` (vectores SHA-1 y SHA-256 del apéndice B de RFC 6238; una credencial SHA1 antigua sigue verificándose; un código del algoritmo equivocado se rechaza), `apps/api/test/auth/account.test.ts` (alta SHA256 con semilla de 32 bytes; el alta no se confirma con un código SHA-1; una credencial SHA1 sigue iniciando sesión) y `apps/api/test/auth/totp-migration.test.ts` (filas anteriores → SHA1, `CHECK`, sin valor por defecto). Comprobación manual del propietario: Google Authenticator para iOS calcula bien SHA-256 al añadir la cuenta escaneando un QR con `algorithm=SHA256` (con una clave desechable). Apéndice C de ASVS 5.0 (`5.0/en/0x92-Appendix-C_Cryptography.md`, consultado el 2026-11-03: HMAC-SHA-1 = L) |
| 11.4.2 | L2 | Contraseñas con una función costosa de derivación | **Verificado (F1)** | Argon2id 64 MiB, t = 3, p = 4 (RFC 9106), por encima del mínimo de OWASP | F1 · auth | Test: `crypto.test.ts` («Argon2id (formato PHC)») + revisión de `PASSWORD_ARGON2` |
| 11.4.3 | L2 | Hashes resistentes a colisiones para la integridad | Planificado | SHA-256 (`content_hash`, `file_sha256`) | F3 · imports | Revisión |
| 11.4.4 | L2 | KDF con estiramiento al derivar claves de contraseñas | Planificado | La app no deriva claves de contraseñas; restic sí, con su KDF | F2 · copias | Revisión |
| 11.5.1 | L2 | CSPRNG para todo valor no adivinable | **Verificado (F0)** | `crypto.randomBytes` y `randomUUID`; `Math.random` prohibido en la API (lint) | F0 · todos | Lint: `no-restricted-properties` prohíbe `Math.random` en `apps/api/src` (`eslint.config.js`) |
| 11.6.1 | L2 | Algoritmos aprobados para generar claves y firmar | Planificado | VAPID (ECDSA P-256); WebAuthn mediante una librería | F2 · notifications, auth | Revisión |

## V12 — Comunicación segura

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 12.1.1 ‡ | L1 | Solo TLS 1.2 y 1.3 | Planificado | Configuración por defecto de Caddy | F2 · deploy | Prueba externa de TLS |
| 12.1.2 ‡ | L2 | Solo suites de cifrado recomendadas | Planificado | Configuración por defecto de Caddy | F2 · deploy | Prueba externa de TLS |
| 12.2.1 ‡ | L1 | TLS en todo lo externo, sin alternativa insegura | Planificado | Solo HTTPS + HSTS. **En desarrollo** (HTTP sin cifrar), la API escucha solo en `127.0.0.1` (`HOST`, valor por defecto validado al arrancar): no es accesible desde la red local | F2 · deploy | Revisión · F1: `apps/api/test/config.test.ts` («HOST: por defecto 127.0.0.1…») y comprobación manual del socket (`docs/seguridad/limites.md` §3) |
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
| 14.1.1 | L2 | Datos sensibles identificados y clasificados | **Verificado (F1)** | `docs/seguridad/datos.md` §1–2: cuatro niveles (N3 secreto a N0 público) y clasificación de credenciales, datos financieros, sesiones, auditoría, logs, configuración, copias y exportación | F1 | Revisión: `docs/seguridad/datos.md` |
| 14.1.2 | L2 | Requisitos de protección por nivel | **Verificado (F1)** | `docs/seguridad/datos.md` §3: cifrado, almacenamiento, logs, exportación, acceso, retención, minimización y rotación por nivel; §4 lista lo que depende de la fase 2 | F1 | Revisión: `docs/seguridad/datos.md` |
| 14.2.1 | L1 | Datos sensibles solo en el cuerpo o en cabeceras, nunca en la URL | Planificado | Tokens en cabeceras. La búsqueda `q` va en la URL: los logs de Caddy y de pino **no registran la query string** | F1–F2 · http, deploy | Test (redacción) + revisión |
| 14.2.2 | L2 | Sin caché de datos sensibles en componentes del servidor | Planificado | `Cache-Control: no-store`; Caddy sin caché · `no-store` en `/api` desde F1 (test: `apps/api/test/security.test.ts`) | F1–F2 | Test |
| 14.2.3 | L2 | Sin envío de datos a terceros (rastreadores) | **Verificado (F1)** | Sin analíticas ni CDN de terceros; la CSP lo impone. Única llamada a un tercero: la API consulta los rangos de HIBP al fijar la contraseña (solo 5 caracteres del SHA-1, *k-anonymity*) | F0 · web | Revisión (2026-11-03): sin URL externas en `apps/web/src`; test: `apps/api/test/security.test.ts` («CSP estricta…»: `default-src`, `script-src` y `connect-src 'self'`) |
| 14.2.4 | L2 | Controles por nivel de protección implementados | Planificado | Según 14.1.2 | F1+ | Revisión |
| 14.3.1 | L1 | Limpiar los datos del cliente al terminar la sesión | Planificado | `Clear-Site-Data` + vaciado de la caché de TanStack Query; el SW no cachea `/api` · F1: `Clear-Site-Data` (test: `apps/api/test/auth/account.test.ts`) y caché de consultas vaciada al salir (`forgetSession`, prueba manual) | F1–F2 · web | Test e2e |
| 14.3.2 | L2 | `Cache-Control: no-store` | **Verificado (F1)** | En todo `/api` | F1 · http | Test: `apps/api/test/security.test.ts` y `apps/api/test/auth/login.test.ts` |
| 14.3.3 | L2 | Sin datos sensibles en el almacenamiento del navegador | Planificado | Solo preferencias de interfaz en `localStorage` · El token CSRF solo se guarda en memoria (`apps/web/src/api/client.ts`) | F1+ · web | Revisión |

## V15 — Codificación y arquitectura seguras

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 15.1.1 | L1 | Plazos de corrección de dependencias documentados | **Verificado (F0)** | 7, 30 y 90 días (`plan.md` §6.2) | F0 | Documento: `docs/dependencias.md` (plazos 7/30/90 días) |
| 15.1.2 | L2 | Inventario de dependencias (SBOM) | **Verificado (F1)** | Exportación del *dependency graph* de GitHub (SPDX) con `gh api repos/{owner}/{repo}/dependency-graph/sbom` ([`docs/runbooks/github.md`](../runbooks/github.md) §3) | F0 | Comprobado el 2026-11-03: devuelve SPDX-2.3 con 458 paquetes |
| 15.1.3 | L2 | Funciones costosas documentadas | Planificado | Importación del Excel, búsqueda e informes, en `docs/seguridad/limites.md` · Auth hecho: `docs/seguridad/limites.md` §6 | F1–F3 | Revisión |
| 15.2.1 | L1 | Componentes dentro de los plazos | Planificado | Dependabot + revisión mensual | F0+ | Revisión |
| 15.2.2 | L2 | Defensas contra la pérdida de disponibilidad en funciones costosas | Planificado | Límites de tamaño, de peticiones y `statement_timeout` en PostgreSQL. **Expresiones regulares sin retroceso polinómico (ReDoS)**: el análisis de importes (`parseEuroAmount`, que procesa datos del atajo y del Excel) limita la entrada a 64 caracteres antes de procesarla y quita el prefijo y el sufijo de moneda con operaciones lineales. La regex anterior era cuadrática: 40.000 espacios costaban unos 2,8 s de CPU (alerta #1 de CodeQL, `js/polynomial-redos`). CodeQL vigila nuevas regex en cada PR | F1–F3 | Test: `packages/shared/test/money.test.ts` («una cadena enorme de espacios falla rápido y por el motivo correcto»: 1.000.000 de espacios → `too_long` en < 50 ms); resto, en F1–F3 |
| 15.2.3 | L2 | En producción, solo lo necesario | Planificado | Imagen sin `devDependencies` ni herramientas de test | F2 · deploy | Revisión |
| 15.3.1 | L1 | Devolver solo los campos necesarios | Planificado | Esquemas de salida (DTO) | F1+ · todos | Test |
| 15.3.2 | L2 | No seguir redirecciones en las llamadas salientes | Planificado | `fetch(…, { redirect: "error" })` en HIBP; web-push [VERIFICAR] · HIBP hecho (`infra/hibp.ts`) | F1–F2 | Revisión |
| 15.3.3 | L2 | Protección contra la asignación masiva | Planificado | Zod estricto (rechaza los campos desconocidos) · Auth: `apps/api/test/auth/login.test.ts` («campos desconocidos: 400») · Libro: `apps/api/test/finance/api-movements.test.ts` («origen forzado», «estado forzado») | F1+ · todos | Test |
| 15.3.4 ‡ | L2 | IP original correcta tras el proxy | Planificado | `TRUST_PROXY_HOPS` (0 por defecto; 1 detrás de Caddy en F2). Nunca `trust proxy = true` | F2 · http | Test: `apps/api/test/auth/proxy.test.ts` (F1); configuración real en F2 |
| 15.3.5 | L2 | Tipos estrictos e igualdad estricta | **Verificado (F0)** | TypeScript estricto + `eqeqeq` | F0 · todos | TypeScript `strict` + lint `eqeqeq` |
| 15.3.6 | L2 | Sin contaminación de prototipos | Planificado | `Map` u `Object.create(null)` para las claves que vienen del usuario; Zod descarta `__proto__` | F1+ · todos | Test con `__proto__` |
| 15.3.7 | L2 | Sin contaminación de parámetros HTTP | **Verificado (F1)** | Zod espera cadenas: un parámetro repetido llega como array y se rechaza con 400 `VALIDATION_ERROR`; ninguno de los valores se elige en silencio | F1 · http | Test: `apps/api/test/finance/api-reports.test.ts` («rechaza un parámetro repetido…») |

## V16 — Registro de seguridad y gestión de errores

| ID | Nivel | Requisito (resumen) | Estado | Cómo se cumple | Fase · módulo | Verificación |
|---|---|---|---|---|---|---|
| 16.1.1 | L2 | Inventario de logs | **Verificado (F1)** | `docs/seguridad/logs.md`: destinos, log de peticiones y eventos de `audit_events` · Los destinos de producción se cierran en la F2 (16.2.3) | F1 | [`docs/seguridad/logs.md`](logs.md) §1–§3; tests citados en §3 (`apps/api/test/auth/account.test.ts`, `apps/api/test/security.test.ts`, `apps/api/test/finance/api-export.test.ts`) |
| 16.2.1 | L2 | Metadatos: cuándo, dónde, quién y qué | **Verificado (F1)** | pino + `requestId` + `audit_events` | F1 · http | Documento: `docs/seguridad/logs.md` + test: `apps/api/test/auth/account.test.ts` («registra los eventos de autenticación…») |
| 16.2.2 | L2 | Relojes sincronizados y marcas de tiempo en UTC | Planificado | NTP en el host; ISO 8601 en UTC | F2 · deploy | Revisión |
| 16.2.3 | L2 | Solo los destinos de log documentados | Planificado | stdout → logs de Docker → copia diaria | F2 | Revisión |
| 16.2.4 | L2 | Formato común y legible por máquina | **Verificado (F0)** | JSON | F0 · http | Test: `apps/api/test/logger.test.ts` (salida JSON analizada línea a línea) |
| 16.2.5 | L2 | Registro según el nivel de protección del dato | **Verificado (F1)** | `redact` en pino; nunca se registran cuerpos de petición ni de respuesta | F0–F1 · http | Test: `apps/api/test/logger.test.ts` (redacción), `apps/api/test/auth/account.test.ts` («ni los logs ni la auditoría contienen contraseñas, códigos ni tokens») y `apps/api/test/security.test.ts` |
| 16.3.1 | L2 | Todas las operaciones de autenticación | **Verificado (F1)** | `audit_events` (login, segundo factor, reautenticación y recuperación) | F1 · auth | Test: `apps/api/test/auth/account.test.ts` («registra los eventos de autenticación, con éxito y con fallo») |
| 16.3.2 | L2 | Autorizaciones fallidas | **Verificado (F1)** | Rechazos de autenticación y autorización registrados como aviso con su código (`docs/seguridad/logs.md` §2) | F1 · http | Test: `apps/api/test/security.test.ts` («sin sesión: se registra el código como aviso») |
| 16.3.3 | L2 | Eventos de seguridad e intentos de saltarse los controles | **Verificado (F1)** | Fallos de validación y de CSRF registrados con su código, sin el cuerpo | F1 · http | Test: `apps/api/test/security.test.ts` (CSRF y validación: código y nombres de campo, sin valores) |
| 16.3.4 | L2 | Errores inesperados y fallos de los controles | **Verificado (F0)** | El gestor de errores registra la traza solo en el servidor | F0 · http | Test: `apps/api/test/app.test.ts` («un error inesperado … queda registrado») |
| 16.4.1 | L2 | Codificación contra la inyección en logs | **Verificado (F0)** | JSON escapa los saltos de línea | F0 · http | Test: `apps/api/test/logger.test.ts` (pino serializa en JSON y escapa los saltos de línea) |
| 16.4.2 | L2 | Logs protegidos y no modificables | Planificado | `audit_events`: el rol de la app solo tiene `INSERT` y `SELECT`; copias de solo añadir · F1: trigger de solo inserción (test: `apps/api/test/auth/account.test.ts`, «la auditoría es de solo inserción…»); roles separados en F2 | F1–F2 | Test de permisos de la base de datos |
| 16.4.3 | L2 | Logs enviados a un sistema separado | **Desviación** | Copia diaria al almacén de solo añadir, fuera del servidor. **Desviación**: sin SIEM ni alertas en tiempo real; riesgo aceptado | F2 | Revisión |
| 16.5.1 | L2 | Mensaje genérico ante errores inesperados | **Verificado (F0)** | RFC 9457 con un 500 genérico y `requestId` | F0 · http | Test: `apps/api/test/app.test.ts` (500 genérico sin detalles internos, con `requestId`) |
| 16.5.2 | L2 | Funcionamiento seguro cuando falla un recurso externo | Planificado | Un fallo del push no afecta a la ingesta; si HIBP falla, se rechaza el cambio de contraseña · HIBP hecho (test: `apps/api/test/auth/account.test.ts`, «si HIBP no responde, NO se cambia») | F1–F2 | Test |
| 16.5.3 | L2 | Fallar de forma segura (sin *fail-open*) | **Verificado (F1)** | Transacciones; los errores del middleware de autenticación devuelven 401/500 y nunca dejan pasar | F0–F1 · http | Test: `apps/api/test/app.test.ts` (500 genérico), `apps/api/test/auth/account.test.ts` (rotación de la clave TOTP: fallo cerrado) y `apps/api/test/auth/login.test.ts` (denegar por defecto) |

## V17 — WebRTC

**No aplica** (7): 17.1.1, 17.2.1, 17.2.2, 17.2.3, 17.2.4, 17.3.1, 17.3.2. Motivo: No hay WebRTC.

## Documentos de apoyo que crean las fases

| Documento | Requisitos | Fase |
|---|---|---|
| `docs/seguridad/limites.md`: límites de negocio, funciones costosas y lista de palabras del contexto | 2.1.3, 6.1.2, 15.1.3 | F1 (creado; §7 reúne todos los límites del libro y la autenticación) |
| `docs/seguridad/datos.md`: clasificación de los datos y protección por nivel | 14.1.1, 14.1.2 | F1 (creado) |
| `docs/seguridad/logs.md`: inventario de los eventos y sus destinos | 16.1.1, 16.2.3 | F1 (creado; parte de autenticación) |
| `docs/seguridad/criptografia.md`: inventario y ciclo de vida de las claves | 11.1.1, 11.1.2 | F1–F2 |
| `docs/seguridad/comunicaciones.md`: destinos salientes permitidos | 13.1.1, 13.2.4 | F2 |
