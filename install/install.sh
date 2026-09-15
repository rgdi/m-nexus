#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
#  M-NEXUS — one-line installer (v2.1.5)
#  Uso:
#    curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash
#
#  Opciones:
#    --port=4100            puerto del backend (default: 4100)
#    --data=/var/lib/mnexus  directorio de datos (default: ./data)
#    --no-systemd           no instalar como servicio systemd
#    --update               actualizar instalación existente
#    --help                 ayuda
#
#  Detecta el OS (Linux/macOS/Docker) y el gestor de paquetes, instala
#  Node 22 si falta, descarga el webview bundle, e inicia los servicios.
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

VERSION="2.1.5"
REPO="rgdi/m-nexus"
BRANCH="main"
INSTALL_DIR="${MNEXUS_HOME:-$HOME/.mnexus}"
PORT="${MNEXUS_PORT:-4100}"
DATA_DIR="$INSTALL_DIR/data"
USE_SYSTEMD=1
DO_UPDATE=0
LOG="$INSTALL_DIR/install.log"

# ───── colors ─────
if [ -t 1 ]; then
  B="\033[1m"; G="\033[1;32m"; Y="\033[1;33m"; R="\033[1;31m"; C="\033[1;36m"; N="\033[0m"
else
  B=""; G=""; Y=""; R=""; C=""; N=""
fi

# ───── arg parsing ─────
for arg in "$@"; do
  case "$arg" in
    --port=*)    PORT="${arg#*=}" ;;
    --data=*)    DATA_DIR="${arg#*=}" ;;
    --no-systemd) USE_SYSTEMD=0 ;;
    --update)    DO_UPDATE=1 ;;
    --help|-h)
      sed -n '2,17p' "$0"
      exit 0 ;;
    *) echo -e "${R}Unknown argument: $arg${N}"; exit 2 ;;
  esac
done

# ───── helpers ─────
log()    { printf "${C}[%s]${N} %s\n" "$(date +%H:%M:%S)" "$*" | tee -a "$LOG" ; }
ok()     { printf "${G}✓${N} %s\n" "$*" | tee -a "$LOG" ; }
warn()   { printf "${Y}!${N} %s\n" "$*" | tee -a "$LOG" ; }
err()    { printf "${R}✗${N} %s\n" "$*" | tee -a "$LOG" ; exit 1 ; }
hdr()    { printf "\n${B}${C}━━━ %s ━━━${N}\n" "$*" | tee -a "$LOG" ; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || err "missing command: $1"; }

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Linux*)  OS="linux" ;;
    Darwin*) OS="macos" ;;
    *)       err "unsupported OS: $(uname -s)" ;;
  esac
}

# Detect package manager (best effort)
detect_pkg_mgr() {
  if command -v apt-get >/dev/null; then PKG="apt"
  elif command -v dnf >/dev/null;     then PKG="dnf"
  elif command -v yum >/dev/null;     then PKG="yum"
  elif command -v apk >/dev/null;     then PKG="apk"
  elif command -v brew >/dev/null;    then PKG="brew"
  else PKG="none"
  fi
}

# Detect init system
detect_init() {
  if [ "$USE_SYSTEMD" = "0" ]; then INIT="none"; return; fi
  if command -v systemctl >/dev/null && pidof systemd >/dev/null 2>&1; then
    INIT="systemd"
  elif [ -d /etc/init.d ] && [ "$OS" = "linux" ]; then
    INIT="sysvinit"
  else
    INIT="none"
  fi
}

# Install Node.js 22 if missing
install_node() {
  if command -v node >/dev/null; then
    local v; v="$(node -v 2>/dev/null | sed 's/^v//')"
    local major; major="${v%%.*}"
    if [ "${major:-0}" -ge 22 ]; then
      ok "Node.js v$v already installed"
      return
    fi
    warn "Node.js v$v < 22 — upgrading"
  fi
  log "Installing Node.js 22..."
  case "$PKG" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
      sudo apt-get install -y nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - >/dev/null
      sudo "$PKG" install -y nodejs
      ;;
    apk)
      sudo apk add --no-cache nodejs npm
      ;;
    brew)
      brew install node@22
      ;;
    *)
      warn "no package manager — assuming Node already installed"
      ;;
  esac
  ok "Node.js $(node -v) installed"
}

