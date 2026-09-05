#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# M-NEXUS — Instalador Universal (v0.33+)
# ═══════════════════════════════════════════════════════════════════
#
# Uso rápido (un comando):
#   curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash
#
# Etiquetas / componentes:
#   --component=backend   Solo backend
#   --component=plugin    Solo plugin de Obsidian
#   --component=companion Solo companion app de Android
#   --component=all       Los tres (default)
#
# Modos:
#   (default)              Instalar (idempotente)
#   --update               Actualizar a la última versión
#   --rollback             Volver a la versión anterior
#   --uninstall            Desinstalar
#   --version=v0.32.0      Versión específica a instalar
#   --tag=stable           Canal stable (default) | beta | nightly
#   --auto                 Modo no interactivo (usa defaults)
#   --help                 Mostrar esta ayuda
#
# Ejemplos:
#   # Instalar todo (interactive)
#   curl -fsSL .../install.sh | bash
#
#   # Solo backend, modo automático
#   curl -fsSL .../install.sh | bash -s -- --component=backend --auto
#
#   # Versión específica, sin preguntas
#   curl -fsSL .../install.sh | bash -s -- --version=v0.32.0 --auto
#
#   # Actualizar
#   curl -fsSL .../install.sh | bash -s -- --update --auto
#
#   # Rollback
#   curl -fsSL .../install.sh | bash -s -- --rollback --auto
#
# Requisitos: bash 4+, curl, sudo o root

set -euo pipefail

# ─── Constantes ───────────────────────────────────────────────────
readonly SCRIPT_NAME="M-NEXUS Installer"
readonly SCRIPT_VERSION="0.36.0"
readonly REPO_OWNER="rgdi"
readonly REPO_NAME="m-nexus"
readonly GITHUB_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
readonly DEFAULT_TAG="stable"
readonly COMPATIBLE_PLUGIN_MIN="0.8.0"
readonly COMPATIBLE_COMPANION_MIN="0.28.0"
readonly COMPATIBLE_BACKEND_MIN="0.28.0"
readonly MIN_RAM_MB=512
readonly RECOMMENDED_RAM_MB=2048
readonly MIN_DISK_MB=2048
readonly DEFAULT_PORT=4000
readonly BACKUP_DIR="/var/backups/mnexus"
readonly ROLLBACK_LIMIT=3   # cuántas versiones anteriores guardar

# ─── Estado (poblado por parse_args + run) ──────────────────────
COMPONENT="all"
MODE="install"
VERSION=""
TAG="$DEFAULT_TAG"
AUTO=false
DRY_RUN=false
TARGET_DIR="/opt/mnexus"
SERVICE_NAME="mnexus"
LOG_FILE="/tmp/mnexus-install.log"

# ─── Colores ────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
    C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
    C_BLUE=$'\033[34m'; C_MAGENTA=$'\033[35m'; C_CYAN=$'\033[36m'
else
    C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""
    C_YELLOW=""; C_BLUE=""; C_MAGENTA=""; C_CYAN=""
fi

# ─── Logging ─────────────────────────────────────────────────────
log()   { printf "%b[m-nexus]%b %s\n" "$C_BLUE" "$C_RESET" "$*" >&2; }
ok()    { printf "%b[✓]%b %s\n" "$C_GREEN" "$C_RESET" "$*" >&2; }
warn()  { printf "%b[!]%b %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()   { printf "%b[✗]%b %s\n" "$C_RED" "$C_RESET" "$*" >&2; }
ask()   { local p="${1}"; local d="${2:-}"; local a; if [[ "$AUTO" == true ]]; then a="$d"; log "(auto) $p [$a]"; else read -rp "$(printf '%b[?]%b %s [%s]: ' "$C_CYAN" "$C_RESET" "$p" "$d")" a; fi; printf '%s' "$a"; }
section() { printf "\n%b━━━ %s ━━━%b\n" "$C_BOLD" "$*" "$C_RESET" >&2; }
# Escribe también al log
exec 2> >(tee -a "$LOG_FILE" >&2)

# ─── OS Detection ───────────────────────────────────────────────
detect_os() {
    UNAME_S=$(uname -s 2>/dev/null || echo "Linux")
    case "$UNAME_S" in
        Linux*)
            if [[ -f /etc/os-release ]]; then
                . /etc/os-release
                OS_FAMILY="${ID:-linux}"
                OS_VERSION="${VERSION_ID:-unknown}"
            else
                OS_FAMILY="linux"
                OS_VERSION="unknown"
            fi
            PKG_MANAGER=""
            if command -v apt-get &>/dev/null; then PKG_MANAGER="apt"; fi
            if command -v dnf &>/dev/null; then PKG_MANAGER="dnf"; fi
            if command -v yum &>/dev/null; then PKG_MANAGER="yum"; fi
            if command -v pacman &>/dev/null; then PKG_MANAGER="pacman"; fi
            if command -v apk &>/dev/null; then PKG_MANAGER="apk"; fi
            ;;
        Darwin*) OS_FAMILY="macos"; OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo unknown)"; PKG_MANAGER="brew" ;;
        *) OS_FAMILY="unknown"; OS_VERSION="unknown"; PKG_MANAGER="" ;;
    esac
}

