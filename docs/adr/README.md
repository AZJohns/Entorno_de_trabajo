# Registro de decisiones de arquitectura (ADR)

Cada decisión que cambia la arquitectura (módulos, capas, formato de errores, versionado de la API, seguridad de base) tiene su ADR. Un ADR aceptado no se reescribe: si una decisión cambia, se escribe otro ADR y en el anterior se anota qué punto queda sustituido.

| ADR | Decisión | Estado |
|---|---|---|
| [0001](0001-monorepo-pnpm.md) | Monorepo con pnpm workspaces y Node 24 ejecutando TypeScript directamente | Aceptado |
| [0002](0002-express-monolito-modular.md) | Express 5 y monolito modular por capas | Aceptado |
| [0003](0003-kysely-migraciones-sql.md) | Kysely y migraciones SQL versionadas e inmutables | Aceptado (punto 5 sustituido por el 0006) |
| [0004](0004-importes-en-centimos.md) | Importes como enteros en céntimos | Aceptado |
| [0005](0005-repositorio-publico-escaneo-secretos.md) | Repositorio público y escaneo de secretos en tres capas | Aceptado |
| [0006](0006-sesiones-y-dos-factores.md) | Sesiones con estado, Argon2id y dos factores (contraseña + TOTP) | Aceptado |

Plantilla: **Estado** y **Fecha**; **Contexto**; **Decisión**; **Alternativas descartadas**; **Consecuencias**.