# Check ports
check_port() {
  local p="$1"
  if command -v ss >/dev/null; then
    if ss -tln 2>/dev/null | grep -q ":$p "; then
      warn "port $p already in use — assuming another service"
    fi
  fi
}

# Fetch latest release tag from GitHub
fetch_latest_tag() {
  if command -v curl >/dev/null; then
    curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
      | grep '"tag_name":' | head -1 | sed -E 's/.*"([^"]+)".*/\1/' \
      || echo ""
  else
    echo ""
  fi
}

# Download release artifact
download_release() {
  local tag="$1"
  local tmp; tmp="$(mktemp -d)"
  log "Downloading M-NEXUS $tag..."
  # Try backend + webview bundle from latest release
  local base="https://github.com/$REPO/releases/download/$tag"
  curl -fsSL "$base/m-nexus-backend.zip" -o "$tmp/backend.zip" \
    || err "could not download backend ZIP"
  curl -fsSL "$base/m-nexus-webview.zip" -o "$tmp/webview.zip" \
    || err "could not download webview bundle"
  # v2.1.5+ W3: SHA256SUMS verification (supply-chain hardening)
  # Releases publish SHA256SUMS.txt with one <sha>  per line.
  # If the file is missing, we warn but don't fail (back-compat with older releases).
  if curl -fsSL "$base/SHA256SUMS.txt" -o "$tmp/SHA256SUMS.txt" 2>/dev/null; then
    log "Verifying SHA256SUMS..."
    if command -v sha256sum >/dev/null; then
      (cd "$tmp" && sha256sum -c --strict SHA256SUMS.txt) \
        || err "SHA256SUMS verification failed — refusing to install"
      ok "SHA256SUMS verified"
    elif command -v shasum >/dev/null; then
      (cd "$tmp" && shasum -a 256 -c SHA256SUMS.txt) \
        || err "SHA256SUMS verification failed — refusing to install"
      ok "SHA256SUMS verified"
    else
      warn "no sha256sum/shasum available — skipping verification"
    fi
  else
    warn "no SHA256SUMS.txt in release — skipping verification (older release?)"
  fi
  ok "Downloaded $tag ($(du -h "$tmp/backend.zip" | cut -f1) + $(du -h "$tmp/webview.zip" | cut -f1))"
  echo "$tmp"
}

# Install from GitHub (default)
install_from_github() {
  local tag="$1"
  local tmp; tmp="$(download_release "$tag")"
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  unzip -q -o "$tmp/backend.zip" -d backend/
  unzip -q -o "$tmp/webview.zip" -d webview/
  rm -rf "$tmp"
  ok "Installed to $INSTALL_DIR"
}

