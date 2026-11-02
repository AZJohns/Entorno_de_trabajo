#!/bin/bash
# Hook SessionStart (.claude/settings.json): prepara las sesiones de Claude Code EN LA NUBE.
#
# - Solo actúa si CLAUDE_CODE_REMOTE=true; en local sale sin hacer nada.
# - gitleaks: si no está instalado, lo instala con scripts/install-gitleaks.sh (versión y SHA-256
#   fijados) en /usr/local/bin, que ya está en el PATH. Sin gitleaks, el hook de pre-commit bloquea
#   todos los commits (fallo cerrado, ver docs/adr/0005).
# - Node >= 24.12 (engines): si el node del PATH es más antiguo, busca uno instalado en /opt/node*/bin
#   y lo antepone al PATH de los comandos de la sesión mediante CLAUDE_ENV_FILE.
#
# Se usa un hook del repositorio y no el script de configuración del entorno porque el entorno
# Default lo comparten sesiones de otros repositorios: allí este script no existe.
#
# Salida: si algo falla, sale con código 2 y el mensaje se muestra al usuario como aviso del hook; la
# sesión arranca igualmente. Lo que se escribe en stdout lo recibe Claude como contexto.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

fail() {
  echo "session-start: $*" >&2
  exit 2
}

[ -n "${CLAUDE_PROJECT_DIR:-}" ] || fail "CLAUDE_PROJECT_DIR no está definido"
cd "$CLAUDE_PROJECT_DIR"

# --- gitleaks -----------------------------------------------------------------------------------
GITLEAKS_DIR=/usr/local/bin
if ! command -v gitleaks >/dev/null 2>&1; then
  [ -w "$GITLEAKS_DIR" ] || fail "no se puede escribir en $GITLEAKS_DIR para instalar gitleaks"
  sh scripts/install-gitleaks.sh "$GITLEAKS_DIR" >&2 || fail "no se pudo instalar gitleaks"
fi
gitleaks_version="$(gitleaks version 2>/dev/null)" || fail "gitleaks está instalado pero no se ejecuta"

# --- Node >= 24.12 ------------------------------------------------------------------------------
# Devuelve 0 si el binario de Node indicado es >= 24.12 (Argon2 nativo y TypeScript estable).
node_ok() {
  "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number);
           process.exit(a > 24 || (a === 24 && b >= 12) ? 0 : 1)' 2>/dev/null
}

node_note=""
if command -v node >/dev/null 2>&1 && node_ok node; then
  node_bin="$(command -v node)"
else
  node_bin=""
  # Las versiones más altas primero.
  for candidate in $(ls -d /opt/node*/bin 2>/dev/null | sort -V -r); do
    if [ -x "$candidate/node" ] && node_ok "$candidate/node"; then
      node_bin="$candidate/node"
      break
    fi
  done
  [ -n "$node_bin" ] || fail "no hay Node >= 24.12 (el del PATH es $(node -v 2>/dev/null || echo 'ninguno')); pnpm install fallará por engineStrict"
  [ -n "${CLAUDE_ENV_FILE:-}" ] || fail "falta CLAUDE_ENV_FILE: no se puede anteponer $(dirname "$node_bin") al PATH"
  echo "export PATH=\"$(dirname "$node_bin"):\$PATH\"" >> "$CLAUDE_ENV_FILE"
  node_note=" (antepuesto al PATH de la sesión)"
fi

echo "Entorno en la nube listo: gitleaks ${gitleaks_version}; Node $("$node_bin" -v) en ${node_bin}${node_note}."
