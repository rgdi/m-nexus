#!/usr/bin/env bash
# =============================================================================
# M-NEXUS installer (v2.23.1)
# Single-command installer for the rgdi/m-nexus education platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- server
#   curl -fsSL .../install.sh | bash -s -- app
#   curl -fsSL .../install.sh | bash -s -- deploy --port 8080
#
# Modes:
#   app     (default) Download the Android APK + show adb install command.
#   server  Download the backend ZIP + run it locally (Node 18+, no Docker).
#           Idempotent — re-running is safe.
#   deploy  Deploy the static webview bundle to a public host (uses python3
#           http.server by default; auto-detects /var/www/html for nginx).
#
# Variables (override with `KEY=value bash <(curl …)` or INSTALL_FOO=…):
#   INSTALL_VERSION      Default: "latest"
#   INSTALL_DIR          Default: "$HOME/.mnexus"
#   INSTALL_PORT_BACK    Default: 4100 (backend)
#   INSTALL_PORT_FRONT   Default: 8080 (frontend / web)
#   INSTALL_DOMAIN       Default: localhost
#   INSTALL_AUTO_RUN     Default: 1 — auto-start in background for server/deploy
#   INSTALL_KEEP_ZIPS    Default: 0 — delete ZIPs after extraction
#   INSTALL_NO_DEPS      Default: 0 — skip apt/brew of system packages
#
# Author: rgdi · MIT License
# =============================================================================

set -euo pipefail

if [ -t 1 ]; then
  GREEN=$'\033[1;32m'; BLUE=$'\033[1;34m'; YELLOW=$'\033[1;33m'
  RED=$'\033[1;31m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=""; BLUE=""; YELLOW=""; RED=""; BOLD=""; RESET=""
fi

# -------- Configuration & defaults ------------------------------------------
MODE="${1:-app}"
shift || true

# Catch --help/-h passed before the mode argument
if [[ "$MODE" == "--help" || "$MODE" == "-h" ]]; then
  sed -n '5,32p' "$0" | sed 's/^# \?//'
  exit 0
fi

REPO="rgdi/m-nexus"
INSTALL_VERSION="${INSTALL_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.mnexus}"
INSTALL_PORT_BACK="${INSTALL_PORT_BACK:-4100}"
INSTALL_PORT_FRONT="${INSTALL_PORT_FRONT:-8080}"
INSTALL_DOMAIN="${INSTALL_DOMAIN:-localhost}"
INSTALL_AUTO_RUN="${INSTALL_AUTO_RUN:-1}"
INSTALL_KEEP_ZIPS="${INSTALL_KEEP_ZIPS:-0}"
INSTALL_NO_DEPS="${INSTALL_NO_DEPS:-0}"
INSTALL_FULL="${INSTALL_FULL:-0}"
SKIP_BG=0
SHOW_HELP=0

# -------- Logging ----------------------------------------------------------
log() { printf "%s▸%s %s\n" "$BLUE" "$RESET" "$1"; }
ok()  { printf "%s✔%s %s\n" "$GREEN" "$RESET" "$1"; }
err() { printf "%s✘%s %s\n" "$RED" "$RESET" "$1" >&2; }

# -------- Argument parsing -------------------------------------------------
shift_count=0
# Look for --help|-h early in any position
for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    sed -n '5,32p' "$0" | sed 's/^# \?//'
    exit 0
  fi
done

while [[ $# -gt 0 ]]; do
  case "$1" in
    app|server|deploy) MODE="$1" ;;
    --port)            shift; INSTALL_PORT_FRONT="$1" ;;
    --backend-port)    shift; INSTALL_PORT_BACK="$1" ;;
    --dir)             shift; INSTALL_DIR="$1" ;;
    --version|--release) shift; INSTALL_VERSION="$1" ;;
    --domain)          shift; INSTALL_DOMAIN="$1" ;;
    --foreground)      INSTALL_AUTO_RUN="0" ;;
    --keep-zips)       INSTALL_KEEP_ZIPS="1" ;;
    --no-deps)         INSTALL_NO_DEPS="1" ;;
    --no-bg)           SKIP_BG=1 ;;
    --full)            INSTALL_FULL=1 ;;
    --help|-h)         SHOW_HELP=1 ;;
    *) err "Opción desconocida: $1"; exit 1 ;;
  esac
  shift
done

if [[ "$SHOW_HELP" == "1" ]]; then
  sed -n '5,32p' "$0" | sed 's/^# \?//'
  exit 0
fi

# Normalize "latest" to a concrete version via GitHub API
if [[ "$INSTALL_VERSION" == "latest" ]]; then
  log "Resolviendo la última versión publicada…"
  INSTALL_VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
    | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/' || true)
  [[ -n "$INSTALL_VERSION" ]] || { err "No pude resolver la última versión."; exit 1; }
  ok "Última versión: $INSTALL_VERSION"
fi
TAG="${INSTALL_VERSION}"