# Install from local checkout (when run from repo)
install_from_local() {
  log "Installing from local checkout..."
  local src; src="$(cd "$(dirname "$0")/.." && pwd)"
  mkdir -p "$INSTALL_DIR"
  # Build backend
  cd "$src/backend"
  log "Building backend..."
  npm ci --no-audit --no-fund >/dev/null 2>&1
  npx tsc
  mkdir -p "$INSTALL_DIR/backend/deploy"
  cp -r dist package.json "$INSTALL_DIR/backend/deploy/"
  # Build webview
  log "Building webview bundle..."
  bash "$src/scripts/build_webview.sh" /tmp/mnexus-bundle >/dev/null
  mkdir -p "$INSTALL_DIR/webview"
  cp -r /tmp/mnexus-bundle/* "$INSTALL_DIR/webview/"
  ok "Built and installed from local checkout"
}

# systemd unit
write_systemd_unit() {
  local unit="$INSTALL_DIR/mnexus-backend.service"
  cat > "$unit" <<EOF
[Unit]
Description=M-NEXUS backend
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$INSTALL_DIR/backend/deploy
ExecStart=$(command -v node) $INSTALL_DIR/backend/deploy/dist/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$DATA_DIR
Environment=JWT_SECRET=$JWT_SECRET
StandardOutput=append:$INSTALL_DIR/backend.log
StandardError=append:$INSTALL_DIR/backend.log

[Install]
WantedBy=multi-user.target
EOF
  if [ "$USE_SYSTEMD" = "1" ] && [ "$INIT" = "systemd" ]; then
    sudo cp "$unit" /etc/systemd/system/mnexus-backend.service
    sudo systemctl daemon-reload
    sudo systemctl enable mnexus-backend
    sudo systemctl start mnexus-backend
    ok "systemd unit installed and started"
  else
    warn "systemd unit saved to $unit (not installed)"
  fi
}

# Print success
print_banner() {
  cat <<EOF

${G}${B}
  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃                                                ┃
  ┃   M-NEXUS installed successfully!             ┃
  ┃                                                ┃
  ┃   URL:        http://localhost:$PORT           ┃
  ┃   Data:       $DATA_DIR            ┃
  ┃   Logs:       tail -f $LOG          ┃
  ┃                                                ┃
  ┃   Open http://localhost:$PORT in your browser  ┃
  ┃   to start the setup wizard.                   ┃
  ┃                                                ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
${N}

${B}Next steps:${N}
  ${C}1.${N} Open ${B}http://localhost:$PORT${N} in your browser
  ${C}2.${N} Follow the setup wizard (slides)
  ${C}3.${N} Create your first subject
  ${C}4.${N} Add notes, flashcards, schedule exams

${B}Useful commands:${N}
  ${C}•${N} Restart:   ${B}sudo systemctl restart mnexus-backend${N} (or: ${B}mnexus restart${N})
  ${C}•${N} Logs:       ${B}tail -f $INSTALL_DIR/backend.log${N}
  ${C}•${N} Update:     ${B}curl ... | bash -s -- --update${N}
  ${C}•${N} Uninstall:  ${B}bash $INSTALL_DIR/uninstall.sh${N}

EOF
}

# ───── main ─────
mkdir -p "$INSTALL_DIR"
log "M-NEXUS $VERSION installer started"
log "  install_dir=$INSTALL_DIR  port=$PORT  data=$DATA_DIR"
hdr "Detecting environment"
detect_os
log "OS: $OS"
detect_pkg_mgr
log "Package manager: $PKG"
detect_init
log "Init system: $INIT"
check_port "$PORT"

hdr "Checking prerequisites"
need_cmd curl
need_cmd unzip
install_node
need_cmd npm

# v2.1.5: generate JWT_SECRET if not provided (fail-fast on weak in config.ts)
if [ -z "${JWT_SECRET:-}" ]; then
  if command -v openssl >/dev/null; then
    export JWT_SECRET="$(openssl rand -hex 32)"
    log "Generated JWT_SECRET (32 bytes)"
  else
    err "JWT_SECRET not set and openssl not available. Set it via: export JWT_SECRET=...; or pass --jwt-secret=..."
  fi
fi

hdr "Installing M-NEXUS"
# Decide source: local if running from repo, else download
if [ -f "$(dirname "$0")/../package.json" ] || [ -f "$(dirname "$0")/../backend/package.json" ]; then
  install_from_local
else
  TAG="${MNEXUS_VERSION:-$(fetch_latest_tag)}"
  if [ -z "$TAG" ]; then
    warn "could not detect latest tag, using v$VERSION"
    TAG="v$VERSION"
  fi
  log "Latest version: $TAG"
  install_from_github "$TAG"
fi

# Initialize data dir if empty
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/subjects.json" ]; then
  log "Initializing empty data store..."
  echo "[]" > "$DATA_DIR/subjects.json"
  echo "[]" > "$DATA_DIR/notes.json"
  echo "[]" > "$DATA_DIR/events.json"
  echo "[]" > "$DATA_DIR/tasks.json"
  echo "[]" > "$DATA_DIR/flashcards.json"
  ok "Data store initialized"
fi

# Write uninstall script
cat > "$INSTALL_DIR/uninstall.sh" <<EOF
#!/usr/bin/env bash
echo "Uninstalling M-NEXUS..."
sudo systemctl stop mnexus-backend 2>/dev/null || true
sudo systemctl disable mnexus-backend 2>/dev/null || true
sudo rm -f /etc/systemd/system/mnexus-backend.service
sudo systemctl daemon-reload 2>/dev/null || true
pkill -9 -f "node.*dist/server.js" 2>/dev/null || true
rm -rf "$INSTALL_DIR"
echo "Done."
EOF
chmod +x "$INSTALL_DIR/uninstall.sh"

# Write small CLI helper
mkdir -p "$INSTALL_DIR/bin"
cat > "$INSTALL_DIR/bin/mnexus" <<'EOF'
#!/usr/bin/env bash
INSTALL_DIR="${MNEXUS_HOME:-$HOME/.mnexus}"
case "${1:-}" in
  start)   sudo systemctl start mnexus-backend 2>/dev/null || nohup node "$INSTALL_DIR/backend/deploy/dist/server.js" > "$INSTALL_DIR/backend.log" 2>&1 & ;;
  stop)    sudo systemctl stop mnexus-backend 2>/dev/null || pkill -9 -f "dist/server.js" ;;
  restart) sudo systemctl restart mnexus-backend 2>/dev/null || { pkill -9 -f "dist/server.js"; sleep 1; nohup node "$INSTALL_DIR/backend/deploy/dist/server.js" > "$INSTALL_DIR/backend.log" 2>&1 & } ;;
  status)  sudo systemctl status mnexus-backend 2>/dev/null || (curl -fs "http://localhost:4100/health" >/dev/null && echo "running") || echo "stopped" ;;
  logs)    tail -f "$INSTALL_DIR/backend.log" ;;
  update)  curl -fsSL "https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh" | bash -s -- --update ;;
  uninstall) bash "$INSTALL_DIR/uninstall.sh" ;;
  *) echo "mnexus {start|stop|restart|status|logs|update|uninstall}"; exit 1 ;;
esac
EOF
chmod +x "$INSTALL_DIR/bin/mnexus"
ln -sf "$INSTALL_DIR/bin/mnexus" /usr/local/bin/mnexus 2>/dev/null || true

hdr "Starting service"
if [ "$INIT" = "systemd" ]; then
  write_systemd_unit
elif [ "$DO_UPDATE" = "1" ]; then
  log "Updating: killing old process and starting new one..."
  pkill -9 -f "dist/server.js" 2>/dev/null || true
  sleep 1
  nohup node "$INSTALL_DIR/backend/deploy/dist/server.js" > "$INSTALL_DIR/backend.log" 2>&1 &
  ok "Backend started, PID=$!"
else
  log "Starting backend in background..."
  nohup node "$INSTALL_DIR/backend/deploy/dist/server.js" > "$INSTALL_DIR/backend.log" 2>&1 &
  ok "Backend started, PID=$!"
fi

hdr "Health check"
sleep 2
for i in 1 2 3 4 5; do
  if curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1; then
    ok "Backend responding on http://localhost:$PORT"
    break
  fi
  sleep 1
done

# Save install info
cat > "$INSTALL_DIR/.install" <<EOF
version=$VERSION
tag=$(fetch_latest_tag 2>/dev/null || echo "unknown")
installed_at=$(date -Iseconds 2>/dev/null || date)
data_dir=$DATA_DIR
port=$PORT
EOF

print_banner
