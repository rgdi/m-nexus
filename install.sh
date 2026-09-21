#!/usr/bin/env bash
# =============================================================================
# M-NEXUS installer (v2.23.4)
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
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-auto}"  # auto|yes|no
INSTALL_USER="${INSTALL_USER:-${SUDO_USER:-$(whoami)}}"
INSTALL_AUTO_UPGRADE="${INSTALL_AUTO_UPGRADE:-0}"  # opt-in cron job
INSTALL_HEALTHCHECK_HOOK="${INSTALL_HEALTHCHECK_HOOK:-}"
PATH_ORIG="$PATH"
SKIP_BG=0
SHOW_HELP=0
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)

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
    app|server|deploy|docker) MODE="$1" ;;
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
    --systemd)         INSTALL_SYSTEMD="yes" ;;
    --no-systemd)      INSTALL_SYSTEMD="no" ;;
    --user)            shift; INSTALL_USER="$1" ;;
    --auto-upgrade)    INSTALL_AUTO_UPGRADE=1 ;;
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

# -------- SHA256SUMS download (supply-chain verification) -----------------
SUMS_FILE="$INSTALL_DIR/.SHA256SUMS-${TAG}.txt"
if [[ -f "$SUMS_FILE" ]]; then
  ok "Reusando SHA256SUMS cacheado en $SUMS_FILE"
else
  log "Descargando SHA256SUMS para verificación…"
  sums_url=$(curl -sIL "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS.txt" 2>/dev/null \
    | grep -i "^location:" | grep -oE 'https?://[^[:space:]"]+' | tail -1 | tr -d '\r\n' || true)
  if [[ -n "$sums_url" ]]; then
    mkdir -p "$INSTALL_DIR"
    if curl -fsSL --retry 2 -o "$SUMS_FILE.tmp" "$sums_url" 2>/dev/null && [[ -s "$SUMS_FILE.tmp" ]]; then
      mv "$SUMS_FILE.tmp" "$SUMS_FILE"
      ok "SHA256SUMS.txt para $TAG"
    else
      rm -f "$SUMS_FILE.tmp" "$SUMS_FILE" 2>/dev/null || true
      SUMS_FILE=""
      log "SHA256SUMS no disponible — saltando verificación."
    fi
  else
    SUMS_FILE=""
    log "SHA256SUMS no disponible para $TAG — saltando verificación."
  fi
fi



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

# -------- Systemd detection ---------------------------------------------
SYSTEMD_AVAILABLE=0
SYSTEMD_INSTALLED=0
SYSTEMD_SVC_FILE="/etc/systemd/system/mnexus.service"

probe_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    return 1
  fi
  if ! systemctl --version >/dev/null 2>&1; then
    return 1
  fi
  if [[ ! -d "/etc/systemd/system" ]] || [[ ! -w "/etc/systemd/system" ]]; then
    return 1
  fi
  return 0
}

