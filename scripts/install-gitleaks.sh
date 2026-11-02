#!/bin/sh
# Instala gitleaks con la versión fijada y comprobando su checksum SHA-256.
#
# Lo usan: tu máquina (una vez), las sesiones en la nube (script de configuración del entorno) y la
# CI (Linux y Windows). Es la ÚNICA fuente de la versión y de los checksums. Para actualizar: cambia
# VERSION y copia los checksums de gitleaks_<versión>_checksums.txt de la release oficial.
#
# Plataformas: Linux y macOS (x64 y arm64) y Windows x64 desde Git Bash (Git para Windows). En
# Windows se usa este mismo script en lugar de uno de PowerShell: Git para Windows es obligatorio de
# todos modos (ejecuta el hook de pre-commit con su sh), y así la versión y los checksums no se
# duplican en dos archivos (ver docs/adr/0005).
#
# Uso: sh scripts/install-gitleaks.sh [directorio-destino]   (por defecto, $HOME/.local/bin)
set -eu

VERSION=8.30.1
DEST="${1:-$HOME/.local/bin}"

# En Git Bash, uname -s devuelve p. ej. "MINGW64_NT-10.0-26100" o "MSYS_NT-10.0-26100".
case "$(uname -s)" in
  MINGW*|MSYS*) OS=Windows ;;
  *) OS="$(uname -s)" ;;
esac

EXT=tar.gz
BIN=gitleaks
case "${OS}_$(uname -m)" in
  Linux_x86_64)   ASSET=linux_x64;    SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Linux_aarch64)  ASSET=linux_arm64;  SHA256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  Darwin_x86_64)  ASSET=darwin_x64;   SHA256=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  Darwin_arm64)   ASSET=darwin_arm64; SHA256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  Windows_x86_64) ASSET=windows_x64;  SHA256=d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e
                  EXT=zip; BIN=gitleaks.exe ;;
  *) echo "install-gitleaks: plataforma no soportada: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

FILE="gitleaks_${VERSION}_${ASSET}.${EXT}"

URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${FILE}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$FILE" "$URL"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP/$FILE" | cut -d ' ' -f 1)"
else
  ACTUAL="$(shasum -a 256 "$TMP/$FILE" | cut -d ' ' -f 1)"
fi
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "install-gitleaks: checksum incorrecto (esperado $SHA256, obtenido $ACTUAL). No se instala." >&2
  exit 1
fi

# La extracción solo ocurre DESPUÉS de verificar el checksum.
if [ "$EXT" = zip ]; then
  # Git para Windows incluye unzip; si faltara, se usa el tar.exe de Windows 10+ (bsdtar lee .zip).
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$TMP/$FILE" "$BIN" -d "$TMP"
  else
    "${SYSTEMROOT:-/c/Windows}/System32/tar.exe" -xf "$TMP/$FILE" -C "$TMP" "$BIN"
  fi
else
  tar -xzf "$TMP/$FILE" -C "$TMP" "$BIN"
fi
mkdir -p "$DEST"
install -m 0755 "$TMP/$BIN" "$DEST/$BIN"
echo "install-gitleaks: gitleaks $VERSION instalado en $DEST/$BIN"
