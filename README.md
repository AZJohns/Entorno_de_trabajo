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

  Lo instala en `~/.local/bin`, con la versión y el checksum fijados. Ese directorio tiene que estar en tu `PATH`. En Windows, ver la sección [Windows (x64)](#windows-x64).

## Arranque en local

1. Instala las dependencias. También activa el hook de pre-commit (`core.hooksPath = .githooks`):

   ```bash
   pnpm install
   ```

2. Crea tu `.env` a partir del ejemplo y rellena `POSTGRES_PASSWORD`, `DATABASE_URL` y `TEST_DATABASE_URL` con la misma contraseña (por ejemplo, la salida de `openssl rand -hex 16`). Las dos URL usan el puerto de `POSTGRES_PORT` (5432 por defecto; si está ocupado, ver [Puerto 5432 ocupado](#puerto-5432-ocupado-postgresql-nativo-u-otro-programa)):

   ```bash
   cp .env.example .env
   ```

   Rellena también `TOTP_ENCRYPTION_KEY` (32 bytes aleatorios en base64; guarda una copia en tu gestor de contraseñas). Los demás valores del ejemplo sirven para desarrollo (`HOST=127.0.0.1`, `PUBLIC_ORIGIN=http://localhost:5173`, `TRUST_PROXY_HOPS=0`):

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
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

7. Crea el único usuario (una sola vez). Pide la contraseña sin mostrarla (15 caracteres o más) y la comprueba contra Pwned Passwords, así que necesita conexión. Muestra **una sola vez** la clave TOTP, el enlace `otpauth://` y 10 códigos de recuperación: añade la clave a tu app de autenticación y guarda los códigos en el gestor de contraseñas:

   ```bash
   pnpm user:create
   ```

8. Arranca la web (Vite redirige `/api` a la API) y entra en http://localhost:5173 con el usuario, la contraseña y el código de la app:

   ```bash
   pnpm --filter @backoffice/web dev
   ```

Otras operaciones de la cuenta (restablecer la contraseña, cerrar todas las sesiones, deshabilitar la cuenta): [`apps/api/src/modules/auth/README.md`](apps/api/src/modules/auth/README.md).

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

## Windows (x64)

El repositorio funciona en Windows con **Git para Windows**. La CI lo comprueba en `windows-latest` (job `windows`): finales de línea, instalación de gitleaks, `pnpm install`, `pnpm lint` y que el hook bloquea un secreto.

### Requisitos

- **[Git para Windows](https://git-scm.com/download/win)**: incluye **Git Bash**. Es obligatorio, porque Git ejecuta el hook de pre-commit (`sh`) con el `sh` que trae.
- **Node ≥ 24.12**: con el instalador oficial o con nvm-windows. nvm-windows no lee `.nvmrc`; usa `nvm install 24` y `nvm use 24`.
- **pnpm 10.34.9**: `corepack enable` (si tu Node incluye Corepack) o `npm i -g pnpm@10.34.9`.
- **Docker Desktop** (con WSL 2) para PostgreSQL.

**Finales de línea:** `.gitattributes` fuerza LF en todos los archivos, sea cual sea tu `core.autocrlf`. Sin LF, el hook no se ejecuta y Prettier falla. Si clonaste el repositorio **antes** de que existiera `.gitattributes`, renormaliza la copia de trabajo una vez, con los cambios guardados antes (reescribe tus archivos locales):

```powershell
git rm -r --cached -q . ; git reset --hard
```

### gitleaks

Se instala desde **Git Bash** con el mismo script que en Linux y macOS. Descarga el asset oficial `windows_x64.zip`, comprueba su SHA-256 y deja `gitleaks.exe` en `%USERPROFILE%\.local\bin`:

```bash
sh scripts/install-gitleaks.sh
```

Añade esa carpeta al `PATH` de tu usuario (PowerShell) y **abre una terminal nueva**:

```powershell
[Environment]::SetEnvironmentVariable('Path', "$env:USERPROFILE\.local\bin;" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')
```

Comprueba que se encuentra:

```powershell
gitleaks version
```

### Puerto 5432 ocupado (PostgreSQL nativo u otro programa)

Si en tu PC ya hay un PostgreSQL instalado como servicio, normalmente ocupa el puerto **5432** y `pnpm db:up` falla al publicar el puerto. Los dos pueden convivir: el del proyecto se publica en otro puerto del host.

1. Mira qué proceso usa el 5432. La última columna es el PID; búscalo en el Administrador de tareas, pestaña Detalles:

   ```powershell
   netstat -ano | findstr :5432
   ```

2. Comprueba también que el puerto que vas a elegir no esté en un **rango reservado** por Windows (Hyper-V, WSL o Docker reservan rangos dinámicos y el puerto falla aunque nadie lo use):

   ```powershell
   netsh interface ipv4 show excludedportrange protocol=tcp
   ```

3. Elige un puerto libre y fuera de esos rangos (por ejemplo, `5433`) y ponlo en `.env`. Usa **ese mismo puerto** en `DATABASE_URL` y en `TEST_DATABASE_URL`, porque compose y la API leen variables distintas:

   ```dotenv
   POSTGRES_PORT=5433
   DATABASE_URL=postgres://backoffice:<contraseña>@127.0.0.1:5433/backoffice
   TEST_DATABASE_URL=postgres://backoffice:<contraseña>@127.0.0.1:5433/backoffice
   ```

4. Vuelve a crear el contenedor con el nuevo puerto:

   ```powershell
   pnpm db:down; pnpm db:up
   ```

Usa siempre `127.0.0.1` en las URL, no `localhost`: así te conectas al PostgreSQL del contenedor y no, por error, al nativo, que puede escuchar en `::1`.

### Arranque

Los pasos son los mismos que en «Arranque en local». Cambia solo cómo se copia `.env` (PowerShell):

```powershell
Copy-Item .env.example .env
```

Contraseña aleatoria para `.env` (PowerShell 7):

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLower()
```

En Git Bash: `openssl rand -hex 16`.

`pnpm install` activa el hook (`core.hooksPath = .githooks`) igual que en Linux. Los comandos `pnpm …` funcionan igual en PowerShell, `cmd` y Git Bash.

## Sesiones de Claude Code en la nube

Las sesiones en la nube también hacen commits, así que necesitan gitleaks: sin él, el hook de pre-commit bloquea el commit. También necesitan Node ≥ 24.12, porque `pnpm install` falla con versiones anteriores (`engineStrict`).

De las dos cosas se encarga el **hook `SessionStart` del repositorio** (`.claude/settings.json` → `.claude/hooks/session-start.sh`). **No hace falta ningún script de configuración en el entorno.**

- **Cuándo se ejecuta:** al empezar, al reanudar, al limpiar y al compactar cada sesión. Solo actúa si `CLAUDE_CODE_REMOTE=true`; en tu máquina sale sin hacer nada.
- **gitleaks:** si no está instalado, lo instala con `scripts/install-gitleaks.sh` (versión fijada y SHA-256 comprobado) en `/usr/local/bin`, que ya está en el `PATH` de todos los comandos. Si ya está, no hace nada; la comprobación tarda menos de un segundo.
- **Node:** si el `node` del `PATH` es anterior a 24.12 (en la nube, por defecto, es el 22), busca uno instalado en `/opt/node*/bin` y lo antepone al `PATH` de los comandos de la sesión mediante `CLAUDE_ENV_FILE`. Es el mecanismo documentado para que una variable llegue a los comandos; `.bashrc` puede no aplicarse. pnpm cambia solo a la versión fijada en `packageManager`.
- **Si algo falla** (no se puede instalar gitleaks, o no hay un Node ≥ 24.12), el hook termina con el código 2. La sesión arranca igualmente, pero ves un aviso «SessionStart hook error» con el motivo.

**Por qué un hook y no el script de configuración del entorno:**
- El entorno **Default** lo comparten tus sesiones de otros repositorios. En ellas, `scripts/install-gitleaks.sh` no existe, así que el script fallaría y la sesión no arrancaría.
- El hook vive en este repositorio y solo se ejecuta en sus sesiones.

**Límites, según la documentación de Claude Code:**
- Los hooks del repositorio **no se cargan** en sesiones con varios repositorios ni en los hilos de un proyecto. En esos casos hay que instalar gitleaks a mano (`sh scripts/install-gitleaks.sh /usr/local/bin`) o con un script de configuración **condicionado** a que el archivo exista, para no romper las sesiones de otros repositorios:

  ```bash
  if [ -f scripts/install-gitleaks.sh ] && ! command -v gitleaks >/dev/null 2>&1; then sh scripts/install-gitleaks.sh /usr/local/bin; fi
  ```

- El hook se cancela si tarda más de 120 s (`timeout` en `.claude/settings.json`).

## Licencia

[MIT](LICENSE)