install_systemd_unit() {
  local target="$INSTALL_DIR"
  if ! probe_systemd; then
    log "systemd no disponible o sin permisos — siguiendo con nohup."
    SYSTEMD_AVAILABLE=0
    return 0
  fi
  SYSTEMD_AVAILABLE=1
  log "systemd detectado — creando mnexus.service en $SYSTEMD_SVC_FILE"

  cat > "$SYSTEMD_SVC_FILE" <<EOF
# M-NEXUS systemd unit (auto-generated by install.sh @ $TIMESTAMP)
# v2.23.2 — production service definition.

[Unit]
Description=M-NEXUS Education Service
Documentation=https://github.com/$REPO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$INSTALL_USER
WorkingDirectory=$target/backend
Environment=JWT_SECRET=\${JWT_SECRET}
Environment=PORT=$INSTALL_PORT_BACK
EnvironmentFile=-$target/.env
ExecStart=/usr/bin/env node $target/backend/dist/server.js
Restart=on-failure
RestartSec=5s
WatchdogSec=60
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mnexus
# Hardening (v2.23.2)
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  # .env file with sensible defaults if missing
  if [[ ! -f "$target/.env" ]]; then
    local jwt_secret
    jwt_secret=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
    cat > "$target/.env" <<EOF
# Generated by install.sh on $TIMESTAMP
JWT_SECRET=$jwt_secret
PORT=$INSTALL_PORT_BACK
# Optional: enable NotionLive, Tesseract paths, etc.
# WHISPER_PROVIDER=ollama
# OLLAMA_BASE_URL=http://127.0.0.1:11434
EOF
    chmod 600 "$target/.env"
  fi

  systemctl daemon-reload 2>/dev/null || true
  systemctl enable mnexus.service 2>/dev/null || true
  if systemctl restart mnexus.service 2>/dev/null; then
    sleep 4
    if curl -s "http://localhost:$INSTALL_PORT_BACK/api/v1/health" >/dev/null 2>&1; then
      SYSTEMD_INSTALLED=1
      ok "systemd unit activo (mnexus.service)"
      return 0
    fi
    err "systemd unit creado pero el servicio no responde. Mira: journalctl -u mnexus -n 50"
  else
    err "systemctl restart mnexus.service falló — usando nohup como fallback"
  fi
  return 1
}

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
  # SHA-256 verification. We compute the hash and match against the entry in
  # SHA256SUMS.txt using the *friendly* name (the original ZIP filename).
  local expected="actual_pending"
  if [[ -n "${SUMS_FILE:-}" && -f "${SUMS_FILE}" ]]; then
    expected=$(awk -v f="$friendly" '$2 == f { print $1 }' "$SUMS_FILE" 2>/dev/null || true)
    if [[ -n "$expected" ]]; then
      local actual
      if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$tmp" | awk '{print $1}')
      else
        actual=$(shasum -a 256 "$tmp" | awk '{print $1}')
      fi
      if [[ "$actual" != "$expected" ]]; then
        err "SHA-256 MISMATCH para $friendly"
        err "  esperado: $expected"
        err "  actual:   $actual"
        rm -f "$tmp" || true
        exit 1
      fi
      ok "SHA-256 OK: $friendly"
    else
      log "$friendly no aparece en SHA256SUMS — saltando verificación."
    fi
  fi
  ok "$friendly ($mb)"
  unzip -q -o "$tmp" -d "$out"
  if [[ "$INSTALL_KEEP_ZIPS" == "0" ]]; then rm -f "$tmp" || true; fi
}

# Backward-compatibility: stub for verify_sha (no longer used directly,
# kept in case external callers reference it).
verify_sha() { return 0; }

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

  # Decidir systemd vs nohup
  if [[ "$INSTALL_SYSTEMD" != "no" ]]; then
    install_systemd_unit || {
      log "systemd unit no instalado — fallback a nohup."
    }
  fi

  if [[ "$SKIP_BG" == "0" && "$INSTALL_AUTO_RUN" == "1" && "$SYSTEMD_INSTALLED" == "0" ]]; then
    log "Lanzando backend en background (nohup)…"
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

  if [[ "$SYSTEMD_INSTALLED" == "1" ]]; then
    cat <<SYSD

${BOLD}Systemd unit activo:${RESET} ${GREEN}mnexus.service${RESET}
  ${BOLD}sudo systemctl status mnexus${RESET}
  ${BOLD}sudo systemctl restart mnexus${RESET}
  ${BOLD}sudo journalctl -u mnexus -f${RESET}
SYSD
  fi

  # Opt-in: cron auto-upgrade (sólo si --auto-upgrade)
  if [[ "$INSTALL_AUTO_UPGRADE" == "1" ]]; then
    install_auto_upgrade_cron || log "Auto-upgrade no instalado."
  fi
}

