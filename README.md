# Backoffice personal

Aplicación **privada de un solo usuario** para finanzas, tareas y notas. El código es público; la instancia y sus datos, no.

- Diseño completo: [`docs/plan.md`](docs/plan.md) · Decisiones: [`docs/adr/`](docs/adr/) · Dependencias: [`docs/dependencias.md`](docs/dependencias.md)
- Seguridad: [`docs/seguridad/asvs-l2.md`](docs/seguridad/asvs-l2.md) · Reportar vulnerabilidades: [`SECURITY.md`](SECURITY.md)
- Reglas para trabajar en el repositorio (también para sesiones de IA): [`CLAUDE.md`](CLAUDE.md)

**Estado:** fase 0 (base del repositorio). Todavía no hay funcionalidad: solo `GET /api/v1/health` y una página vacía.

## Estructura

```
apps/api         API: Express 5 + TypeScript ejecutado directamente por Node 24
apps/web         Web: React + Vite + Tailwind
packages/shared  Código compartido: importes en céntimos, formato de error (RFC 9457)
docs/            Plan, ADR, seguridad y runbooks
```

## Requisitos

- **Node ≥ 24.12** (`.nvmrc`). Con `nvm`: `nvm install && nvm use`.
- **pnpm 10.34.9**: `corepack enable` (si tu Node incluye Corepack) o `npm i -g pnpm@10.34.9`.
- **Docker** con Compose (para PostgreSQL).
- **gitleaks**: obligatorio para hacer commits, porque el hook pre-commit falla si no está instalado:

  ```bash
  sh scripts/install-gitleaks.sh
  ```

  Lo instala en `~/.local/bin`, con la versión y el checksum fijados. Ese directorio tiene que estar en tu `PATH`.

## Arranque en local

1. Instala las dependencias. También activa el hook de pre-commit (`core.hooksPath = .githooks`):

   ```bash
   pnpm install
   ```

2. Crea tu `.env` a partir del ejemplo y rellena `POSTGRES_PASSWORD`, `DATABASE_URL` y `TEST_DATABASE_URL` con la misma contraseña (por ejemplo, la salida de `openssl rand -hex 16`):

   ```bash
   cp .env.example .env
   ```

3. Arranca PostgreSQL 18 (solo escucha en `127.0.0.1`):

   ```bash
   pnpm db:up
   ```

4. Aplica las migraciones:

   ```bash
   pnpm db:migrate
   ```

5. Arranca la API (puerto 3000, se reinicia al guardar):

   ```bash
   pnpm --filter @backoffice/api dev
   ```

6. Comprueba que responde:

   ```bash
   curl http://127.0.0.1:3000/api/v1/health
   ```

7. Arranca la web (Vite redirige `/api` a la API):

   ```bash
   pnpm --filter @backoffice/web dev
   ```

## Comprobaciones (las mismas que la CI)

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build
```

```bash
pnpm secrets:scan
```

`pnpm test` necesita PostgreSQL arrancado y `TEST_DATABASE_URL` en `.env`: los tests de integración crean una base de datos temporal y la borran al terminar.

## Sesiones de Claude Code en la nube

Las sesiones en la nube también hacen commits, así que necesitan gitleaks: si no está instalado, el hook bloquea el commit. En la **configuración del entorno** (script de configuración que se ejecuta al crear la sesión), añade:

```bash
sh scripts/install-gitleaks.sh "$HOME/.local/bin" && echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
```

El script descarga la release oficial de gitleaks con la **versión fijada** y **comprueba su SHA-256** antes de instalarla; si el checksum no coincide, no instala nada. La sesión también necesita Node ≥ 24.12 en el `PATH` y pnpm 10.34.9.

## Licencia

[MIT](LICENSE)
