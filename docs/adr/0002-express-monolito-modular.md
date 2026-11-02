# ADR 0002 — Express 5 y monolito modular por capas

- **Estado:** Aceptado
- **Fecha:** 2026-11-02

## Contexto

Es una aplicación privada de un solo usuario con varios dominios (finanzas, importación, tareas, notas, notificaciones y autenticación). Debe poder crecer sin reescribirse y debe poder explicarse capa a capa. El rendimiento no es un criterio: hay un único usuario.

## Decisión

1. **Express 5** como framework HTTP. En la versión 5, los errores de las funciones `async` llegan al gestor de errores sin envoltorios.
2. **Monolito modular**: un solo proceso y una sola base de datos, con un módulo por dominio en `apps/api/src/modules/<módulo>/`.
3. **Capas** dentro de cada módulo: rutas → controlador → servicio → repositorio, con la lógica pura (cálculos) en `domain/`, sin E/S.
4. **Fronteras impuestas, no solo documentadas.** Un módulo solo se usa desde fuera a través de su `index.ts`. Lo comprueba una **regla propia de ESLint** (`apps/api/eslint/module-boundaries.ts`, con sus tests):
   - `no-restricted-imports` compara textos y no puede saber si una ruta relativa (`../finance/x.ts`) cruza a otro módulo;
   - la regla propia resuelve la ruta y lo comprueba.
5. **Composición manual de dependencias** (sin framework de inyección): las dependencias se pasan como parámetros. Ejemplo: `createApp({ logger })`.
6. **Errores con un único formato**: RFC 9457 (`application/problem+json`), con el esquema compartido de `packages/shared`. Un solo middleware construye todas las respuestas de error; un error inesperado devuelve un 500 genérico y la traza solo va al log.
7. **API versionada** bajo `/api/v1`. El atajo de iPhone es un cliente que no se actualiza a la vez que la web.

## Alternativas descartadas

- **NestJS**: impone justo esta estructura (módulos e inyección de dependencias), pero con decoradores y `reflect-metadata`. Se aprende antes el framework que HTTP. Para un solo usuario es pesado.
- **Fastify**: técnicamente igual o superior (validación por esquema y logger integrados). Se elige Express por ubicuidad y por tener una superficie mínima, **no por méritos técnicos**. Habría sido una elección igual de válida.
- **Next.js**: el SSR no aporta nada en una app privada tras un login. Mezcla las fronteras entre servidor y cliente y encaja mal con procesos de larga duración (recordatorios).
- **Microservicios**: el coste operativo es desproporcionado para un solo usuario.

## Consecuencias

- La estructura depende de convenciones; por eso se imponen con lint y tests.
- `createApp` no escucha en ningún puerto: los tests usan supertest sin abrir puertos.
- Cada módulo tendrá su `README.md` con su responsabilidad, su API pública y sus tablas.
