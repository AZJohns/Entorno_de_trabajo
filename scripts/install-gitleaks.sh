#!/bin/sh
# Instala gitleaks con la versión fijada y comprobando su checksum SHA-256.
#
# Lo usan: tu máquina (una vez), las sesiones en la nube (script de configuración del entorno) y la
# CI. Una sola fuente para la versión y los checksums. Para actualizar: cambia VERSION y copia los
# checksums de gitleaks_<versión>_checksums.txt de la release oficial.
#
# Uso: sh scripts/install-gitleaks.sh [directorio-destino]   (por defecto, $HOME/.local/bin)
set -eu

VERSION=8.30.1
DEST="${1:-$HOME/.local/bin}"

case "$(uname -s)_$(uname -m)" in
  Linux_x86_64)  ASSET=linux_x64;    SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Linux_aarch64) ASSET=linux_arm64;  SHA256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  Darwin_x86_64) ASSET=darwin_x64;   SHA256=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  Darwin_arm64)  ASSET=darwin_arm64; SHA256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  *) echo "install-gitleaks: plataforma no soportada: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

FILE="gitleaks_${VERSION}_${ASSET}.tar.gz"
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

tar -xzf "$TMP/$FILE" -C "$TMP" gitleaks
mkdir -p "$DEST"
install -m 0755 "$TMP/gitleaks" "$DEST/gitleaks"
echo "install-gitleaks: gitleaks $VERSION instalado en $DEST/gitleaks"
