# Registro de dependencias

Cada dependencia directa tiene que estar aquí con su justificación. **Antes de añadir una**:
1. Comprueba si Node, el navegador o PostgreSQL ya lo resuelven en menos de unas 50 líneas que se puedan probar.
2. Añade la fila: para qué sirve, qué alternativa había y por qué se descartó, licencia y estado de mantenimiento.
3. Si la dependencia necesita ejecutar scripts de instalación, justifícalo aquí antes de añadirla a `onlyBuiltDependencies` (`pnpm-workspace.yaml`).

**Política de actualización** (ASVS 15.1.1): vulnerabilidades críticas en 7 días, altas en 30, medias en 90; resto con la revisión mensual. Dependabot propone los PR con 3 días de espera (`cooldown`), en línea con `minimumReleaseAge` de pnpm.

«Mantenimiento» indica la versión instalada y su fecha de publicación según el registro de npm, consultado el **2026-11-02** (las filas de la fase 1, el **2026-11-03**). Hay que revisarlo en cada actualización mayor.

## Producción

| Paquete | Versión (fecha) | Dónde | Para qué | Alternativa descartada | Licencia |
|---|---|---|---|---|---|
| `express` | 5.3.0 (2026-10-09) | api | Servidor HTTP y enrutado. La v5 propaga los errores de las funciones `async` | Fastify, NestJS (ADR 0002) | MIT |
| `zod` | 4.6.7 (2026-10-12) | api, shared | Validación con esquemas compartidos entre la web y la API; tipos inferidos | Valibot (más ligero, menos ecosistema), validación a mano | MIT |
| `kysely` | 0.29.7 (2026-10-17) | api | Consultas SQL tipadas y migrador | Prisma, Drizzle 1.0 RC, TypeORM (ADR 0003) | MIT |
| `pg` | 8.23.1 (2026-09-30) | api | Driver de PostgreSQL que usa Kysely | `postgres` (porsager): Kysely tiene dialecto oficial para `pg` | MIT |
| `pino` | 10.4.0 (2026-10-02) | api | Logs JSON estructurados con redacción de campos sensibles (ASVS 16) | `console` (sin estructura ni redacción), winston (más lento y sin redacción por rutas) | MIT |
| `pino-http` | 11.0.0 (2025-10-04; paquete actualizado en 2026-08) | api | Log por petición con `requestId` generado por el servidor | Middleware propio: duplicaría la integración con pino | MIT |
| `react`, `react-dom` | 19.3.1 (2026-10-14) | web | Interfaz de usuario | — (decisión del stack) | MIT |
| `helmet` | 8.3.0 (2026-07-12) | api | Cabeceras de seguridad (CSP, HSTS, `nosniff`, `Referrer-Policy`, `frame-ancestors`), ASVS 3.4. Sin dependencias | Fijar las cabeceras a mano: unas 30 líneas, pero helmet mantiene los valores por defecto al día y elimina cabeceras obsoletas (`X-XSS-Protection`). La `Permissions-Policy` sí es propia (helmet 8 no la envía) | MIT |
| `express-rate-limit` | 8.7.2 (2026-10-29) | api | Límites de peticiones del login y los segundos factores (ASVS 6.3.1, 2.4.1), con cabeceras `RateLimit` estándar y agrupación de IPv6 por prefijo. Trae `ip-address` 10.7.5 (MIT) y `debug` 4.4.3 (MIT) | Contador propio en memoria: fácil de escribir, pero las ventanas, IPv6 y las cabeceras son donde suelen estar los errores. `rate-limiter-flexible`: más potente (Redis, PostgreSQL), innecesario con una instancia | MIT |
| `react-router` | 7.18.5 (2026-10-27) | web | Rutas de la SPA (modo de datos: `createBrowserRouter`), redirecciones entre pantallas de acceso. Trae `cookie` y `set-cookie-parser` (MIT), que solo usa el modo servidor y no entran en el paquete del navegador | TanStack Router (tipado de rutas más estricto, pero menos conocido); enrutado propio con `history` (reinventar los casos límite) | MIT |
| `@tanstack/react-query` | 5.105.0 (2026-10-26) | web | Caché de las consultas a la API, reintentos y reacción común a los errores de sesión; al salir se vacía (ASVS 14.3.1). Trae `@tanstack/query-core` (MIT) | `fetch` + `useEffect`: sin caché ni invalidación coherentes; SWR (menos control sobre mutaciones) | MIT |
| `qrcode-generator` | 2.0.4 (2025-08-07, consultado el 2026-11-09) | shared (la usan web y api) | Codifica el `otpauth://` del TOTP como QR **en local**, sin servicios externos: la semilla no sale del equipo. Se usa solo la matriz de módulos (`qrMatrix`); la web la dibuja como SVG y `user:create` como bloques Unicode en la terminal. Google Authenticator solo aplica `algorithm=SHA256` al escanear un QR (ASVS 11.4.1, pregunta 36). Sin dependencias, 56 KB sin minificar | Escribir el codificador: Node y el navegador no traen ninguno, y un QR exige códigos Reed-Solomon, máscaras y tablas de versiones (cientos de líneas, no «unas 50» probables). `qrcode` (más popular, pero trae `dijkstrajs`, `pngjs` y `yargs` para Node), `qr-code-styling` y los servicios web que devuelven una imagen (descartados por enviar la semilla a un tercero) | MIT |
| `marked` | 18.1.2 (2026-10-26, consultado el 2026-11-10) | web | Analizador de Markdown de la vista previa de las notas. Se usa **solo `marked.lexer`** (tokens); el renderizado a elementos de React es propio (`apps/web/src/notes/markdown.tsx`). Sin dependencias; ver la comparación más abajo | `react-markdown` + `remark-rehype` (75 paquetes nuevos), `markdown-to-jsx`, `marked` con `parse()` + sanear el HTML | MIT |

