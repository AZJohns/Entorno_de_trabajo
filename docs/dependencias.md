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
| `apps/api/src/modules/auth/data/common-passwords.txt` | [SecLists](https://github.com/danielmiessler/SecLists), `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`, fijado en el commit `ac8a76c5ddfb31385195448f501d7b915b307e4b` y verificado por SHA-256 | Las 3.000 contraseñas más frecuentes de 15 o más caracteres, en orden de frecuencia y sin duplicados (sin distinguir mayúsculas). ASVS 6.2.4: con un mínimo de 15 caracteres, las 3.000 más comunes en general casi no aplican | `pnpm --filter @backoffice/api build:common-passwords` (falla si el SHA-256 no coincide) | MIT (verificada en el `LICENSE` del repositorio de SecLists) |

## Dependencias descartadas en la fase 1

- **`argon2`, `bcrypt`** (npm): Node ≥ 24.12 trae `crypto.argon2` y no hacen falta binarios nativos (ADR 0006).
- **`otplib`, `speakeasy`**: TOTP son unas 60 líneas con los vectores oficiales de RFC 6238 (ADR 0006).
- **`express-session`, `connect-pg-simple`, `csurf`, `cookie-parser`**: sesiones, CSRF y lectura de la cookie propias (ADR 0006). `csurf` está obsoleto.
- **`jsonwebtoken`, `jose`**: no se usan JWT (ADR 0006).
- **`kysely-codegen`**: tipos de la base de datos escritos a mano (ADR 0006, decisión 9).
- **Generador de códigos QR**: el alta del TOTP muestra la clave y el enlace `otpauth://` (en el iPhone abre la app de códigos). Si hiciera falta un QR, se evaluará entonces.

## Dependencias descartadas en la fase 0

- **`tsx`**: innecesaria; Node 24.12+ ejecuta TypeScript directamente (ADR 0001).
- **`husky` / `lefthook`**: `core.hooksPath` hace lo mismo sin dependencias (ADR 0005).
- **`dotenv`**: Node carga `.env` con `--env-file-if-exists` y `process.loadEnvFile`.
- **`cookie-parser`, `helmet`, `express-rate-limit`**: llegan con la autenticación (fase 1), no antes. En la fase 1 se añadieron `helmet` y `express-rate-limit`; `cookie-parser` no hizo falta.