install_auto_upgrade_cron() {
  # Idempotent: si ya existe la línea exacta, skip.
  local cron_line="0 4 * * * /usr/bin/env bash $0 server --version latest --dir $INSTALL_DIR --no-bg --foreground INSTALL_AUTO_UPGRADE=0 > $INSTALL_DIR/logs/auto-upgrade.log 2>&1"
  if command -v crontab >/dev/null 2>&1; then
    local current
    current=$(crontab -l 2>/dev/null || true)
    if echo "$current" | grep -qF "m-nexus-auto-upgrade"; then
      log "Auto-upgrade ya está en crontab."
      return 0
    fi
    local tmp_cron
    tmp_cron=$(mktemp)
    echo "# m-nexus-auto-upgrade (added by install.sh)" > "$tmp_cron"
    echo "$cron_line" >> "$tmp_cron"
    if [[ -n "$current" ]]; then echo "$current" >> "$tmp_cron"; fi
    if crontab "$tmp_cron"; then
      ok "Cron job añadido: auto-upgrade a las 04:00 cada día"
      rm -f "$tmp_cron"
      return 0
    fi
    rm -f "$tmp_cron"
  fi
  log "crontab no disponible — auto-upgrade solo manual."
  return 1
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

mode_docker() {
  need docker
  command -v docker >/dev/null 2>&1 || { err "Docker no instalado."; exit 1; }
  if ! docker info >/dev/null 2>&1; then
    err "Docker instalado pero el daemon no responde. ¿Está corriendo?"
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    err "Docker Compose v2 no encontrado. Instálalo con 'apt install docker-compose-plugin'"
    exit 1
  fi

  local target="$INSTALL_DIR"
  local src_tmp=$(mktemp -d)
  log "Clonando source de $REPO@$TAG (solo Docker bits: Dockerfile + docker-compose.yml + nginx.conf + .env.example)…"

  # Tarball del repo en el tag
  if ! curl -fsSL -o "$src_tmp/repo.tgz" "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz"; then
    err "No pude bajar $TAG.tar.gz"
    exit 1
  fi
  local repo_dir="m-nexus-${TAG#v}"
  mkdir -p "$target"
  tar -xzf "$src_tmp/repo.tgz" -C "$src_tmp"
  if [[ ! -d "$src_tmp/$repo_dir" ]]; then
    err "Tarball no tiene $repo_dir"
    exit 1
  fi

  # Copiamos solo lo necesario para docker-compose
  mkdir -p "$target/public"
  cp "$src_tmp/$repo_dir/Dockerfile" "$target/"
  cp "$src_tmp/$repo_dir/docker-compose.yml" "$target/"
  cp "$src_tmp/$repo_dir/nginx.conf" "$target/"
  cp "$src_tmp/$repo_dir/.env.example" "$target/"
  # Backend source (Dockerfile COPY backend)
  cp -r "$src_tmp/$repo_dir/backend" "$target/"
  cp -r "$src_tmp/$repo_dir/package.json" "$src_tmp/$repo_dir/package-lock.json" "$target/"
  cp "$src_tmp/$repo_dir/tsconfig*.json" "$target/" 2>/dev/null || true

  # Descargamos webview bundle
  if webview_url=$(need_asset "m-nexus-webview-${TAG}.zip"); then
    extract "$webview_url" "$target/public" "m-nexus-webview-${TAG}.zip"
  else
    log "Webview no disponible; el contenedor nginx quedará sin contenido (puedes descargar después con el installer mode deploy)."
  fi

  # .env si no existe
  if [[ ! -f "$target/.env" ]]; then
    cp "$target/.env.example" "$target/.env"
    local jwt_secret
    jwt_secret=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$jwt_secret|" "$target/.env"
    chmod 600 "$target/.env"
    ok ".env generado (JWT_SECRET random)"
  fi

  # Construir y levantar
  log "docker compose build…"
  (cd "$target" && docker compose build m-nexus-backend 2>&1 | tail -5)
  log "docker compose up -d…"
  (cd "$target" && docker compose up -d)
  sleep 6
  if curl -s "http://localhost:8080/api/v1/health" >/dev/null 2>&1; then
    ok "Stack arriba. Health: $(curl -s http://localhost:8080/api/v1/health | head -c 80)..."
  else
    log "El backend puede tardar en estar listo. Reintenta en 10s con:"
    log "  curl http://localhost:8080/api/v1/health"
  fi

  cat <<DOCKER

${BOLD}Stack M-NEXUS desplegado en docker compose.${RESET}

  ${BOLD}cd $target${RESET}
  ${BOLD}docker compose ps${RESET}           # estado de los contenedores
  ${BOLD}docker compose logs -f${RESET}      # logs de los dos servicios
  ${BOLD}docker compose down${RESET}         # parar
  ${BOLD}docker compose pull && docker compose up -d${RESET}  # upgrade

${BOLD}Servicios:${RESET}
  - http://localhost:8080         Frontend (nginx sirve el bundle + proxy a /api)
  - http://localhost:4100 (127.0.0.1) Backend directo (solo debugging)
  - Persistencia: docker volume 'mnexus-data'

${BOLD}Datos persistentes:${RESET} /var/lib/docker/volumes/mnexus-data (en el host)
${BOLD}Backups:${RESET}                /var/lib/docker/volumes/mnexus-backups
DOCKER
}

# -------- Dispatch --------------------------------------------------------
log "Modo: $MODE · Versión: $TAG · Destino: $INSTALL_DIR"
case "$MODE" in
  app)     mode_app     ;;
  server)  mode_server  ;;
  deploy)  mode_deploy  ;;
  docker)  mode_docker  ;;
  *)       err "Modo desconocido: $MODE"; exit 1 ;;
esac

ok "Instalación completada."