## Desarrollo

| Paquete | Versión (fecha) | Dónde | Para qué | Alternativa descartada | Licencia |
|---|---|---|---|---|---|
| `typescript` | 6.0.3 (2026-04-16) | todos | Comprobación de tipos (`tsc --noEmit`). **No se usa la 7.x**: `typescript-eslint` 8.72 solo admite TypeScript `< 6.1` | TypeScript 7 (reescritura nativa), cuando `typescript-eslint` la soporte | Apache-2.0 |
| `eslint`, `@eslint/js` | 10.13.0 (2026-10-16), 10.0.1 | raíz, api | Lint; la API lo usa también para probar la regla de fronteras entre módulos con `RuleTester` | Biome: más rápido, pero sin reglas con información de tipos equivalentes | MIT |
| `typescript-eslint` | 8.72.1 (2026-10-26) | raíz | Reglas con tipos (`no-floating-promises`, `no-base-to-string`…) | — | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 (2026-04-17) | raíz | Reglas de los hooks de React | — | MIT |
| `eslint-config-prettier` | 10.1.8 (2025-07-18) | raíz | Desactiva las reglas de estilo que chocan con Prettier. Paquete pequeño y estable: pocas versiones nuevas es lo esperable | Ajustar las reglas a mano | MIT |
| `globals` | 17.13.0 (2026-10-01) | raíz | Variables globales de Node y del navegador para ESLint | Declararlas a mano | MIT |
| `prettier` | 3.9.10 (2026-10-10) | raíz | Formato automático (no se aplica al Markdown; ver `.prettierignore`) | Biome | MIT |
| `vitest` | 5.0.5 (2026-10-15) | api, shared, web | Tests; comparte configuración con Vite y ejecuta TypeScript directamente | Jest (exige transformar TypeScript), `node:test` (menos ergonomía para *mocks* y *matchers*) | MIT |
| `supertest` | 7.3.1 (2026-10-02) | api | Peticiones HTTP a la app de Express sin abrir puertos | `fetch` contra un servidor arrancado en el test | MIT |
| `jsdom` | 30.1.3 (2026-10-15) | web | Entorno DOM de los tests de componentes (formularios de importe y conciliación, pantallas con la API simulada). Se activa por archivo con `// @vitest-environment jsdom`; los tests de lógica siguen en Node | `happy-dom` (más rápido, pero con diferencias en eventos y formularios que dan falsos verdes); probar con Playwright en un navegador real (mucho más lento y pesado para la CI) | MIT |
| `@testing-library/react`, `@testing-library/dom` | 16.3.3 (2026-08-27), 10.4.2 (2026-09-13) | web | Renderizar componentes y consultarlos como los percibe el usuario (por etiqueta, rol y texto), lo que además comprueba la accesibilidad básica. `dom` es dependencia par de `react` | `react-dom/test-utils` + consultas manuales con `querySelector`: no comprueba etiquetas ni roles | MIT |
| `@testing-library/user-event` | 14.6.8 (2026-10-13) | web | Teclear, elegir opciones y pulsar teclas (Escape, foco) como lo haría una persona; `fireEvent` no simula el foco ni la secuencia de eventos del teclado | `fireEvent` de Testing Library | MIT |
| `vite` | 8.3.5 (2026-10-21) | web | Servidor de desarrollo y empaquetado | — (decisión del stack) | MIT |
| `@vitejs/plugin-react` | 6.1.2 (2026-10-05) | web | Soporte de React (JSX, recarga en caliente) en Vite | — | MIT |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 (2026-07-16) | web | Estilos con utilidades; la v4 se configura en CSS | CSS propio | MIT |
| `@types/node` (^24), `@types/express`, `@types/pg`, `@types/supertest`, `@types/react`, `@types/react-dom` | 24.19.2, 5.0.6, 8.23.1, 7.2.1, 19.3.0, 19.3.0 | varios | Tipos de TypeScript. **`@types/node` sigue a la versión mínima de Node soportada (24, por `engines` y `.nvmrc`)**: con los tipos de una versión posterior, TypeScript aceptaría APIs que no existen en Node 24 y el fallo aparecería al ejecutar. Dependabot ignora sus actualizaciones major (`.github/dependabot.yml`); se suben a mano a la vez que el mínimo de `engines`, con su ADR | — | MIT |

