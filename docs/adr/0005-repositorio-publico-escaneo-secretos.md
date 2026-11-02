# ADR 0005 — Repositorio público y escaneo de secretos en tres capas

- **Estado:** Aceptado
- **Fecha:** 2026-11-02

## Contexto

El repositorio será público (sirve de portfolio), pero el sistema guarda datos financieros personales. Todo lo que se sube, **historial incluido**, queda expuesto y puede copiarse en *forks* y cachés. Un secreto subido debe considerarse comprometido aunque se borre después.

## Decisión

1. **El repositorio se trata como público desde ya.** Nunca se suben:
   - secretos, dominios, IP, correos de terceros ni datos privados;
   - nombres reales de cuentas, bancos o tarjetas;
   - datos financieros.

   La configuración llega por variables de entorno (`.env` ignorado; `.env.example` sin valores) y los tests usan solo fixtures ficticias. La seguridad **no depende de ocultar el código**.
2. **Escaneo de secretos en tres capas**:
   1. **Local, en pre-commit** (`.githooks/pre-commit`): `gitleaks git --pre-commit --staged`.
      - **Fallo cerrado**: si gitleaks no está instalado, el commit se bloquea.
      - El hook lo activa `pnpm install` mediante el script `prepare`, que fija `core.hooksPath`. Sin ese paso, un clon nuevo no ejecutaría el hook.
   2. **CI**: el job `gitleaks` escanea **todo el historial** de todas las ramas (`fetch-depth: 0`, `--log-opts=--all`) en cada PR y en cada push a `main`.
   3. **GitHub**: secret scanning y *push protection* del repositorio (`docs/runbooks/github.md`).
3. **gitleaks se instala como binario oficial con versión y checksum SHA-256 fijados** (`scripts/install-gitleaks.sh`). Es una única fuente para la máquina local, las sesiones en la nube y la CI.
   - Plataformas: Linux y macOS (x64 y arm64) y **Windows x64**.
   - En Windows, el mismo script se ejecuta desde **Git Bash**: detecta `MINGW*`/`MSYS*` en `uname -s`, descarga el `.zip` oficial y verifica el SHA-256 **antes** de extraerlo. Si no encuentra `unzip`, extrae con el `tar.exe` de Windows.
   - El job `windows` de la CI lo comprueba en `windows-latest`.
4. **Finales de línea LF en todos los sistemas** (`.gitattributes`: `* text=auto eol=lf`, con los binarios marcados). Git para Windows convierte a CRLF por defecto; un hook con CRLF no se ejecuta y Prettier, que exige LF, fallaría.
5. **Endurecimiento de la CI**:
   - `permissions: contents: read`;
   - acciones fijadas por **SHA de commit**;
   - `persist-credentials: false`;
   - sin `pull_request_target`.
6. **Dependabot** con `cooldown` de 3 días, igual que `minimumReleaseAge` de pnpm (ADR 0001).

## Alternativas descartadas

- **Imagen de contenedor de gitleaks fijada por *digest*** (el plan inicial): equivalente en seguridad. Se descarta porque obligaría a mantener dos fuentes de versión (la imagen en la CI y el binario en local). Además, en las sesiones en la nube la descarga de la imagen está bloqueada por la red y la del binario no.
- **`gitleaks-action`**: puede exigir licencia según el tipo de cuenta, y añade una acción de terceros con acceso al repositorio.
- **Un script de PowerShell equivalente para Windows**: duplicaría la versión y los checksums en un segundo archivo (dos fuentes que pueden desincronizarse), o tendría que extraerlos del script `sh` analizando su texto, que es frágil. Git para Windows es obligatorio de todos modos, porque ejecuta el hook con su `sh`, así que Git Bash siempre está disponible. Coste: quien use solo PowerShell tiene que abrir Git Bash una vez para instalar gitleaks.
- **Husky o lefthook** para los hooks: dependencias innecesarias; `core.hooksPath` hace lo mismo.
- **Hook que solo avisa**: un aviso se ignora, y en un repositorio público el coste de un error es rotar el secreto.
- **Repositorio privado**: es más seguro por ocultación, pero se pierde el valor como portfolio. Con una cuenta gratuita, además, no se podría proteger `main`.

## Consecuencias

- Para hacer commits hay que tener gitleaks instalado (`sh scripts/install-gitleaks.sh`). En las sesiones de Claude Code en la nube lo instala el hook `SessionStart` del repositorio (`.claude/hooks/session-start.sh`), que también garantiza Node ≥ 24.12. No se usa el script de configuración del entorno porque el entorno Default lo comparten otros repositorios (`README.md`).
- Si se filtra un secreto: **rotarlo primero** y limpiarlo después (`docs/runbooks/github.md` §8).
- Ampliar `.gitleaksignore` exige justificarlo.