# ─── System requirements ────────────────────────────────────────
check_requirements() {
    section "Verificando requisitos del sistema"
    AVAILABLE_RAM_MB=$(( $(vm_stat 2>/dev/null | awk '/free/ {gsub(/\./,"",$3); print $3*4096/1048576}' || echo 0) ))
    if [[ "$OS_FAMILY" == "linux" ]]; then
        AVAILABLE_RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
    fi
    if [[ "$AVAILABLE_RAM_MB" -lt "$MIN_RAM_MB" ]]; then
        err "RAM insuficiente: ${AVAILABLE_RAM_MB}MB (mínimo: ${MIN_RAM_MB}MB)"
        exit 1
    fi
    AVAILABLE_DISK_MB=$(df -m "$TARGET_DIR" 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
    if [[ "$AVAILABLE_DISK_MB" -lt "$MIN_DISK_MB" ]]; then
        err "Disco insuficiente: ${AVAILABLE_DISK_MB}MB (mínimo: ${MIN_DISK_MB}MB)"
        exit 1
    fi
    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        err "Necesito curl o wget instalado"
        exit 1
    fi
    if ! command -v node &>/dev/null; then
        warn "Node no está instalado. El backend lo necesita (>= 22)."
        if [[ "$AUTO" == false ]] && [[ "$PKG_MANAGER" == "apt" ]]; then
            if ask "¿Instalar Node.js ahora? (s/N)" "N" | grep -qi '^s'; then
                install_node
            fi
        fi
    else
        local node_major; node_major=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
        if [[ "${node_major:-0}" -lt 22 ]]; then
            warn "Node $node_major detectado, se requiere >= 22"
        fi
    fi
    ok "Requisitos OK (RAM: ${AVAILABLE_RAM_MB}MB, disco: ${AVAILABLE_DISK_MB}MB)"
}

install_node() {
    if [[ "$PKG_MANAGER" == "apt" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
    fi
}

# ─── Determinar versión a instalar ─────────────────────────────
resolve_version() {
    section "Resolviendo versión"
    if [[ -n "$VERSION" ]]; then
        log "Versión explícita: $VERSION"
        return
    fi
    if [[ "$TAG" == "stable" ]]; then
        log "Buscando última release estable..."
        VERSION=$(curl -fsSL "${GITHUB_API}/releases/latest" 2>/dev/null | \
            grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
        if [[ -z "$VERSION" ]]; then
            err "No pude obtener la última versión (¿internet?)"
            exit 1
        fi
    elif [[ "$TAG" == "nightly" || "$TAG" == "beta" ]]; then
        VERSION=$(curl -fsSL "${GITHUB_API}/releases?per_page=20" 2>/dev/null | \
            python3 -c "
import json, sys
for r in json.load(sys.stdin):
  if r.get('prerelease', False) and '${TAG}' == 'beta':
    print(r['tag_name'].lstrip('v')); break
  if r.get('prerelease', False) and '${TAG}' == 'nightly':
    print(r['tag_name'].lstrip('v')); break
" 2>/dev/null || echo "")
        if [[ -z "$VERSION" ]]; then
            err "No hay release en canal $TAG"
            exit 1
        fi
    fi
    ok "Versión objetivo: v$VERSION"
}

# ─── Listar versiones (para rollback) ──────────────────────────
list_versions() {
    curl -fsSL "${GITHUB_API}/releases?per_page=20" 2>/dev/null | \
        python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data:
  pre = '[pre]' if r.get('prerelease') else ''
  print(f\"  v{r['tag_name'].lstrip('v')}  {pre}  {r.get('published_at','')[:10]}  {r.get('name','')}\")
"
}

# ─── Descargar asset de un release ─────────────────────────────
download_asset() {
    local component="$1"
    local version="$2"
    local out_path="$3"
    local asset_name
    case "$component" in
        backend) asset_name="m-nexus-backend-v${version}.zip" ;;
        plugin)  asset_name="m-nexus-plugin-v${version}.zip" ;;
        companion) asset_name="m-nexus-companion-v${version}.apk" ;;
        *) err "Componente desconocido: $component"; return 1 ;;
    esac
    local url="${GITHUB_API}/releases/download/v${version}/${asset_name}"
    log "Descargando $asset_name..."
    if [[ "$DRY_RUN" == true ]]; then
        ok "(dry-run) $url -> $out_path"
        return 0
    fi
    if ! curl -fsSL -o "$out_path" "$url"; then
        err "Falló la descarga de $url"
        return 1
    fi
    ok "$asset_name ($(du -h "$out_path" | cut -f1))"
}

# ─── Detectar instalación existente ─────────────────────────────
detect_existing() {
    section "Detectando instalación existente"
    if [[ -d "$TARGET_DIR" ]] && [[ -f "$TARGET_DIR/VERSION" ]]; then
        INSTALLED_VERSION=$(cat "$TARGET_DIR/VERSION" 2>/dev/null || echo "unknown")
        ok "Instalación existente detectada: v$INSTALLED_VERSION"
    else
        INSTALLED_VERSION=""
        log "Sin instalación previa"
    fi
}

# ─── Backup antes de cambios (para rollback) ───────────────────
backup_current() {
    if [[ -z "$INSTALLED_VERSION" ]] || [[ "$DRY_RUN" == true ]]; then
        return 0
    fi
    section "Backup de v$INSTALLED_VERSION para posible rollback"
    local backup_path="${BACKUP_DIR}/v${INSTALLED_VERSION}-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    if [[ -d "$TARGET_DIR" ]]; then
        cp -a "$TARGET_DIR" "$backup_path"
        ok "Backup en $backup_path"
    fi
    # Limpiar backups viejos (mantener últimos ROLLBACK_LIMIT)
    ls -1dt "$BACKUP_DIR"/v* 2>/dev/null | tail -n +$((ROLLBACK_LIMIT + 1)) | xargs -r rm -rf
    log "Backups retenidos: $(ls -1d "$BACKUP_DIR"/v* 2>/dev/null | wc -l)"
}

# ─── Instalar backend ──────────────────────────────────────────
install_backend() {
    local version="$1"
    section "Instalando backend v$version"
    local tmpdir; tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT
    download_asset backend "$version" "$tmpdir/backend.zip" || return 1
    if [[ "$DRY_RUN" == false ]]; then
        mkdir -p "$TARGET_DIR/backend"
        unzip -oq "$tmpdir/backend.zip" -d "$TARGET_DIR/backend"
        cd "$TARGET_DIR/backend"
        # Idempotente: si ya tiene node_modules, no reinstala
        if [[ ! -d "node_modules" ]]; then
            log "Instalando dependencias (puede tardar 1-2 min)..."
            npm ci --omit=dev --no-audit --no-fund
        fi
        cd - >/dev/null
        ok "Backend instalado en $TARGET_DIR/backend"
    fi
    # Service (systemd)
    if [[ "$DRY_RUN" == false ]] && [[ -d /etc/systemd/system ]]; then
        cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=M-NEXUS Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$TARGET_DIR/backend
ExecStart=/usr/bin/node $TARGET_DIR/backend/dist/server.js
Restart=on-failure
RestartSec=5
Environment=PORT=$DEFAULT_PORT
Environment=NODE_ENV=production
EnvironmentFile=-$TARGET_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
        systemctl enable ${SERVICE_NAME}.service 2>/dev/null || true
        systemctl restart ${SERVICE_NAME}.service 2>/dev/null || true
        ok "Systemd service ${SERVICE_NAME}.service registrado"
    fi
}

# ─── Instalar plugin (descarga el ZIP) ─────────────────────────
install_plugin() {
    local version="$1"
    section "Plugin v$version"
    local plugin_dir="$TARGET_DIR/plugin"
    mkdir -p "$plugin_dir"
    if ! download_asset plugin "$version" "$plugin_dir/m-nexus-plugin-v${version}.zip"; then
        warn "No se pudo descargar el plugin. Encontrá la URL de instalación en https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}"
        return 0
    fi

    # v0.36: intentar instalar el plugin directamente en un vault de Obsidian
    # si el usuario pasa --vault=/ruta/al/vault
    local vault_path=""
    for arg in "${CLI_ARGS[@]}"; do
        if [[ "$arg" == --vault=* ]]; then
            vault_path="${arg#--vault=}"
            break
        fi
    done

    # Si no, intentar detectar el vault por defecto (~/.obsidian, ~/Documents, etc.)
    if [[ -z "$vault_path" ]]; then
        local candidate
        for candidate in \
            "$HOME/Documents" \
            "$HOME/Documents/ObsidianVault" \
            "$HOME/ObsidianVault" \
            "$HOME/obsidian" \
            "$HOME/Documents/Notes"; do
            if [[ -d "$candidate" && -d "$candidate/.obsidian" ]]; then
                vault_path="$candidate"
                break
            fi
        done
    fi

    # Si encontramos vault, instalamos directo + activamos
    if [[ -n "$vault_path" && -d "$vault_path" ]]; then
        log "Vault detectado: $vault_path"
        local obsidian_dir="$vault_path/.obsidian"
        local plugins_root="$obsidian_dir/plugins/m-nexus"
        mkdir -p "$plugins_root"
        unzip -oq "$plugin_dir/m-nexus-plugin-v${version}.zip" -d "$plugins_root"

        # v0.36: ACTIVAR el plugin en community-plugins.json
        local comm_file="$obsidian_dir/community-plugins.json"
        if [[ ! -f "$comm_file" ]]; then
            echo '[]' > "$comm_file"
        fi
        # Añadir "m-nexus" si no está
        if command -v jq &>/dev/null; then
            tmp=$(mktemp)
            jq --arg p "m-nexus" '. + [$p] | unique' "$comm_file" > "$tmp" && mv "$tmp" "$comm_file"
        else
            # Fallback sin jq
            if ! grep -q '"m-nexus"' "$comm_file" 2>/dev/null; then
                local content
                content=$(cat "$comm_file")
                if [[ "$content" == "[]" ]]; then
                    echo '["m-nexus"]' > "$comm_file"
                else
                    # Insertar antes del ]
                    sed -i 's/]$/,"m-nexus"]/' "$comm_file"
                fi
            fi
        fi
        ok "Plugin instalado y ACTIVADO en $vault_path"
        ok "Reiniciá Obsidian para que tome el plugin."
    else
        cat > "$plugin_dir/INSTALL.md" <<EOF
# Instalar el plugin v${version} en Obsidian

1. Abrí Obsidian
2. Settings → Community plugins → Restricted mode OFF
3. Clic en el icono de carpeta (abrir vault)
4. Navegá a: \`{vault}/.obsidian/plugins/\`
5. Creá la carpeta \`m-nexus/\` si no existe
6. Descomprimí el ZIP adentro: \`unzip m-nexus-plugin-v${version}.zip -d m-nexus/\`
7. Reiniciá Obsidian
8. Habilitá M-NEXUS en Community plugins
EOF
        ok "Plugin guardado en $plugin_dir/m-nexus-plugin-v${version}.zip"
        ok "Instrucciones en $plugin_dir/INSTALL.md"
        log "💡 Tip: pasá --vault=/ruta/al/vault para que lo instale y active automáticamente"
    fi
}

# ─── Instalar companion (solo descargar APK) ───────────────────
install_companion() {
    local version="$1"
    section "Companion v$version"
    local apk_dir="$TARGET_DIR/companion"
    mkdir -p "$apk_dir"
    if ! download_asset companion "$version" "$apk_dir/m-nexus-companion-v${version}.apk"; then
        return 0
    fi
    cat > "$apk_dir/INSTALL.md" <<EOF
# Instalar el companion v${version} en Android

1. Transferí el APK a tu teléfono (USB, email, Drive, etc.)
2. En el teléfono: Settings → Apps → Special access → Install unknown apps
3. Permitié la instalación desde la app que usaste para transferir
4. Abrí el APK y tocá "Instalar"
5. Si ya tenías una versión anterior, Android debería ofrecerte
   "Actualizar" (mismo certificate de firma)

Download directo desde el teléfono:
  https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/m-nexus-companion-v${version}.apk
EOF
    ok "APK guardado en $apk_dir/m-nexus-companion-v${version}.apk"
    ok "Instrucciones en $apk_dir/INSTALL.md"
}

# ─── Update ─────────────────────────────────────────────────────
do_update() {
    section "Modo: update (v$INSTALLED_VERSION → v$VERSION)"
    backup_current
    install_all_components
    ok "Actualización completa. v$INSTALLED_VERSION -> v$VERSION"
    log "Si algo se rompió: rollback con:"
    log "  curl -fsSL $0 | bash -s -- --rollback --auto"
}

# ─── Rollback ───────────────────────────────────────────────────
do_rollback() {
    section "Modo: rollback"
    if [[ ! -d "$BACKUP_DIR" ]]; then
        err "No hay backups en $BACKUP_DIR"
        exit 1
    fi
    local latest_backup; latest_backup=$(ls -1dt "$BACKUP_DIR"/v* 2>/dev/null | head -1)
    if [[ -z "$latest_backup" ]]; then
        err "No hay backups disponibles"
        exit 1
    fi
    log "Backup más reciente: $latest_backup"
    if [[ "$AUTO" == false ]]; then
        ask "¿Confirmar rollback a este backup? (s/N)" "N" | grep -qi '^s' || { log "Cancelado"; exit 0; }
    fi
    if [[ "$DRY_RUN" == false ]]; then
        # Parar servicios
        if command -v systemctl &>/dev/null; then
            systemctl stop ${SERVICE_NAME}.service 2>/dev/null || true
        fi
        # Restaurar
        rm -rf "$TARGET_DIR"
        cp -a "$latest_backup" "$TARGET_DIR"
        # Reiniciar
        if command -v systemctl &>/dev/null; then
            systemctl start ${SERVICE_NAME}.service 2>/dev/null || true
        fi
        ok "Rollback completo a $(basename "$latest_backup")"
    fi
}

# ─── Uninstall ──────────────────────────────────────────────────
do_uninstall() {
    section "Modo: uninstall"
    if [[ "$AUTO" == false ]]; then
        ask "¿Borrar TODO (incluyendo /opt/mnexus y /var/backups/mnexus)? (s/N)" "N" | grep -qi '^s' || { log "Cancelado"; exit 0; }
    fi
    if command -v systemctl &>/dev/null; then
        systemctl stop ${SERVICE_NAME}.service 2>/dev/null || true
        systemctl disable ${SERVICE_NAME}.service 2>/dev/null || true
        rm -f /etc/systemd/system/${SERVICE_NAME}.service
        systemctl daemon-reload
    fi
    rm -rf "$TARGET_DIR" "$BACKUP_DIR"
    ok "M-NEXUS desinstalado completamente"
}

# ─── Install (idempotente) ──────────────────────────────────────
install_all_components() {
    case "$COMPONENT" in
        all)
            install_backend "$VERSION"
            install_plugin "$VERSION"
            install_companion "$VERSION"
            ;;
        backend) install_backend "$VERSION" ;;
        plugin) install_plugin "$VERSION" ;;
        companion) install_companion "$VERSION" ;;
    esac
    if [[ "$DRY_RUN" == false ]]; then
        echo "$VERSION" > "$TARGET_DIR/VERSION"
    fi
}

# ─── Parse args ─────────────────────────────────────────────────
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --component=*) COMPONENT="${1#*=}" ;;
            --component) COMPONENT="$2"; shift ;;
            --update) MODE="update" ;;
            --rollback) MODE="rollback" ;;
            --uninstall) MODE="uninstall" ;;
            --version=*) VERSION="${1#*=}" ;;
            --version) VERSION="$2"; shift ;;
            --tag=*) TAG="${1#*=}" ;;
            --tag) TAG="$2"; shift ;;
            --auto) AUTO=true ;;
            --dry-run) DRY_RUN=true ;;
            --list-versions) curl -fsSL "${GITHUB_API}/releases?per_page=20" 2>/dev/null | python3 -c "
import json, sys
for r in json.load(sys.stdin):
  pre = '[pre]' if r.get('prerelease') else ''
  print(f\"  v{r['tag_name'].lstrip('v')}  {pre}  {r.get('published_at','')[:10]}  {r.get('name','')}\")
"; exit 0 ;;
            --help|-h)
                sed -n '2,40p' "$0"
                exit 0
                ;;
            *) err "Argumento desconocido: $1. Usá --help"; exit 1 ;;
        esac
        shift
    done
    case "$COMPONENT" in
        all|backend|plugin|companion) ;;
        *) err "Componente inválido: $COMPONENT (usa all|backend|plugin|companion)"; exit 1 ;;
    esac
    case "$TAG" in
        stable|beta|nightly) ;;
        *) err "Canal inválido: $TAG (usa stable|beta|nightly)"; exit 1 ;;
    esac
}

# ─── Verificar compatibilidades (post-install) ──────────────────
check_compat() {
    section "Verificando compatibilidad de versiones"
    log "Versión instalada: v$INSTALLED_VERSION"
    log "Versión backend: v$VERSION (requerida: >= $COMPATIBLE_BACKEND_MIN)"
    log "Versión plugin: v$VERSION (requerida: >= $COMPATIBLE_PLUGIN_MIN)"
    log "Versión companion: v$VERSION (requerida: >= $COMPATIBLE_COMPANION_MIN)"
    # Comparación simple de semver: extrae major.minor.patch
    local v="${VERSION%%.*}"; local v_min="${COMPATIBLE_BACKEND_MIN%%.*}"
    if [[ "$v" -lt "$v_min" ]]; then
        warn "v$VERSION es muy vieja para el backend actual (mínimo $COMPATIBLE_BACKEND_MIN)"
    fi
}

# ─── Banner ─────────────────────────────────────────────────────
banner() {
    cat <<EOF
${C_BOLD}${C_CYAN}
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   M-NEXUS                                                    ║
║   Medical study system for Obsidian                          ║
║                                                              ║
║   Installer v${SCRIPT_VERSION}                                     ║
║   OS: ${OS_FAMILY} ${OS_VERSION}                                     ║
║   Componente: $COMPONENT                                       ║
║   Modo: $MODE                                                 ║
╚══════════════════════════════════════════════════════════════╝
${C_RESET}
EOF
}

# ─── Main ───────────────────────────────────────────────────────
main() {
    parse_args "$@"
    detect_os
    banner
    if [[ "$MODE" == "uninstall" ]]; then
        detect_existing
        do_uninstall
        exit 0
    fi
    check_requirements
    detect_existing
    resolve_version
    if [[ "$MODE" == "rollback" ]]; then
        do_rollback
        exit 0
    fi
    if [[ -n "$INSTALLED_VERSION" ]] && [[ "$INSTALLED_VERSION" == "$VERSION" ]]; then
        ok "v$VERSION ya está instalado. Nada que hacer."
        log "Usá --update para forzar reinstalación o --rollback para volver."
        exit 0
    fi
    if [[ "$MODE" == "update" ]] || [[ -n "$INSTALLED_VERSION" ]]; then
        do_update
    else
        install_all_components
        if [[ "$DRY_RUN" == false ]]; then
            echo "$VERSION" > "$TARGET_DIR/VERSION"
        fi
    fi
    check_compat
    section "✓ M-NEXUS v$VERSION instalado"
    log "Comando útil:"
    log "  mnexus --version"
    log "  mnexus doctor"
    log "Para ver opciones:  $0 --help"
    log "Para actualizar:     $0 --update --auto"
    log "Para rollback:       $0 --rollback --auto"
    log "Para desinstalar:    $0 --uninstall"
}

main "$@"