## Overrides (versiones forzadas de dependencias transitivas)

Un override fuerza la versión de una dependencia que no instalamos directamente. Cada uno tiene que llevar el motivo y un criterio para retirarlo, aquí y en un comentario en `pnpm-workspace.yaml`.

| Paquete | Override | Motivo | Ámbito | Retirar cuando | Licencia |
|---|---|---|---|---|---|
| `minimatch` | `^11.0.1` (instalada: 11.0.3) | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), gravedad **moderada**: denegación de servicio por amplificación de patrones glob, en versiones < 11.0.1. `eslint` 10.14 (vía `@eslint/config-array`) y `@typescript-eslint/typescript-estree` 8.72 declaran `^10.x`, así que Dependabot no puede actualizarla (la última instalable sería la 10.2.6) | Solo **desarrollo** (lint): no llega a producción. Los patrones que procesa son los de nuestra configuración de ESLint, no datos externos: el riesgo real es bajo, pero el override es barato y elimina la alerta | `eslint` y `typescript-eslint` acepten `minimatch >= 11.0.1` en su rango | BlueOak-1.0.0 (también su nueva dependencia `@isaacs/nonrecursive-glob-match`) |

Verificación del override: ESLint analiza los mismos 31 archivos con los mismos resultados que con la 10.2.6; la regla `module-boundaries` sigue detectando violaciones; pasan lint, typecheck, los 87 tests y el build. `minimumReleaseAge` no bloquea la versión corregida: las 11.0.1–11.0.3 tienen más de 3 días (solo la 11.0.4, del 2026-11-02, queda fuera por ahora).

## Herramientas fuera de npm

| Herramienta | Versión | Para qué | Cómo se instala | Licencia |
|---|---|---|---|---|
| pnpm | 10.34.9 | Gestor de paquetes (ADR 0001) | `packageManager` + Corepack o `npm i -g pnpm@10.34.9`; en la CI, `pnpm/action-setup` | MIT |
| gitleaks | 8.30.1 | Escaneo de secretos (ADR 0005) | `sh scripts/install-gitleaks.sh` (versión y SHA-256 fijados) | MIT |
| PostgreSQL | 18 (imagen fijada por *digest*) | Base de datos (ADR 0003) | `compose.yaml`; en la CI, contenedor de servicio | PostgreSQL License |
| Acciones de GitHub | `actions/checkout` 7.0.1, `actions/setup-node` 7.1.0, `pnpm/action-setup` 6.1.0 | CI | Fijadas por SHA de commit en `.github/workflows/ci.yml` | MIT |