# -------- OS detection ----------------------------------------------------
uname_s=$(uname -s 2>/dev/null || echo "Linux")
case "$uname_s" in
  Darwin) OS="mac" ;;
  Linux)
    if [[ -f /etc/os-release ]]; then
      . /etc/os-release
      OS_ID="${ID:-debian}"
      case "$OS_ID" in
        ubuntu|debian|linuxmint|pop) OS="ubuntu" ;;
        arch|manjaro)               OS="arch" ;;
        rhel|centos|rocky|fedora)   OS="rhel" ;;
        *)                          OS="linux" ;;
      esac
    else
      OS="linux"
    fi
    ;;
  *) err "SO no soportado: $uname_s"; exit 1 ;;
esac
log "Sistema detectado: $OS"

# -------- Tool checks ----------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { err "Falta $1. Instálalo o usa otra versión."; exit 1; }; }

curl --version >/dev/null 2>&1 || need curl
tar --version >/dev/null 2>&1 || need tar
sha256sum --version >/dev/null 2>&1 2>&1 || shasum --help >/dev/null 2>&1 || { err "Falta sha256sum/shasum"; exit 1; }

# -------- Helper for resolving release-vs-archive assets -----------------
need_asset() {
  local pattern="$1"
  local url
  # GET (not HEAD; some proxies strip HEAD). Looking at the redirect target.
  url=$(curl -sIL "https://github.com/$REPO/releases/download/$TAG/$pattern" 2>/dev/null | grep -i "^location:" | grep -oE 'https?://[^[:space:]"]+' | tail -1 | tr -d '\r\n' || true)
  if [[ -n "$url" ]]; then echo "$url"; return 0; fi
  return 1
}

# Extract a ZIP into a target dir.
extract() {
  local url="$1" out="$2"
  local friendly="${3:-$(basename "$url")}"
  mkdir -p "$out"
  local tmp="$out/../.tmp.$$.zip"
  log "Descargando $friendly…"
  curl -fsSL --retry 3 -o "$tmp" "$url"
  local size
  size=$(stat -c%s "$tmp" 2>/dev/null || stat -f%z "$tmp" 2>/dev/null || echo 0)
  local mb
  if [[ "$size" -ge 1048576 ]]; then
    mb="$(( size / 1048576 )) MB"
  elif [[ "$size" -ge 0 ]]; then
    mb=$(awk -v b="$size" 'BEGIN { printf "%.1f MB", b/1048576 }')
  else
    mb="?"
  fi
  ok "$friendly ($mb)"
  unzip -q -o "$tmp" -d "$out"
  if [[ "$INSTALL_KEEP_ZIPS" == "0" ]]; then rm -f "$tmp" || true; fi
}

# ---- Mode implementations -----------------------------------------------

mode_app() {
  if ! command -v adb >/dev/null 2>&1; then
    log "adb no detectado — solo descargaré el APK. Sigue los pasos a continuación."
  fi

  local apk_url
  if ! apk_url=$(need_asset "m-nexus-${TAG}-debug.apk"); then
    err "APK debug no encontrado en la release $TAG."
    log "Pruebo la lista de assets…"
    apk_url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
      | grep -oE '"browser_download_url":[[:space:]]*"[^"]+\.apk"' | head -1 \
      | sed -E 's/.*"([^"]+)".*/\1/' || true)
  fi
  [[ -n "$apk_url" ]] || { err "No se pudo resolver APK. Compílalo tú con ./scripts/build-android.sh"; exit 1; }

  local target="$INSTALL_DIR/apk"
  mkdir -p "$target"
  extract "$apk_url" "$target" "m-nexus-${TAG}-debug.apk"

  local apk_file
  apk_file=$(find "$target" -name '*.apk' -type f | head -1 || true)
  if [[ -z "$apk_file" ]]; then
    err "Descargado pero no encontré el .apk en $target"
    exit 1
  fi

  cat <<INSTALL

${BOLD}M-NEXUS APK descargado${RESET}
  ${GREEN}$apk_file${RESET}

${BOLD}Instalación USB (ADB):${RESET}
  ${BOLD}adb install -r "$apk_file"${RESET}

${BOLD}Instalación directa en el teléfono (Android 11+):${RESET}
  1. Transfiere el .apk al móvil vía USB, Drive, email, etc.
  2. Abrelo desde el explorador de archivos.
  3. Cuando pregunte, activa "Fuentes desconocidas" para tu app de archivos.

${BOLD}Si necesitas build firmado:${RESET} instala Java 17+ + Android SDK y corre:
  cd /tmp && curl -sL https://github.com/$REPO/archive/${TAG}.tar.gz | tar -xz
  cd m-nexus-${TAG#v}/android && ./gradlew assembleRelease
INSTALL
}

