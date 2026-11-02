# ADR 0001 — Monorepo con pnpm workspaces y Node 24 ejecutando TypeScript directamente

- **Estado:** Aceptado
- **Fecha:** 2026-11-02

## Contexto

El proyecto tiene tres piezas que comparten código: la web (`apps/web`), la API (`apps/api`) y los esquemas y utilidades comunes (`packages/shared`). Los esquemas de validación y la utilidad de importes deben ser **los mismos** en el navegador y en el servidor. Además, el proyecto exige justificar cada dependencia y minimizar los pasos de compilación.

## Decisión

1. **Un solo repositorio con pnpm workspaces** (`apps/*`, `packages/*`). `packages/shared` se consume como dependencia `workspace:*`.
2. **pnpm 10.34.9**, fijado en `packageManager`:
   - `node_modules` estricto: un paquete solo puede importar lo que declara. Así se detectan las dependencias no declaradas.
   - **No ejecuta los scripts de instalación** de las dependencias salvo una lista explícita (`onlyBuiltDependencies`, hoy vacía).
   - `minimumReleaseAge: 4320`: no instala versiones publicadas hace menos de 3 días. Es una defensa contra paquetes comprometidos, que suelen detectarse en horas.
   - `engineStrict`: la instalación falla con una versión de Node que no cumple `engines`.
3. **Node 24 LTS, `>= 24.12.0`** (`.nvmrc` y `engines`). La CI prueba además Node 26 LTS. Motivos para el mínimo exacto:
   - `crypto.argon2` (Argon2 nativo, sin dependencias) existe desde la 24.7.0.
   - La **ejecución directa de TypeScript (type stripping) es estable desde la 24.12.0**. En la documentación de Node 24 (`api/typescript`) figura como *Stability: 2 - Stable*; en la 24.3 dejó de mostrar el aviso experimental.
4. **La API ejecuta TypeScript directamente con Node, sin compilar**, en desarrollo y en producción.
   - Al ser estable, no hace falta un paso de compilación ni `tsx`. `tsc` se usa **solo para comprobar los tipos** (`noEmit`).
   - Restricciones que impone, aplicadas con `tsconfig.base.json`:
     - solo sintaxis «borrable» (`erasableSyntaxOnly`: sin `enum`, `namespace` ni *parameter properties*);
     - imports con la extensión `.ts` (`allowImportingTsExtensions`);
     - `import type` explícito (`verbatimModuleSyntax`).
5. **`packages/shared` no se compila.** Node no ejecuta TypeScript dentro de `node_modules`. pnpm enlaza el paquete con un enlace simbólico y Node sigue el enlace hasta la ruta real (`packages/shared/src/…`), que está fuera de `node_modules`. **Verificado** en la fase 0: la API importa `@backoffice/shared` y lo ejecuta sin compilar. La web lo consume a través de Vite.
6. **Todo en ESM** (`"type": "module"`).

## Alternativas descartadas

- **npm workspaces**: no hace falta instalar nada, pero el `node_modules` aplanado permite importar dependencias no declaradas, y npm ejecuta por defecto los scripts de instalación de terceros.
- **Turborepo o Nx**: añaden caché y grafo de tareas, que con tres paquetes pequeños no compensan su complejidad.
- **Repositorios separados**: obligarían a publicar `shared` como paquete y a sincronizar versiones.
- **Compilar la API con `tsc` a JavaScript**: era el plan inicial, condicionado a que la ejecución directa no fuera estable. Lo es desde Node 24.12, así que se descarta un paso de compilación que no aporta nada.
- **tsx** en desarrollo: innecesario por el mismo motivo (`node --watch` basta).
- **pnpm 11 o 12**: hay versiones más nuevas (la 12.16 en noviembre de 2026), con cambios en la configuración. Se fija la 10.34, cuyo comportamiento está verificado en este repositorio. Subir de versión mayor se decidirá en un ADR propio.

## Consecuencias

- Hay que usar Node ≥ 24.12; con versiones anteriores, `pnpm install` falla a propósito.
- No se pueden usar `enum` ni otras construcciones de TypeScript que generen código. Se usan uniones de literales y objetos `as const`.
- Las versiones recién publicadas tardan 3 días en estar disponibles. Si hay una corrección de seguridad urgente, se añade una excepción temporal en `minimumReleaseAgeExclude`, justificada.
- El paso «build» solo existe para la web (Vite).