## Datos de terceros incluidos en el repositorio

| Datos | Origen | Para qué | Cómo se actualiza | Licencia |
|---|---|---|---|---|
| `apps/api/src/modules/auth/data/common-passwords.txt` | [SecLists](https://github.com/danielmiessler/SecLists), `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`, fijado en el commit `ac8a76c5ddfb31385195448f501d7b915b307e4b` y verificado por SHA-256 | Las 3.000 contraseñas más frecuentes de 15 o más caracteres, en orden de frecuencia, sin duplicados (sin distinguir mayúsculas) y **sin las que contienen «@»** (algunas parecían derivadas de correos; el repositorio es público). ASVS 6.2.4: con un mínimo de 15 caracteres, las 3.000 más comunes en general casi no aplican | `pnpm --filter @backoffice/api build:common-passwords` (falla si el SHA-256 no coincide) | MIT (verificada en el `LICENSE` del repositorio de SecLists) |

## Librería de gráficos (fase 1c): SVG propio en lugar de Recharts

`docs/plan.md` §4.2 recomendaba **Recharts** de forma provisional. Al implementar los tres gráficos de la fase 1c se comparó con dibujarlos en SVG y se **descartó**:

| | Recharts | SVG propio (`apps/web/src/finance/charts/`) |
|---|---|---|
| Qué dibuja la fase 1c | Barras agrupadas, barras horizontales y líneas con ejes | Lo mismo |
| Dependencias | Consultado en npm el 2026-11-03: 3.10.1, MIT, **11 dependencias directas** (`@reduxjs/toolkit`, `react-redux`, `immer`, `reselect`, `es-toolkit`, `victory-vendor`, `decimal.js-light`, `eventemitter3`, `clsx`, `tiny-invariant`, `use-sync-external-store`), 7,4 MB desempaquetado, y exige además `react-is` | Ninguna |
| Código propio | Pequeño: JSX declarativo | ~425 líneas en 6 archivos (3 gráficos, tabla de datos, paleta, escala de ejes); la escala (`scale.ts`) tiene tests |
| Accesibilidad | Hay que añadir la alternativa textual a mano | Cada gráfico lleva `role="img"` con descripción y una tabla con los mismos datos |
| Superficie de cadena de suministro | Mayor: el repositorio es público y cada dependencia nueva sube la superficie (política de actualizaciones de arriba) | Nula |

**Criterio de la regla 1** (¿lo resuelve la plataforma en unas 50 líneas que se puedan probar?): cada gráfico cabe en unas 100 líneas. No cumple «50», pero los tres son sencillos, estáticos y sin interacción, que es donde SVG gana. **Cuándo reconsiderarlo**: si más adelante hacen falta tooltips, zoom, animaciones o gráficos que no sean barras ni líneas (el dashboard de la fase 3b.3), se vuelve a evaluar Recharts con esa necesidad concreta delante.

No comprobado: el tamaño que añadiría Recharts al paquete de la web ni su comportamiento con la CSP del servidor (`style-src 'self'`); no hizo falta para decidir.

## Arrastrar y soltar (fase 4b): sin librería en lugar de dnd-kit

`docs/plan.md` preveía `@dnd-kit/core` + `@dnd-kit/sortable` (MIT, mantenimiento activo). No se añade, consultado el **2026-11-09**: el tablero necesita tres formas de mover una tarjeta y las tres se resuelven con lo que ya traen el navegador y React.

| Necesidad | Solución sin dependencia |
|---|---|
| Ratón | Arrastrar y soltar nativo de HTML5 (`draggable`, `dragover`, `drop`) |
| Teclado y lector de pantalla | Asa por tarjeta con estados «cogida/soltada» y flechas, anunciada en una región `aria-live` (unas 60 líneas probadas en `apps/web/test/tasks-page.test.tsx`) |
| Táctil (incl. PWA en iOS) | Menú «Mover a…» (`<select>` nativo). dnd-kit lo haría arrastrando con retardo de activación, que es justo el riesgo que el plan señalaba en iOS |

**Qué se pierde**: la animación de la tarjeta mientras se arrastra y el arrastre táctil. Para un solo usuario, el menú cubre el táctil. **Cuándo reconsiderarlo**: si el arrastre con el dedo en el iPhone resulta imprescindible; entonces `@dnd-kit/core` + `@dnd-kit/sortable` con `TouchSensor` (`delay` ≈ 200 ms) y los mismos tests de teclado, justificado aquí con versión, fecha y licencia verificadas en ese momento. La alternativa de arrastre nativo sin lógica propia (`@hello-pangea/dnd`, Apache-2.0) se descarta por la misma razón y por tener menos actividad.

## Markdown de la vista previa (fase 5b): `marked` (solo el analizador) en lugar de `react-markdown`

La vista previa de una nota tiene que dibujar Markdown sin `dangerouslySetInnerHTML` (ESLint lo prohíbe) y sin interpretar HTML. Se compararon, consultado el **2026-11-10**:

| | `react-markdown` 10.1.0 | `markdown-to-jsx` 9.10.6 | `marked` 18.1.2 (solo `lexer`) + renderizador propio |
|---|---|---|---|
| Resultado | Elementos de React | Elementos de React | Tokens → elementos de React (código propio) |
| Licencia | MIT | MIT | MIT |
| Mantenimiento | Última publicación 2025-03-07; el ecosistema unified/remark es activo | Publicación del 2026-11-06 | Publicación del 2026-11-09 (la 18.1.2 es de 2026-10-26: `minimumReleaseAge` exige 3 días) |
| Dependencias | Instalado en una prueba: **+75 paquetes** en el árbol (unified, remark, mdast, hast, micromark…) | Sin dependencias | **Sin dependencias** |
| HTML crudo | Sin `rehype-raw` **se descarta**, no se muestra; mostrarlo como texto exige un plugin propio sobre el árbol | No comprobado: no se instaló; se descartó por ser el mismo caso que `react-markdown` en cuanto al HTML y menos conocido | El token `html` llega con su texto original: se pinta como texto |
| Enlaces e imágenes | `urlTransform` y `components` | Sustitución por reglas | Control total en el propio renderizador |

**Decisión**: `marked.lexer` + renderizador propio (~250 líneas, con tests). La razón principal es la superficie de cadena de suministro de un repositorio público: 75 paquetes más frente a ninguno, para una vista previa de un solo usuario. Además, ninguna cadena pasa por HTML: no hay una etapa de «generar HTML y sanearlo» que pueda fallar. **Qué se pierde**: `react-markdown` es el camino más trillado y tiene más pruebas ajenas; aquí el renderizado es código propio y se cubre con `apps/web/test/notes-markdown.test.tsx`. No se admiten extensiones (notas al pie, matemáticas, resaltado de código). **Cuándo reconsiderarlo**: si hacen falta esas extensiones, `react-markdown` con sus plugins.

## Lectura del Excel (fase 3b.1): lector propio, sin dependencias

El plan (§4.2) preseleccionaba SheetJS CE desde su CDN y dejaba la decisión a un *spike*. Se comparó, consultado el **2026-11-10** en el registro de npm (`pnpm view`) y en la base de avisos de GitHub (`api.github.com/advisories`, por paquete):

| | `xlsx` (SheetJS) del registro de npm | SheetJS CE desde `cdn.sheetjs.com` | `exceljs` | `read-excel-file` | Lector propio (elegido) |
|---|---|---|---|---|---|
| Versión | 0.18.5 (la última del registro) | No está en el registro: no se consultó en esta fase | 4.4.0 (2023-10-19; hay una 4.4.1-prerelease de 2024-12-20) | 9.3.14 (2026-10-29) | — |
| Licencia | Apache-2.0 | Apache-2.0 | MIT | MIT | — |
| Dependencias directas | 7 (`cfb`, `ssf`, `wmf`, `word`, `crc-32`, `adler-32`, `codepage`) | — | 9 (`archiver`, `unzipper`, `jszip`, `saxes`, `fast-csv`, `tmp`, `uuid`, `dayjs`, `readable-stream`) | 4 (`saxen`, `fflate`, `worker-f`, `unzipper-esm`) | **0** |
| Avisos conocidos | 2 de gravedad alta (GHSA-5pgg-2g8v-p4x9, ReDoS; GHSA-4r6h-8v6p-xvw6, contaminación de prototipos) y 3 medios («SheetJS Pro») | — | 1 medio (GHSA-2j2j-8rrv-264g, XSS) | Ninguno en la consulta | — |
| ¿Lee el TEXTO de la fórmula? | Sí | Sí | Sí | **No**: devuelve el valor en caché y, si no puede, la celda vacía (su README) | Sí |
| Respeta `minimumReleaseAge` (`pnpm-workspace.yaml`) | Sí, pero queda en la versión con avisos | **No**: un tarball de una URL no pasa por el filtro; habría que guardarlo en el repositorio y Dependabot no lo vigila | Sí | Sí | — |
| ¿Se puede limitar lo que realmente descomprime? | No: descomprime por dentro | No | No (`jszip`, `unzipper`) | Parcial (`fflate`) | **Sí** (`zlib` con `maxOutputLength`) |

**Por qué lector propio.** (1) El requisito de ASVS 5.2.3 es limitar lo que se descomprime **antes y durante**: los tamaños que declara un ZIP los controla quien lo sube, y ninguna de las librerías comparadas deja fijar un presupuesto de bytes reales. Con `node:zlib` (`inflateRawSync` con `maxOutputLength`) sí. (2) `read-excel-file` no expone las fórmulas, que el contrato exige leer (§5). (3) Las dos opciones con las fórmulas tienen avisos abiertos o dependencias que no pasan el filtro. (4) El analizador XML es el punto delicado: `fast-xml-parser` (5.12.0, MIT, 6 dependencias directas, publicada el 2026-11-03) acumula una docena de avisos de entidades y DOCTYPE, algunos críticos y altos (p. ej. GHSA-m7jm-9gc2-mpf2, GHSA-8gc5-j5rx-235r); un analizador que **rechaza todo DTD** no puede tener esa clase de fallos. (5) CLAUDE.md pide comprobar primero si Node ya lo resuelve: `zlib` y un recorrido XML de unas 200 líneas lo resuelven.

**Qué es** (`apps/api/src/modules/imports/domain/`): `zip.ts` (~215 líneas: directorio central, límites, CRC-32), `xml.ts` (~205: SAX estricto sin DTD ni entidades), `workbook.ts` (~435: cadenas compartidas, estilos de fecha, fórmulas compartidas), `formula.ts` (~180: formas cerradas). **Qué se pierde**: formatos que no son OOXML (`.xls`, `.xlsb`, `.ods`), ZIP64, cifrado, imágenes y gráficos (no se leen) y la experiencia acumulada de una librería usada por miles de proyectos. **Mitigación**: más de 180 tests con archivos sintéticos hostiles (zip bomb, entrada que miente sobre su tamaño, XXE, «billion laughs», XML mal formado, ZIP truncado o cifrado) y una fixture ficticia; la fixture guardada por Excel (`docs/guia-fixture-excel.md`) es la comprobación que falta frente a un archivo real. **Cuándo reconsiderarlo**: si hubiera que leer `.xls` o `.xlsb`, o si el lector crece más allá de lo que se puede revisar entero.

## Dependencias descartadas en la fase 1

- **`argon2`, `bcrypt`** (npm): Node ≥ 24.12 trae `crypto.argon2` y no hacen falta binarios nativos (ADR 0006).
- **`otplib`, `speakeasy`**: TOTP son unas 60 líneas con los vectores oficiales de RFC 6238 (ADR 0006).
- **`express-session`, `connect-pg-simple`, `csurf`, `cookie-parser`**: sesiones, CSRF y lectura de la cookie propias (ADR 0006). `csurf` está obsoleto.
- **`jsonwebtoken`, `jose`**: no se usan JWT (ADR 0006).
- **`kysely-codegen`**: tipos de la base de datos escritos a mano (ADR 0006, decisión 9).

## Dependencias descartadas en la fase 0

- **`tsx`**: innecesaria; Node 24.12+ ejecuta TypeScript directamente (ADR 0001).
- **`husky` / `lefthook`**: `core.hooksPath` hace lo mismo sin dependencias (ADR 0005).
- **`dotenv`**: Node carga `.env` con `--env-file-if-exists` y `process.loadEnvFile`.
- **`cookie-parser`, `helmet`, `express-rate-limit`**: llegan con la autenticación (fase 1), no antes. En la fase 1 se añadieron `helmet` y `express-rate-limit`; `cookie-parser` no hizo falta.
