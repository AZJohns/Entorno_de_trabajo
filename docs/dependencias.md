# Registro de dependencias

Cada dependencia directa tiene que estar aquí con su justificación. **Antes de añadir una**:
1. Comprueba si Node, el navegador o PostgreSQL ya lo resuelven en menos de unas 50 líneas que se puedan probar.
2. Añade la fila: para qué sirve, qué alternativa había y por qué se descartó, licencia y estado de mantenimiento.
3. Si la dependencia necesita ejecutar scripts de instalación, justifícalo aquí antes de añadirla a `onlyBuiltDependencies` (`pnpm-workspace.yaml`).

**Política de actualización** (ASVS 15.1.1): vulnerabilidades críticas en 7 días, altas en 30, medias en 90; resto con la revisión mensual. Dependabot propone los PR con 3 días de espera (`cooldown`), en línea con `minimumReleaseAge` de pnpm.

«Mantenimiento» indica la versión instalada y su fecha de publicación según el registro de npm, consultado el **2026-11-02**. Hay que revisarlo en cada actualización mayor.

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
| `vitest` | 5.0.5 (2026-10-15) | api, shared | Tests; comparte configuración con Vite y ejecuta TypeScript directamente | Jest (exige transformar TypeScript), `node:test` (menos ergonomía para *mocks* y *matchers*) | MIT |
| `supertest` | 7.3.1 (2026-10-02) | api | Peticiones HTTP a la app de Express sin abrir puertos | `fetch` contra un servidor arrancado en el test | MIT |
| `vite` | 8.3.5 (2026-10-21) | web | Servidor de desarrollo y empaquetado | — (decisión del stack) | MIT |
| `@vitejs/plugin-react` | 6.1.2 (2026-10-05) | web | Soporte de React (JSX, recarga en caliente) en Vite | — | MIT |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 (2026-07-16) | web | Estilos con utilidades; la v4 se configura en CSS | CSS propio | MIT |
| `@types/node` (^24), `@types/express`, `@types/pg`, `@types/supertest`, `@types/react`, `@types/react-dom` | 24.19.2, 5.0.6, 8.23.1, 7.2.1, 19.3.0, 19.3.0 | varios | Tipos de TypeScript. **`@types/node` sigue a la versión mínima de Node soportada (24, por `engines` y `.nvmrc`)**: con los tipos de una versión posterior, TypeScript aceptaría APIs que no existen en Node 24 y el fallo aparecería al ejecutar. Dependabot ignora sus actualizaciones major (`.github/dependabot.yml`); se suben a mano a la vez que el mínimo de `engines`, con su ADR | — | MIT |

## Herramientas fuera de npm

| Herramienta | Versión | Para qué | Cómo se instala | Licencia |
|---|---|---|---|---|
| pnpm | 10.34.9 | Gestor de paquetes (ADR 0001) | `packageManager` + Corepack o `npm i -g pnpm@10.34.9`; en la CI, `pnpm/action-setup` | MIT |
| gitleaks | 8.30.1 | Escaneo de secretos (ADR 0005) | `sh scripts/install-gitleaks.sh` (versión y SHA-256 fijados) | MIT |
| PostgreSQL | 18 (imagen fijada por *digest*) | Base de datos (ADR 0003) | `compose.yaml`; en la CI, contenedor de servicio | PostgreSQL License |
| Acciones de GitHub | `actions/checkout` 7.0.1, `actions/setup-node` 7.1.0, `pnpm/action-setup` 6.1.0 | CI | Fijadas por SHA de commit en `.github/workflows/ci.yml` | MIT |

## Dependencias descartadas en la fase 0

- **`tsx`**: innecesaria; Node 24.12+ ejecuta TypeScript directamente (ADR 0001).
- **`husky` / `lefthook`**: `core.hooksPath` hace lo mismo sin dependencias (ADR 0005).
- **`dotenv`**: Node carga `.env` con `--env-file-if-exists` y `process.loadEnvFile`.
- **`cookie-parser`, `helmet`, `express-rate-limit`**: llegan con la autenticación (fase 1), no antes.