mode_server() {
  need node
  need npm

  local backend_url=""
  if ! backend_url=$(need_asset "m-nexus-backend-${TAG}.zip"); then
    err "Backend ZIP no encontrado en la release $TAG."
    exit 1
  fi

  local target="$INSTALL_DIR"
  mkdir -p "$target"
  extract "$backend_url" "$target/backend" "m-nexus-backend-${TAG}.zip"

  log "Instalando dependencias backend…"
  if ! (cd "$target/backend" && npm ci --omit=dev --silent --no-audit --no-fund 2>/dev/null); then
    log "npm ci falló (lockfile desincronizado). Probando npm install."
    (cd "$target/backend" && npm install --omit=dev --silent --no-audit --no-fund) || {
      err "npm install falló. ¿Hay red activa?"
      exit 1
    }
  fi
  ok "Dependencias backend instaladas"

  cat > "$target/run-server.sh" <<EOF
#!/usr/bin/env bash
set -e
export JWT_SECRET="\${JWT_SECRET:-change-me-please-secret-strong}"
export PORT="$INSTALL_PORT_BACK"
exec node "$target/backend/dist/server.js"
EOF
  chmod +x "$target/run-server.sh"

  if [[ "$INSTALL_FULL" == "1" ]]; then
    log "Modo --full: también descargaré el bundle webview en $target/public"
    if webview_url=$(need_asset "m-nexus-webview-${TAG}.zip"); then
      extract "$webview_url" "$target/public" "m-nexus-webview-${TAG}.zip"
    else
      log "Webview no disponible, saltando."
    fi
  fi

  if [[ "$SKIP_BG" == "0" && "$INSTALL_AUTO_RUN" == "1" ]]; then
    log "Lanzando backend en background…"
    mkdir -p "$INSTALL_DIR/logs"
    nohup "$target/run-server.sh" >"$INSTALL_DIR/logs/server.log" 2>&1 &
    echo $! > "$INSTALL_DIR/server.pid"
    sleep 4
    if curl -s "http://localhost:$INSTALL_PORT_BACK/api/v1/health" >/dev/null 2>&1; then
      ok "Backend escuchando en http://localhost:$INSTALL_PORT_BACK"
    else
      err "Backend no responde. Revisa $INSTALL_DIR/logs/server.log"
    fi
  fi

  cat <<SERVER

${BOLD}Backend instalado en${RESET} ${GREEN}$INSTALL_DIR/backend${RESET}
${BOLD}Script de arranque${RESET}   ${GREEN}$INSTALL_DIR/run-server.sh${RESET}
${BOLD}Log${RESET}                  $INSTALL_DIR/logs/server.log
${BOLD}PID${RESET}                  $(cat "$INSTALL_DIR/server.pid" 2>/dev/null || echo "no lanzado")

${BOLD}Para arrancarlo en foreground:${RESET}
  $INSTALL_DIR/run-server.sh

${BOLD}Para pararlo:${RESET}
  kill \$(cat $INSTALL_DIR/server.pid 2>/dev/null) 2>/dev/null
SERVER
}

mode_deploy() {
  local webview_url=""
  if ! webview_url=$(need_asset "m-nexus-webview-${TAG}.zip"); then
    err "Webview bundle no encontrado en la release $TAG."
    exit 1
  fi

  local target="$INSTALL_DIR/web"
  mkdir -p "$target"
  extract "$webview_url" "$target" "m-nexus-webview-${TAG}.zip"

  if [[ -d /var/www/html && -w /var/www/html ]]; then
    log "/var/www/html detectado y writable — copiaré el bundle allí."
    cp -r "$target"/. /var/www/html/
    ok "Desplegado en /var/www/html. Accede vía ${BOLD}$INSTALL_DOMAIN${RESET}"
    return
  fi

  log "Iniciando http.server en background en puerto $INSTALL_PORT_FRONT…"
  if [[ "$SKIP_BG" == "0" ]]; then
    nohup python3 -m http.server "$INSTALL_PORT_FRONT" --directory "$target" \
      > "$INSTALL_DIR/web.log" 2>&1 &
    echo $! > "$INSTALL_DIR/web.pid"
    sleep 2
    if curl -s "http://localhost:$INSTALL_PORT_FRONT/" >/dev/null 2>&1; then
      ok "Sirviendo en http://localhost:$INSTALL_PORT_FRONT"
    fi
  fi

  cat <<DEPLOY

${BOLD}Bundle extraído en${RESET} ${GREEN}$target${RESET}

${BOLD}Para servirlo manualmente:${RESET}
  cd "$target" && python3 -m http.server $INSTALL_PORT_FRONT

${BOLD}Para Nginx:${RESET} copia el contenido de $target a /var/www/html/ y
añade esta entrada en /etc/nginx/sites-available/default:
  root ${target};
  location / { try_files \$uri \$uri/ /index.html; }

${BOLD}Para parar el http.server:${RESET}
  kill \$(cat $INSTALL_DIR/web.pid 2>/dev/null) 2>/dev/null
DEPLOY
}

# -------- Dispatch --------------------------------------------------------
log "Modo: $MODE · Versión: $TAG · Destino: $INSTALL_DIR"
case "$MODE" in
  app)     mode_app     ;;
  server)  mode_server  ;;
  deploy)  mode_deploy  ;;
  *)       err "Modo desconocido: $MODE"; exit 1 ;;
esac

ok "Instalación completada."
