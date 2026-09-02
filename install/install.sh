#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# M-NEXUS Backend v0.28.0 — Instalador Universal
# ═══════════════════════════════════════════════════════════════════
#
# Script único que funciona en Linux, macOS, y WSL.
# Detecta automáticamente el sistema operativo, los recursos del
# servidor (RAM, CPU, disco), y adapta la instalación.
#
# Modos:
#   ./install-mnexus.sh                  → interactivo (wizard)
#   ./install-mnexus.sh --auto           → automático (defaults sensatos)
#   ./install-mnexus.sh --update         → actualizar instalación existente
#   ./install-mnexus.sh --uninstall      → desinstalar
#   ./install-mnexus.sh --help           → ayuda
#
# Requisitos: bash 4+, curl o wget, permisos para instalar paquetes

set -euo pipefail

# ─── Constantes ───────────────────────────────────────────────────
readonly SCRIPT_NAME="M-NEXUS Installer"
readonly APP_VERSION="0.28.0"
readonly MIN_NODE_MAJOR=22
readonly MIN_RAM_MB=512         # mínimo absoluto
readonly RECOMMENDED_RAM_MB=2048 # recomendado para features completas
readonly MIN_DISK_MB=2048
readonly DEFAULT_PORT=4000
readonly DEFAULT_STORAGE="/var/lib/mnexus/backups"
readonly DEFAULT_INDEX="/var/lib/mnexus/backups-index.db"
readonly DEFAULT_MAX_BACKUP_MB=500
readonly LOG_FILE="/tmp/mnexus-install.log"
readonly LOCK_FILE="/tmp/mnexus-install.lock"

# ─── Colores (con fallback si no hay TTY) ───────────────────────
if [[ -t 1 ]]; then
    readonly C_RESET=$'\033[0m'
    readonly C_BOLD=$'\033[1m'
    readonly C_DIM=$'\033[2m'
    readonly C_RED=$'\033[31m'
    readonly C_GREEN=$'\033[32m'
    readonly C_YELLOW=$'\033[33m'
    readonly C_BLUE=$'\033[34m'
    readonly C_MAGENTA=$'\033[35m'
    readonly C_CYAN=$'\033[36m'
else
    readonly C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW=""
    readonly C_BLUE="" C_MAGENTA="" C_CYAN=""
fi

# ─── Variables globales (se llenan durante detección) ─────────────
OS_FAMILY=""         # linux | macos | wsl | other
OS_DISTRO=""         # ubuntu, debian, alpine, ...
OS_VERSION=""
PKG_MANAGER=""       # apt | dnf | yum | apk | brew | pkg
HAS_SYSTEMD=false
HAS_LAUNCHD=false
HAS_DOCKER=false
TOTAL_RAM_MB=0
CPU_CORES=0
FREE_DISK_MB=0
NODE_VERSION=""
NODE_OK=false
NPM_VERSION=""
SERVER_USER=""
SERVER_GROUP=""
SERVER_HOME=""

# Config (llenado por el wizard)
INSTALL_DIR=""
SERVER_PORT=""
STORAGE_PATH=""
INDEX_PATH=""
JWT_SECRET=""
MAX_BACKUP_SIZE=""
BIND_HOST=""
DOMAIN=""
ENABLE_TLS=false
INSTALL_MODE=""        # direct | systemd | launchd | docker
ENABLE_WHISPER=false
ENABLE_OLLAMA=false
ENABLE_TESSERACT=false
ENABLE_NGINX=false
ENABLE_FIREWALL=false
AUTO_UPDATE=false

# ─── Funciones de output ──────────────────────────────────────────
log()      { echo -e "${C_DIM}[$(date +%H:%M:%S)]${C_RESET} $*" | tee -a "$LOG_FILE" >&2; }
info()     { echo -e "${C_CYAN}ℹ${C_RESET}  $*" | tee -a "$LOG_FILE" >&2; }
success()  { echo -e "${C_GREEN}✓${C_RESET}  $*" | tee -a "$LOG_FILE" >&2; }
warn()     { echo -e "${C_YELLOW}⚠${C_RESET}  $*" | tee -a "$LOG_FILE" >&2; }
error()    { echo -e "${C_RED}✗${C_RESET}  $*" | tee -a "$LOG_FILE" >&2; }
fatal()    { error "$*"; cleanup_and_exit 1; }
header()   { echo -e "\n${C_BOLD}${C_MAGENTA}$*${C_RESET}" | tee -a "$LOG_FILE" >&2; echo -e "${C_DIM}$(printf '─%.0s' {1..70})${C_RESET}" | tee -a "$LOG_FILE" >&2; }

# Spinner (jobs en background)
SPINNER_PID=""
start_spinner() {
    local msg="$1"
    local chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    (
        while true; do
            for ((i=0; i<${#chars}; i++)); do
                printf "\r${C_CYAN}%s${C_RESET} %s" "${chars:$i:1}" "$msg"
                sleep 0.1
            done
        done
    ) &
    SPINNER_PID=$!
}
stop_spinner() {
    if [[ -n "$SPINNER_PID" ]]; then
        kill "$SPINNER_PID" 2>/dev/null || true
        wait "$SPINNER_PID" 2>/dev/null || true
        printf "\r"
        SPINNER_PID=""
    fi
}

# Wrapper para spinnear comandos largos
run_with_spinner() {
    local msg="$1"
    shift
    start_spinner "$msg"
    local exit_code=0
    "$@" >>"$LOG_FILE" 2>&1 || exit_code=$?
    stop_spinner
    if [[ $exit_code -eq 0 ]]; then
        success "$msg"
    else
        error "$msg (exit $exit_code, ver $LOG_FILE)"
    fi
    return $exit_code
}

# Helper: ejecutar comando con privilegios (sudo si está disponible, directo si somos root)
SUDO=""
if [[ $EUID -ne 0 ]] && command -v sudo &>/dev/null; then
    SUDO="sudo"
fi
run_privileged() { $SUDO "$@"; }

# Cleanup en caso de error
cleanup_and_exit() {
    local code="${1:-0}"
    stop_spinner
    rm -f "$LOCK_FILE" 2>/dev/null || true
    if [[ $code -ne 0 ]]; then
        echo ""
        error "Instalación abortada (exit code $code)"
        error "Log completo: $LOG_FILE"
        echo ""
        echo -e "${C_DIM}Si necesitas ayuda, ejecuta de nuevo con --verbose${C_RESET}"
    fi
    exit "$code"
}

trap 'cleanup_and_exit 1' ERR INT TERM

# ─── Banner ────────────────────────────────────────────────────────
print_banner() {
    clear 2>/dev/null || true
    echo -e "${C_BOLD}${C_CYAN}"
    cat <<'EOF'

    ███╗   ██╗      ███████╗██╗  ██╗██╗   ██╗███████╗
    ████╗  ██║      ██╔════╝╚██╗██╔╝██║   ██║██╔════╝
    ██╔██╗ ██║█████╗█████╗   ╚███╔╝ ██║   ██║███████╗
    ██║╚██╗██║╚════╝██╔══╝   ██╔██╗ ██║   ██║╚════██║
    ██║ ╚████║      ███████╗██╔╝ ██╗╚██████╔╝███████║
    ╚═╝  ╚═══╝      ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝

    Backend Installer v0.28.0
    Sistema de backups ultrarrápido con drag-and-drop
EOF
    echo -e "${C_RESET}"
}

# ─── Help ──────────────────────────────────────────────────────────
print_help() {
    cat <<EOF
${C_BOLD}M-NEXUS Backend Installer v${APP_VERSION}${C_RESET}

${C_BOLD}USO:${C_RESET}
    $0 [opciones]

${C_BOLD}OPCIONES:${C_RESET}
    (sin opciones)        Modo interactivo (wizard guiado paso a paso)
    --auto                Modo automático (acepta todos los defaults)
    --update              Actualizar instalación existente a v${APP_VERSION}
    --uninstall           Desinstalar M-NEXUS completamente
    --port <puerto>       Puerto personalizado (default: ${DEFAULT_PORT})
    --storage <path>      Directorio de backups (default: ${DEFAULT_STORAGE})
    --domain <dominio>    Dominio público (ej. mnexus.example.com)
    --with-whisper        Instalar soporte para Whisper (necesita ~2GB RAM)
    --with-ollama         Instalar soporte para Ollama (LLM local)
    --with-tesseract      Instalar soporte para Tesseract OCR
    --with-nginx          Configurar Nginx reverse proxy con HTTPS
    --docker              Usar Docker en vez de instalación directa
    --non-interactive     Modo no interactivo (requiere todas las opciones)
    --verbose             Mostrar todos los comandos ejecutados
    --help                Mostrar esta ayuda

${C_BOLD}EJEMPLOS:${C_RESET}
    $0                                    # Wizard interactivo
    $0 --auto                             # Todo por defecto, sin preguntas
    $0 --port 8080 --with-whisper         # Puerto custom + Whisper
    $0 --domain mnexus.midominio.com      # Setup completo con HTTPS
    $0 --docker --with-nginx              # Deployment con Docker + Nginx
    $0 --update                           # Actualizar a v${APP_VERSION}
    $0 --uninstall                        # Borrar todo

${C_BOLD}REQUISITOS:${C_RESET}
    - Linux (Ubuntu/Debian/CentOS/RHEL/Fedora/Alpine/Arch), macOS, o WSL
    - bash 4+, curl o wget
    - Permisos root/sudo para instalar paquetes
    - 512MB RAM mínimo (2GB recomendado para Whisper)
    - 2GB disco libre

EOF
    exit 0
}

# ═══════════════════════════════════════════════════════════════════
# FASE 1: DETECCIÓN DEL ENTORNO
# ═══════════════════════════════════════════════════════════════════

detect_os() {
    header "Fase 1/7: Detectando sistema operativo"

    UNAME_S=$(uname -s)
    UNAME_M=$(uname -m)

    case "$UNAME_S" in
        Linux)
            # Detectar WSL
            if [[ -f /proc/version ]] && grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
                OS_FAMILY="wsl"
                OS_DISTRO="wsl"
                OS_VERSION="WSL"
                success "Detectado: WSL (Windows Subsystem for Linux)"
            else
                OS_FAMILY="linux"
                # Detectar distro
                if [[ -f /etc/os-release ]]; then
                    # Parsear manualmente sin source (evita colisión con readonly VERSION)
                    OS_DISTRO=$(grep -E "^ID=" /etc/os-release | head -1 | cut -d= -f2- | tr -d '"' | tr "[:upper:]" "[:lower:]")
                    OS_VERSION=$(grep -E "^VERSION_ID=" /etc/os-release | head -1 | cut -d= -f2- | tr -d '"')
                    [[ -z "$OS_DISTRO" ]] && OS_DISTRO="unknown"
                    [[ -z "$OS_VERSION" ]] && OS_VERSION="unknown"
                elif [[ -f /etc/alpine-release ]]; then
                    OS_DISTRO="alpine"
                    OS_VERSION=$(cat /etc/alpine-release)
                elif command -v lsb_release &>/dev/null; then
                    OS_DISTRO=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
                    OS_VERSION=$(lsb_release -sr)
                else
                    OS_DISTRO="unknown"
                    OS_VERSION="unknown"
                fi
                success "Detectado: Linux ${OS_DISTRO} ${OS_VERSION}"
            fi
            ;;
        Darwin)
            OS_FAMILY="macos"
            OS_DISTRO="macos"
            OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
            success "Detectado: macOS ${OS_VERSION}"
            ;;
        *)
            OS_FAMILY="other"
            OS_DISTRO="other"
            OS_VERSION="unknown"
            warn "Sistema no reconocido: $UNAME_S"
            ;;
    esac

    # Detectar package manager
    if [[ "$OS_FAMILY" == "macos" ]]; then
        if command -v brew &>/dev/null; then
            PKG_MANAGER="brew"
        else
            PKG_MANAGER="none"
        fi
    elif [[ "$OS_FAMILY" == "linux" || "$OS_FAMILY" == "wsl" ]]; then
        if command -v apt-get &>/dev/null; then
            PKG_MANAGER="apt"
        elif command -v dnf &>/dev/null; then
            PKG_MANAGER="dnf"
        elif command -v yum &>/dev/null; then
            PKG_MANAGER="yum"
        elif command -v apk &>/dev/null; then
            PKG_MANAGER="apk"
        elif command -v pacman &>/dev/null; then
            PKG_MANAGER="pacman"
        else
            PKG_MANAGER="none"
        fi
    fi

    if [[ "$PKG_MANAGER" == "none" ]]; then
        warn "No se detectó package manager. Instalación manual de dependencias."
    else
        info "Package manager: $PKG_MANAGER"
    fi

    # Detectar service managers
    HAS_SYSTEMD=false
    HAS_LAUNCHD=false
    if [[ "$OS_FAMILY" == "linux" || "$OS_FAMILY" == "wsl" ]]; then
        if [[ -d /run/systemd/system ]] && command -v systemctl &>/dev/null; then
            HAS_SYSTEMD=true
        fi
    fi
    if [[ "$OS_FAMILY" == "macos" ]]; then
        if command -v launchctl &>/dev/null; then
            HAS_LAUNCHD=true
        fi
    fi

    # Detectar Docker
    HAS_DOCKER=false
    if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
        HAS_DOCKER=true
    fi

    # User info
    if [[ $EUID -eq 0 ]]; then
        SERVER_USER="mnexus"
        SERVER_GROUP="mnexus"
        SERVER_HOME="/var/lib/mnexus"
        warn "Ejecutando como root. Se creará usuario dedicado 'mnexus'."
    else
        SERVER_USER="$USER"
        SERVER_GROUP=$(id -gn)
        SERVER_HOME="$HOME"
        info "Ejecutando como usuario no-root: $SERVER_USER"
    fi
}

detect_resources() {
    header "Fase 2/7: Detectando recursos del servidor"

    # RAM
    if [[ "$OS_FAMILY" == "macos" ]]; then
        TOTAL_RAM_MB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
    else
        TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
    fi
    if [[ $TOTAL_RAM_MB -eq 0 ]]; then
        warn "No se pudo detectar RAM"
        TOTAL_RAM_MB=1024
    fi

    # CPU
    if command -v nproc &>/dev/null; then
        CPU_CORES=$(nproc)
    else
        CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 1)
    fi

    # Disco (en / o donde se va a instalar)
    INSTALL_PARENT=$(dirname "$DEFAULT_STORAGE" 2>/dev/null || echo "/")
    # Si la ruta no existe (ej. /var/lib/mnexus), usar /
    [[ ! -d "$INSTALL_PARENT" ]] && INSTALL_PARENT="/"
    FREE_DISK_MB=$(df -P "$INSTALL_PARENT" | awk 'NR==2 {print int($4/1024)}')

    echo ""
    info "Recursos detectados:"
    echo -e "  ${C_DIM}RAM:${C_RESET}    ${TOTAL_RAM_MB} MB"
    echo -e "  ${C_DIM}CPU:${C_RESET}    ${CPU_CORES} cores"
    echo -e "  ${C_DIM}Disco:${C_RESET}  ${FREE_DISK_MB} MB libres en ${INSTALL_PARENT}"
    echo ""

    # Advertir si no cumple mínimos
    if [[ $TOTAL_RAM_MB -lt $MIN_RAM_MB ]]; then
        fatal "RAM insuficiente: ${TOTAL_RAM_MB}MB < ${MIN_RAM_MB}MB mínimo"
    fi
    if [[ $FREE_DISK_MB -lt $MIN_DISK_MB ]]; then
        fatal "Disco insuficiente: ${FREE_DISK_MB}MB < ${MIN_DISK_MB}MB mínimo"
    fi

    success "Recursos OK"
}

detect_existing() {
    header "Fase 3/7: Buscando instalación existente"

    EXISTING_INSTALL=false
    EXISTING_VERSION=""

    if [[ -f "/opt/mnexus/package.json" ]]; then
        EXISTING_INSTALL=true
        EXISTING_VERSION=$(grep '"version"' "/opt/mnexus/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
        info "Instalación existente encontrada en /opt/mnexus (versión: $EXISTING_VERSION)"
    elif [[ -f "$HOME/.mnexus/installed" ]]; then
        EXISTING_INSTALL=true
        EXISTING_VERSION=$(cat "$HOME/.mnexus/installed" 2>/dev/null || echo "?")
        info "Instalación existente encontrada en $HOME/.mnexus (versión: $EXISTING_VERSION)"
    fi

    if [[ "$EXISTING_INSTALL" == "true" ]]; then
        success "Versión instalada: $EXISTING_VERSION"
        if [[ "$EXISTING_VERSION" == "$APP_VERSION" ]]; then
            warn "La versión $APP_VERSION ya está instalada"
        fi
    else
        info "No hay instalación previa"
    fi
}

detect_node() {
    info "Verificando Node.js..."

    if command -v node &>/dev/null; then
        NODE_VERSION=$(node --version | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        if [[ $NODE_MAJOR -ge $MIN_NODE_MAJOR ]]; then
            NODE_OK=true
            success "Node.js v$NODE_VERSION (>= ${MIN_NODE_MAJOR})"
        else
            warn "Node.js v$NODE_VERSION < ${MIN_NODE_MAJOR} (necesita actualización)"
        fi
        NPM_VERSION=$(npm --version 2>/dev/null || echo "?")
        info "npm v$NPM_VERSION"
    else
        warn "Node.js no está instalado"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# FASE 2: WIZARDS DE CONFIGURACIÓN
# ═══════════════════════════════════════════════════════════════════

wizard_intro() {
    header "Fase 4/7: Configuración (wizard)"
    echo ""
    echo -e "${C_DIM}Voy a hacerte unas preguntas. Defaults entre [corchetes].${C_RESET}"
    echo -e "${C_DIM}Presiona Enter para aceptar el default, o escribe tu respuesta.${C_RESET}"
    echo ""
}

# Función genérica para pedir input con default
ask() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local is_password="${4:-false}"

    if [[ "$is_password" == "true" ]]; then
        local value
        read -rs -p "$(echo -e "${C_CYAN}?${C_RESET} $prompt ${C_DIM}[$default]${C_RESET}: ")" value
        echo ""
    else
        local value
        read -r -p "$(echo -e "${C_CYAN}?${C_RESET} $prompt ${C_DIM}[$default]${C_RESET}: ")" value
    fi

    if [[ -z "$value" ]]; then
        eval "$var_name=\"\$default\""
    else
        eval "$var_name=\"\$value\""
    fi
}

# Validar puerto
validate_port() {
    local port="$1"
    if ! [[ "$port" =~ ^[0-9]+$ ]] || [[ $port -lt 1 ]] || [[ $port -gt 65535 ]]; then
        return 1
    fi
    # Puertos privilegiados (<1024) requieren root
    if [[ $port -lt 1024 && $EUID -ne 0 ]]; then
        return 2
    fi
    return 0
}

wizard_port() {
    echo ""
    echo -e "${C_BOLD}Puerto del servidor${C_RESET}"
    echo -e "${C_DIM}Elige un puerto TCP. El plugin de Obsidian y la app móvil${C_RESET}"
    echo -e "${C_DIM}se conectarán a este puerto.${C_RESET}"
    echo ""

    while true; do
        ask "Puerto" "$DEFAULT_PORT" "SERVER_PORT"
        if validate_port "$SERVER_PORT"; then
            # Verificar que no esté ocupado
            if command -v ss &>/dev/null && ss -tln 2>/dev/null | grep -q ":$SERVER_PORT\b"; then
                warn "El puerto $SERVER_PORT ya está en uso"
                if ask_bool "Continuar de todos modos" "n"; then
                    break
                fi
            else
                break
            fi
        else
            warn "Puerto inválido. Usa un número entre 1 y 65535."
            if [[ $EUID -ne 0 ]]; then
                info "Para puertos < 1024 necesitas ejecutar como root"
            fi
        fi
    done

    # Bind host
    echo ""
    echo -e "${C_BOLD}Interfaz de red${C_RESET}"
    echo -e "${C_DIM}¿A qué interfaz escucha el server?${C_RESET}"
    echo -e "${C_DIM}  - 127.0.0.1: solo local (más seguro, recomendado si usas Nginx)${C_RESET}"
    echo -e "${C_DIM}  - 0.0.0.0:  todas las interfaces (LAN, VPN)${C_RESET}"
    echo ""

    if [[ -n "$DOMAIN" ]]; then
        info "Con dominio configurado, 127.0.0.1 es más seguro (Nginx hace el resto)"
    fi
    ask "Bind host" "127.0.0.1" "BIND_HOST"
}

wizard_storage() {
    echo ""
    echo -e "${C_BOLD}Almacenamiento de backups${C_RESET}"
    echo -e "${C_DIM}Los .zip de cada backup se guardan aquí.${C_RESET}"
    echo -e "${C_DIM}El índice SQLite (~16KB) también va aquí.${C_RESET}"
    echo ""

    # Sugerir path según contexto
    local default_path="$DEFAULT_STORAGE"
    if [[ $EUID -ne 0 ]]; then
        default_path="$HOME/.mnexus/backups"
    fi

    ask "Directorio de backups" "$default_path" "STORAGE_PATH"
    INDEX_PATH="$STORAGE_PATH-index.db"

    echo ""
    echo -e "${C_BOLD}Tamaño máximo por backup${C_RESET}"
    echo -e "${C_DIM}Por seguridad, los backups más grandes se rechazan.${C_RESET}"
    local default_max_mb=$DEFAULT_MAX_BACKUP_MB
    ask "Tamaño máximo (MB)" "$default_max_mb" "max_mb"
    MAX_BACKUP_SIZE=$((max_mb * 1024 * 1024))
}

wizard_security() {
    echo ""
    echo -e "${C_BOLD}Seguridad${C_RESET}"
    echo -e "${C_DIM}El secret JWT se usa para firmar tokens de autenticación.${C_RESET}"
    echo -e "${C_DIM}Cada device lo necesita para registrarse.${C_RESET}"
    echo ""

    if ask_bool "Generar JWT secret automáticamente" "y"; then
        JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64)
        success "JWT secret generado (64 caracteres hex)"
    else
        ask "JWT secret (mínimo 32 caracteres)" "" "JWT_SECRET" true
        if [[ ${#JWT_SECRET} -lt 32 ]]; then
            fatal "JWT secret demasiado corto (mínimo 32 caracteres)"
        fi
    fi
}

wizard_mode() {
    echo ""
    echo -e "${C_BOLD}Modo de instalación${C_RESET}"
    echo -e "${C_DIM}¿Cómo quieres que se ejecute el server?${C_RESET}"
    echo ""

    local options=()
    local n=1

    echo -e "  ${C_CYAN}$n)${C_RESET} Directo (sin servicio, arranca manual con un script)"
    options+=("direct")
    n=$((n+1))

    if [[ "$HAS_SYSTEMD" == "true" ]]; then
        echo -e "  ${C_CYAN}$n)${C_RESET} systemd (recomendado para Linux, auto-arranca al boot)"
        options+=("systemd")
        n=$((n+1))
    fi

    if [[ "$HAS_LAUNCHD" == "true" ]]; then
        echo -e "  ${C_CYAN}$n)${C_RESET} launchd (recomendado para macOS, auto-arranca al boot)"
        options+=("launchd")
        n=$((n+1))
    fi

    if [[ "$HAS_DOCKER" == "true" ]]; then
        echo -e "  ${C_CYAN}$n)${C_RESET} Docker (container aislado, requiere Docker)"
        options+=("docker")
        n=$((n+1))
    fi

    echo -e "  ${C_CYAN}$n)${C_RESET} Salir sin instalar"
    options+=("quit")

    echo ""
    local choice
    read -r -p "$(echo -e "${C_CYAN}?${C_RESET} Modo [1]: ")" choice
    choice=${choice:-1}

    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ $choice -lt 1 ]] || [[ $choice -gt ${#options[@]} ]]; then
        fatal "Opción inválida"
    fi

    INSTALL_MODE="${options[$((choice-1))]}"

    if [[ "$INSTALL_MODE" == "quit" ]]; then
        info "Cancelado por el usuario"
        cleanup_and_exit 0
    fi
}

wizard_features() {
    echo ""
    echo -e "${C_BOLD}Features opcionales${C_RESET}"
    echo -e "${C_DIM}Estas features requieren recursos adicionales.${C_RESET}"
    echo ""

    # Whisper: necesita ~1-2GB RAM
    if [[ $TOTAL_RAM_MB -ge 2048 ]]; then
        info "RAM suficiente (${TOTAL_RAM_MB}MB >= 2048MB) para Whisper"
        if ask_bool "Habilitar Whisper (transcripción de audio)" "n"; then
            ENABLE_WHISPER=true
        fi
    else
        warn "Whisper requiere 2GB+ RAM (tienes ${TOTAL_RAM_MB}MB)"
        info "Whisper se omitirá. Se puede agregar después."
    fi

    # Ollama: necesita ~4GB RAM
    if [[ $TOTAL_RAM_MB -ge 4096 ]]; then
        if ask_bool "Habilitar Ollama (LLM local)" "n"; then
            ENABLE_OLLAMA=true
        fi
    else
        info "Ollama requiere 4GB+ RAM (tienes ${TOTAL_RAM_MB}MB), se omitirá"
    fi

    # Tesseract: ligero
    if ask_bool "Habilitar Tesseract (OCR de imágenes)" "n"; then
        ENABLE_TESSERACT=true
    fi

    # Nginx: si domain está configurado
    if [[ -n "$DOMAIN" ]] || ask_bool "Configurar Nginx reverse proxy con HTTPS" "n"; then
        ENABLE_NGINX=true
        if [[ -z "$DOMAIN" ]]; then
            ask "Dominio público (ej. mnexus.example.com)" "" "DOMAIN"
        fi
    fi

    # Firewall
    if command -v ufw &>/dev/null || command -v firewall-cmd &>/dev/null; then
        if ask_bool "Configurar firewall (abrir puerto $SERVER_PORT)" "y"; then
            ENABLE_FIREWALL=true
        fi
    fi
}

wizard_domain() {
    echo ""
    echo -e "${C_BOLD}Acceso público (opcional)${C_RESET}"
    echo -e "${C_DIM}Si tienes un dominio público, podemos configurar HTTPS.${C_RESET}"
    echo -e "${C_DIM}Si no, el server escuchará solo en local/red interna.${C_RESET}"
    echo ""

    if ask_bool "¿Tienes un dominio público" "n"; then
        ask "Dominio (ej. mnexus.example.com)" "" "DOMAIN"
    fi
}

# Yes/no prompt
ask_bool() {
    local prompt="$1"
    local default="$2"
    local choice
    local yn_prompt
    if [[ "$default" == "y" ]]; then
        yn_prompt="Y/n"
    else
        yn_prompt="y/N"
    fi
    read -r -p "$(echo -e "${C_CYAN}?${C_RESET} $prompt ${C_DIM}[$yn_prompt]${C_RESET}: ")" choice
    case "${choice:-$default}" in
        y|Y|yes|YES) echo "true" ;;
        *)           echo "false" ;;
    esac
}

# ═══════════════════════════════════════════════════════════════════
# FASE 3: INSTALACIÓN ADAPTATIVA
# ═══════════════════════════════════════════════════════════════════

install_dependencies() {
    header "Fase 5/7: Instalando dependencias del sistema"

    if [[ "$PKG_MANAGER" == "none" ]]; then
        warn "Sin package manager. Saltando instalación automática."
        warn "Asegúrate de tener instalado: bash, curl, openssl, node.js ${MIN_NODE_MAJOR}+, npm, git"
        return
    fi

    # Actualizar índices
    run_with_spinner "Actualizando índices de paquetes..." update_pkg_index

    # Instalar base
    case "$PKG_MANAGER" in
        apt)
            run_with_spinner "Instalando dependencias base..." install_apt_base
            ;;
        dnf|yum)
            run_with_spinner "Instalando dependencias base..." install_dnf_base
            ;;
        apk)
            run_with_spinner "Instalando dependencias base..." install_apk_base
            ;;
        pacman)
            run_with_spinner "Instalando dependencias base..." install_pacman_base
            ;;
        brew)
            run_with_spinner "Instalando dependencias base..." install_brew_base
            ;;
    esac

    success "Dependencias del sistema instaladas"
}

update_pkg_index() {
    case "$PKG_MANAGER" in
        apt)     $SUDO apt-get update -y 2>&1 ;;
        dnf)     $SUDO dnf check-update -y 2>&1 || true ;;
        apk)     $SUDO apk update 2>&1 ;;
        pacman)  $SUDO pacman -Sy 2>&1 ;;
        brew)    brew update 2>&1 ;;
    esac
}

install_apt_base() {
    local pkgs="curl wget gnupg ca-certificates openssl git jq"
    if [[ $EUID -eq 0 ]]; then
        pkgs="$pkgs sudo"
    fi
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y $pkgs 2>&1
}

install_dnf_base() {
    local pkgs="curl wget gnupg2 ca-certificates openssl git jq"
    if [[ $EUID -eq 0 ]]; then
        pkgs="$pkgs sudo"
    fi
    $SUDO dnf install -y $pkgs 2>&1
}

install_apk_base() {
    $SUDO apk add --no-cache curl wget openssl git jq bash 2>&1
}

install_pacman_base() {
    local pkgs="curl wget gnupg ca-certificates openssl git jq"
    if [[ $EUID -eq 0 ]]; then
        pkgs="$pkgs sudo"
    fi
    $SUDO pacman -S --noconfirm $pkgs 2>&1
}

install_brew_base() {
    brew install curl wget jq git 2>&1
}

install_node() {
    if [[ "$NODE_OK" == "true" ]]; then
        info "Node.js v$NODE_VERSION ya está instalado y es compatible"
        return
    fi

    header "Instalando Node.js ${MIN_NODE_MAJOR}"

    case "$OS_FAMILY" in
        linux|wsl)
            if [[ "$PKG_MANAGER" == "apt" ]]; then
                # NodeSource
                run_with_spinner "Descargando NodeSource setup..." curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x -o /tmp/nodesource_setup.sh
                run_with_spinner "Añadiendo repositorio NodeSource..." sudo bash /tmp/nodesource_setup.sh
                run_with_spinner "Instalando Node.js..." sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
            elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
                run_with_spinner "Descargando NodeSource setup..." curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE_MAJOR}.x -o /tmp/nodesource_setup.sh
                run_with_spinner "Añadiendo repositorio NodeSource..." sudo bash /tmp/nodesource_setup.sh
                run_with_spinner "Instalando Node.js..." sudo dnf install -y nodejs
            elif [[ "$PKG_MANAGER" == "apk" ]]; then
                run_with_spinner "Instalando Node.js..." sudo apk add --no-cache nodejs npm
            elif [[ "$PKG_MANAGER" == "pacman" ]]; then
                run_with_spinner "Instalando Node.js..." sudo pacman -S --noconfirm nodejs npm
            fi
            ;;
        macos)
            if [[ "$PKG_MANAGER" == "brew" ]]; then
                run_with_spinner "Instalando Node.js via Homebrew..." brew install node@${MIN_NODE_MAJOR}
                run_with_spinner "Linkeando Node.js..." brew link --force node@${MIN_NODE_MAJOR}
            else
                warn "Homebrew no está instalado. Instálalo desde https://brew.sh"
                warn "O descarga Node.js desde https://nodejs.org/"
                fatal "No se puede continuar sin Node.js"
            fi
            ;;
    esac

    # Verificar
    NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' || echo "")
    if [[ -z "$NODE_VERSION" ]]; then
        fatal "Node.js no se instaló correctamente"
    fi
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [[ $NODE_MAJOR -lt $MIN_NODE_MAJOR ]]; then
        fatal "Node.js v$NODE_VERSION instalado pero es < ${MIN_NODE_MAJOR}"
    fi
    success "Node.js v$NODE_VERSION instalado correctamente"
}

install_optional_features() {
    header "Fase 6/7: Instalando features opcionales"

    if [[ "$ENABLE_WHISPER" == "true" ]]; then
        info "Whisper se instalará más tarde (binario grande, opcional)"
    fi

    if [[ "$ENABLE_TESSERACT" == "true" ]]; then
        install_tesseract
    fi
}

install_tesseract() {
    info "Instalando Tesseract OCR..."
    case "$PKG_MANAGER" in
        apt)    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y tesseract-ocr tesseract-ocr-spa ;;
        dnf)    $SUDO dnf install -y tesseract tesseract-langpack-spa ;;
        apk)    $SUDO apk add --no-cache tesseract-ocr tesseract-ocr-data-spa ;;
        brew)   brew install tesseract tesseract-lang ;;
    esac
    success "Tesseract instalado"
}

# ═══════════════════════════════════════════════════════════════════
# FASE 4: SETUP DEL SERVER
# ═══════════════════════════════════════════════════════════════════

setup_user() {
    if [[ $EUID -ne 0 ]]; then
        info "No se creará usuario dedicado (ejecutando como $SERVER_USER)"
        return
    fi

    if id "$SERVER_USER" &>/dev/null; then
        info "Usuario '$SERVER_USER' ya existe"
    else
        run_with_spinner "Creando usuario '$SERVER_USER'..." create_user
    fi
}

create_user() {
    $SUDO useradd -r -s /bin/false -d "$SERVER_HOME" "$SERVER_USER" 2>&1
    $SUDO mkdir -p "$SERVER_HOME"
    $SUDO chown "$SERVER_USER:$SERVER_GROUP" "$SERVER_HOME"
}

setup_directories() {
    run_with_spinner "Creando estructura de directorios..." create_dirs
}

create_dirs() {
    $SUDO mkdir -p "$STORAGE_PATH" 2>&1
    $SUDO mkdir -p "$(dirname "$STORAGE_PATH")" 2>&1

    # Install dir
    INSTALL_DIR="/opt/mnexus"
    $SUDO mkdir -p "$INSTALL_DIR" 2>&1

    # Permisos
    if [[ $EUID -eq 0 ]]; then
        $SUDO chown -R "$SERVER_USER:$SERVER_GROUP" "$INSTALL_DIR" 2>&1
        $SUDO chown -R "$SERVER_USER:$SERVER_GROUP" "$STORAGE_PATH" 2>&1
        $SUDO chmod 750 "$STORAGE_PATH" 2>&1
    fi
}

setup_backend_code() {
    info "Copiando código del backend a $INSTALL_DIR..."

    SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
    SOURCE_DIR="$SCRIPT_DIR/m-nexus-backend-v${APP_VERSION}"

    # Si no existe, descargar de GitHub
    if [[ ! -d "$SOURCE_DIR" ]]; then
        info "No se encontró el código local. Descargando de GitHub..."
        local archive="/tmp/mnexus-backend-v${APP_VERSION}.zip"
        if command -v curl &>/dev/null; then
            curl -fSL "https://github.com/rodrigo/m-nexus/releases/download/v${APP_VERSION}/m-nexus-backend-v${APP_VERSION}.zip" -o "$archive" 2>&1
        elif command -v wget &>/dev/null; then
            wget -q "https://github.com/rodrigo/m-nexus/releases/download/v${APP_VERSION}/m-nexus-backend-v${APP_VERSION}.zip" -O "$archive" 2>&1
        else
            fatal "Ni curl ni wget disponibles. Descarga el ZIP manualmente."
        fi
        mkdir -p "$SOURCE_DIR"
        unzip -q "$archive" -d "$SOURCE_DIR"
    fi

    if [[ ! -d "$SOURCE_DIR/dist" ]]; then
        fatal "No se encontró dist/ en $SOURCE_DIR. ¿El ZIP se descargó correctamente?"
    fi

    $SUDO rm -rf "$INSTALL_DIR"
    $SUDO mkdir -p "$INSTALL_DIR"
    $SUDO cp -r "$SOURCE_DIR/dist" "$INSTALL_DIR/dist"
    $SUDO cp "$SOURCE_DIR/package.json" "$INSTALL_DIR/package.json"

    # Permisos
    if [[ $EUID -eq 0 ]]; then
        $SUDO chown -R "$SERVER_USER:$SERVER_GROUP" "$INSTALL_DIR"
    fi

    success "Código copiado a $INSTALL_DIR"
}

setup_env() {
    info "Creando archivo de configuración..."

    local env_file="$INSTALL_DIR/.env"
    $SUDO tee "$env_file" > /dev/null <<EOF
# M-NEXUS Backend v${APP_VERSION} — generado por installer el $(date -Iseconds)
NODE_ENV=production
PORT=${SERVER_PORT}
HOST=${BIND_HOST}
JWT_SECRET=${JWT_SECRET}
BACKUP_STORAGE_PATH=${STORAGE_PATH}
BACKUP_INDEX_PATH=${INDEX_PATH}
MAX_BACKUP_SIZE=${MAX_BACKUP_SIZE}
LOG_LEVEL=info
EOF

    $SUDO chmod 600 "$env_file"
    if [[ $EUID -eq 0 ]]; then
        $SUDO chown "$SERVER_USER:$SERVER_GROUP" "$env_file"
    fi

    success "Configuración guardada en $env_file"
}

install_npm_dependencies() {
    info "Instalando dependencias npm..."
    (cd "$INSTALL_DIR" && sudo npm install --omit=dev 2>&1 | tail -5)
    success "Dependencias npm instaladas"
}

setup_systemd() {
    if [[ "$HAS_SYSTEMD" != "true" ]]; then
        warn "systemd no disponible, saltando"
        return
    fi

    info "Configurando servicio systemd..."

    local service_file="/etc/systemd/system/mnexus-backend.service"
    $SUDO tee "$service_file" > /dev/null <<EOF
[Unit]
Description=M-NEXUS Backend v${APP_VERSION}
Documentation=https://github.com/rodrigo/m-nexus
After=network.target

[Service]
Type=simple
User=${SERVER_USER}
Group=${SERVER_GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/env node dist/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${STORAGE_PATH} $(dirname ${STORAGE_PATH})

# Límites de recursos
MemoryMax=${TOTAL_RAM_MB}M
CPUQuota=${CPU_CORES}00%

[Install]
WantedBy=multi-user.target
EOF

    $SUDO systemctl daemon-reload
    $SUDO systemctl enable mnexus-backend.service

    success "Servicio systemd configurado"
    info "Para arrancar: sudo systemctl start mnexus-backend"
}

setup_launchd() {
    if [[ "$HAS_LAUNCHD" != "true" ]]; then
        warn "launchd no disponible"
        return
    fi

    info "Configurando LaunchDaemon..."

    local plist_file="/Library/LaunchDaemons/com.mnexus.backend.plist"
    $SUDO tee "$plist_file" > /dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mnexus.backend</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${INSTALL_DIR}/dist/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key><string>production</string>
        <key>PORT</key><string>${SERVER_PORT}</string>
        <key>HOST</key><string>${BIND_HOST}</string>
        <key>JWT_SECRET</key><string>${JWT_SECRET}</string>
        <key>BACKUP_STORAGE_PATH</key><string>${STORAGE_PATH}</string>
        <key>BACKUP_INDEX_PATH</key><string>${INDEX_PATH}</string>
        <key>MAX_BACKUP_SIZE</key><string>${MAX_BACKUP_SIZE}</string>
        <key>LOG_LEVEL</key><string>info</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/mnexus-backend.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/mnexus-backend.err</string>
</dict>
</plist>
EOF

    $SUDO launchctl load "$plist_file"
    success "LaunchDaemon configurado"
}

setup_nginx() {
    if [[ "$ENABLE_NGINX" != "true" ]]; then
        return
    fi

    info "Configurando Nginx reverse proxy con HTTPS..."

    # Instalar nginx
    case "$PKG_MANAGER" in
        apt)    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx ;;
        dnf)    $SUDO dnf install -y nginx certbot python3-certbot-nginx ;;
        apk)    $SUDO apk add --no-cache nginx certbot ;;
        brew)   brew install nginx ;;
    esac

    # Generar configuración
    local nginx_conf="/etc/nginx/sites-available/mnexus"
    $SUDO tee "$nginx_conf" > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${SERVER_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Backup-specific: permitir uploads grandes
        client_max_body_size $((MAX_BACKUP_SIZE/1024/1024 + 100))M;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
EOF

    # Activar
    if [[ -d /etc/nginx/sites-enabled ]]; then
        $SUDO ln -sf "$nginx_conf" /etc/nginx/sites-enabled/
    fi
    $SUDO nginx -t
    $SUDO systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true

    # HTTPS con Let's Encrypt
    if command -v certbot &>/dev/null; then
        if ask_bool "Generar certificado HTTPS con Let's Encrypt" "y"; then
            run_with_spinner "Solicitando certificado..." sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}"
        fi
    fi

    success "Nginx configurado"
}

setup_firewall() {
    if [[ "$ENABLE_FIREWALL" != "true" ]]; then
        return
    fi

    info "Configurando firewall..."

    if command -v ufw &>/dev/null; then
        run_with_spinner "Abriendo puerto $SERVER_PORT con UFW..." sudo ufw allow "$SERVER_PORT/tcp"
        run_with_spinner "Habilitando UFW..." sudo ufw --force enable
    elif command -v firewall-cmd &>/dev/null; then
        run_with_spinner "Abriendo puerto $SERVER_PORT con firewalld..." sudo firewall-cmd --permanent --add-port="${SERVER_PORT}/tcp"
        $SUDO firewall-cmd --reload
    fi

    success "Firewall configurado"
}

# ═══════════════════════════════════════════════════════════════════
# FASE 5: VERIFICACIÓN
# ═══════════════════════════════════════════════════════════════════

start_and_verify() {
    header "Fase 7/7: Arrancando y verificando"

    case "$INSTALL_MODE" in
        systemd)
            run_with_spinner "Arrancando servicio systemd..." sudo systemctl start mnexus-backend
            sleep 2
            ;;
        launchd)
            run_with_spinner "Recargando LaunchDaemon..." sudo launchctl unload "/Library/LaunchDaemons/com.mnexus.backend.plist" 2>/dev/null || true
            $SUDO launchctl load "/Library/LaunchDaemons/com.mnexus.backend.plist"
            sleep 2
            ;;
        docker)
            run_with_spinner "Arrancando contenedor Docker..." docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d
            sleep 3
            ;;
        direct)
            info "Para arrancar manualmente: cd $INSTALL_DIR && node dist/server.js"
            return
            ;;
    esac

    # Health check
    info "Esperando health check..."
    local max_attempts=15
    local attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        if curl -sf "http://${BIND_HOST}:${SERVER_PORT}/api/v1/health" &>/dev/null; then
            success "Health check OK"
            show_health_summary
            return
        fi
        sleep 1
        attempt=$((attempt+1))
    done

    error "Health check falló tras ${max_attempts}s"
    error "Verifica el log: journalctl -u mnexus-backend -n 30"
    error "O manualmente: cd $INSTALL_DIR && node dist/server.js"
}

show_health_summary() {
    echo ""
    local health
    health=$(curl -s "http://${BIND_HOST}:${SERVER_PORT}/api/v1/health" 2>/dev/null)
    if command -v jq &>/dev/null; then
        echo "$health" | jq . 2>/dev/null || echo "$health"
    else
        echo "$health"
    fi
}

test_backup_endpoint() {
    info "Probando endpoint de backup..."

    local test_dir="/tmp/mnexus-test-backup"
    mkdir -p "$test_dir"
    cd "$test_dir"
    echo "test" > test.txt
    zip -q test.zip test.txt
    local sha=$(sha256sum test.zip | cut -d' ' -f1)

    local token
    token=$(curl -s -X POST "http://${BIND_HOST}:${SERVER_PORT}/api/v1/register" \
        -H "Content-Type: application/json" \
        -d '{"deviceId":"installer-test","deviceName":"Test","platform":"linux","pluginVersion":"0.28.0","protocolVersion":"1"}' \
        2>/dev/null | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

    if [[ -z "$token" ]]; then
        warn "No se pudo obtener token (¿server no arrancó?)"
        cd /
        rm -rf "$test_dir"
        return 1
    fi

    local result
    result=$(curl -s -X POST "http://${BIND_HOST}:${SERVER_PORT}/api/v1/backup/upload" \
        -H "Content-Type: application/zip" \
        -H "Authorization: Bearer $token" \
        -H "X-Device-Id: installer-test" \
        -H "X-Backup-Metadata: {\"kind\":\"manual\",\"vaultPath\":\"test.zip\",\"fileCount\":1,\"sha256\":\"${sha}\"}" \
        --data-binary @test.zip 2>/dev/null)

    if echo "$result" | grep -q '"id"'; then
        success "Endpoint de backup funcional"
    else
        warn "Endpoint de backup no respondió correctamente"
        echo "  Respuesta: $result"
    fi

    cd /
    rm -rf "$test_dir"
}

# ═══════════════════════════════════════════════════════════════════
# FASE 6: OUTPUT FINAL
# ═══════════════════════════════════════════════════════════════════

print_summary() {
    echo ""
    echo ""
    echo -e "${C_BOLD}${C_GREEN}╔═══════════════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_BOLD}${C_GREEN}║          ✓ M-NEXUS Backend v${APP_VERSION} instalado                    ${C_RESET}"
    echo -e "${C_BOLD}${C_GREEN}╚═══════════════════════════════════════════════════════════════╝${C_RESET}"
    echo ""

    cat <<EOF
${C_BOLD}Configuración:${C_RESET}
  ${C_DIM}Modo:${C_RESET}           ${INSTALL_MODE}
  ${C_DIM}Puerto:${C_RESET}         ${SERVER_PORT} (bind: ${BIND_HOST})
  ${C_DIM}Storage:${C_RESET}       ${STORAGE_PATH}
  ${C_DIM}Index:${C_RESET}         ${INDEX_PATH}
  ${C_DIM}Max backup:${C_RESET}    $((MAX_BACKUP_SIZE/1024/1024)) MB
  ${C_DIM}JWT secret:${C_RESET}    (guardado en ${INSTALL_DIR}/.env, modo 0600)
  ${C_DIM}Log file:${C_RESET}      $LOG_FILE

${C_BOLD}URLs:${C_RESET}
  ${C_CYAN}Local:${C_RESET}   http://${BIND_HOST}:${SERVER_PORT}
EOF

    if [[ "$ENABLE_NGINX" == "true" && -n "$DOMAIN" ]]; then
        echo "  ${C_CYAN}Público:${C_RESET} https://${DOMAIN}"
    fi

    cat <<EOF

${C_BOLD}Comandos útiles:${C_RESET}
EOF

    case "$INSTALL_MODE" in
        systemd)
            cat <<EOF
  ${C_DIM}Ver estado:${C_RESET}    $SUDO systemctl status mnexus-backend
  ${C_DIM}Ver logs:${C_RESET}      journalctl -u mnexus-backend -f
  ${C_DIM}Reiniciar:${C_RESET}     $SUDO systemctl restart mnexus-backend
  ${C_DIM}Detener:${C_RESET}       $SUDO systemctl stop mnexus-backend
EOF
            ;;
        launchd)
            cat <<EOF
  ${C_DIM}Ver estado:${C_RESET}    $SUDO launchctl list | grep mnexus
  ${C_DIM}Ver logs:${C_RESET}      tail -f /var/log/mnexus-backend.log
  ${C_DIM}Reiniciar:${C_RESET}     $SUDO launchctl unload /Library/LaunchDaemons/com.mnexus.backend.plist && sudo launchctl load /Library/LaunchDaemons/com.mnexus.backend.plist
EOF
            ;;
        docker)
            cat <<EOF
  ${C_DIM}Ver estado:${C_RESET}    docker compose -f ${INSTALL_DIR}/docker-compose.yml ps
  ${C_DIM}Ver logs:${C_RESET}      docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f
  ${C_DIM}Reiniciar:${C_RESET}     docker compose -f ${INSTALL_DIR}/docker-compose.yml restart
  ${C_DIM}Detener:${C_RESET}       docker compose -f ${INSTALL_DIR}/docker-compose.yml down
EOF
            ;;
        direct)
            cat <<EOF
  ${C_DIM}Arrancar:${C_RESET}      cd $INSTALL_DIR && node dist/server.js
  ${C_DIM}Ver logs:${C_RESET}      cd $INSTALL_DIR && node dist/server.js (stdout directo)
EOF
            ;;
    esac

    cat <<EOF

${C_BOLD}Próximos pasos:${C_RESET}
  1. ${C_CYAN}Instala el plugin de Obsidian${C_RESET} (m-nexus-plugin-v${APP_VERSION}.zip)
     Settings → Community plugins → Install from disk

  2. ${C_CYAN}Configura el plugin${C_RESET} apuntando a:
EOF

    if [[ -n "$DOMAIN" ]]; then
        echo "     https://${DOMAIN}"
    else
        echo "     http://localhost:${SERVER_PORT}"
    fi

    cat <<EOF

  3. ${C_CYAN}Abre el panel de backups${C_RESET} en Obsidian:
     Ctrl/Cmd + P → "📦 Gestor de backups"

  4. ${C_CYAN}Crea tu primer backup${C_RESET} y arrastra un .zip al panel para probar drag-and-drop

${BOLD}Documentación:${C_RESET}
  • BACKUP_INSTALL.md     — Instalación detallada
  • BACKUP_USER_GUIDE.md  — Cómo usar el sistema
  • BACKUP_ADMIN_GUIDE.md — Mantenimiento del server
  • BACKUP_TROUBLESHOOTING.md — Problemas comunes

EOF

    # Guardar credenciales de forma segura
    info "Información importante guardada en: ${INSTALL_DIR}/INSTALL_INFO.txt"
    cat > /tmp/INSTALL_INFO.txt <<INFO
M-NEXUS Backend v${APP_VERSION} — Instalado el $(date -Iseconds)

Configuración:
- Modo:           ${INSTALL_MODE}
- Puerto:         ${SERVER_PORT}
- Bind:           ${BIND_HOST}
- Storage:        ${STORAGE_PATH}
- Index:          ${INDEX_PATH}
- Max backup:     $((MAX_BACKUP_SIZE/1024/1024)) MB
- Install dir:    ${INSTALL_DIR}
- Service file:   $([ "$INSTALL_MODE" = "systemd" ] && echo "/etc/systemd/system/mnexus-backend.service" || echo "n/a")
INFO
    if [[ $EUID -eq 0 ]]; then
        $SUDO mv /tmp/INSTALL_INFO.txt "$INSTALL_DIR/INSTALL_INFO.txt"
        $SUDO chown "$SERVER_USER:$SERVER_GROUP" "$INSTALL_DIR/INSTALL_INFO.txt"
    else
        mv /tmp/INSTALL_INFO.txt "$INSTALL_DIR/INSTALL_INFO.txt" 2>/dev/null || cp /tmp/INSTALL_INFO.txt "$INSTALL_DIR/INSTALL_INFO.txt"
    fi

    echo ""
    success "¡Listo! El sistema de backups está activo."
}

# ═══════════════════════════════════════════════════════════════════
# UNINSTALL
# ═══════════════════════════════════════════════════════════════════

uninstall() {
    echo ""
    echo -e "${C_BOLD}${C_RED}Desinstalar M-NEXUS Backend${C_RESET}"
    echo ""
    echo "Esto va a:"
    echo "  1. Detener el servicio (si existe)"
    echo "  2. Borrar /opt/mnexus (código + .env)"
    echo "  3. Borrar /var/lib/mnexus/backups (ZIPS) — IRREVERSIBLE"
    echo "  4. Borrar /var/lib/mnexus/backups-index.db"
    echo "  5. Borrar configuración systemd/launchd"
    echo "  6. NO borra Whisper, Ollama, Tesseract (instalados aparte)"
    echo ""

    if ! ask_bool "¿Continuar con la desinstalación" "n"; then
        info "Cancelado"
        exit 0
    fi

    echo ""

    # Stop service
    if [[ "$HAS_SYSTEMD" == "true" ]] && systemctl list-unit-files mnexus-backend.service &>/dev/null; then
        run_with_spinner "Deteniendo servicio..." sudo systemctl stop mnexus-backend
        $SUDO systemctl disable mnexus-backend
        $SUDO rm -f /etc/systemd/system/mnexus-backend.service
        $SUDO systemctl daemon-reload
    fi
    if [[ "$HAS_LAUNCHD" == "true" ]] && [[ -f "/Library/LaunchDaemons/com.mnexus.backend.plist" ]]; then
        run_with_spinner "Deteniendo LaunchDaemon..." sudo launchctl unload /Library/LaunchDaemons/com.mnexus.backend.plist 2>/dev/null || true
        $SUDO rm -f /Library/LaunchDaemons/com.mnexus.backend.plist
    fi

    # Remove code
    if [[ -d /opt/mnexus ]]; then
        run_with_spinner "Borrando código..." sudo rm -rf /opt/mnexus
    fi

    # Remove user
    if id mnexus &>/dev/null && [[ $EUID -eq 0 ]]; then
        run_with_spinner "Borrando usuario mnexus..." sudo userdel mnexus 2>/dev/null || true
    fi

    # Remove backups
    if [[ -d /var/lib/mnexus ]]; then
        if ask_bool "Borrar también los backups existentes (IRREVERSIBLE)" "n"; then
            run_with_spinner "Borrando backups..." sudo rm -rf /var/lib/mnexus
            success "Backups borrados"
        else
            info "Backups conservados en /var/lib/mnexus"
        fi
    fi

    # Nginx config
    if [[ -f /etc/nginx/sites-enabled/mnexus ]]; then
        run_with_spinner "Borrando config Nginx..." sudo rm -f /etc/nginx/sites-enabled/mnexus /etc/nginx/sites-available/mnexus
        $SUDO systemctl reload nginx 2>/dev/null || true
    fi

    echo ""
    success "M-NEXUS desinstalado completamente"
}

# ═══════════════════════════════════════════════════════════════════
# UPDATE
# ═══════════════════════════════════════════════════════════════════

update() {
    echo ""
    echo -e "${C_BOLD}Actualizar M-NEXUS Backend a v${APP_VERSION}${C_RESET}"
    echo ""

    if [[ ! -d "$INSTALL_DIR" ]]; then
        INSTALL_DIR="/opt/mnexus"
    fi
    if [[ ! -d "$INSTALL_DIR" ]]; then
        INSTALL_DIR="$HOME/.mnexus"
    fi

    if [[ ! -d "$INSTALL_DIR" ]]; then
        error "No se encontró instalación existente en /opt/mnexus ni en $HOME/.mnexus"
        info "Usa --uninstall primero, o ejecuta sin --update para instalar fresco"
        exit 1
    fi

    info "Instalación encontrada en: $INSTALL_DIR"
    local current_version=$(grep '"version"' "$INSTALL_DIR/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' 2>/dev/null || echo "?")
    info "Versión actual: $current_version"
    info "Versión objetivo: $APP_VERSION"

    if [[ "$current_version" == "$APP_VERSION" ]]; then
        warn "Ya estás en la versión objetivo"
        if ! ask_bool "Reinstalar de todos modos" "n"; then
            exit 0
        fi
    fi

    # Backup .env
    if [[ -f "$INSTALL_DIR/.env" ]]; then
        $SUDO cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup"
        info ".env respaldado en .env.backup"
    fi

    # Stop
    if [[ "$HAS_SYSTEMD" == "true" ]] && systemctl list-unit-files mnexus-backend.service &>/dev/null; then
        run_with_spinner "Deteniendo servicio..." sudo systemctl stop mnexus-backend
    fi

    # Reemplazar código
    setup_backend_code
    install_npm_dependencies

    # Start
    if [[ "$HAS_SYSTEMD" == "true" ]] && systemctl list-unit-files mnexus-backend.service &>/dev/null; then
        run_with_spinner "Reiniciando servicio..." sudo systemctl start mnexus-backend
        sleep 2
    fi

    # Verify
    if curl -sf "http://localhost:4000/api/v1/health" &>/dev/null; then
        success "Actualización completa. Health check OK."
    else
        warn "Health check falló. Revisa el log."
    fi
}

# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

main() {
    # Lock file (evita instalaciones concurrentes)
    if [[ -f "$LOCK_FILE" ]]; then
        if kill -0 $(cat "$LOCK_FILE") 2>/dev/null; then
            fatal "Otra instalación en curso (PID $(cat $LOCK_FILE))"
        else
            rm -f "$LOCK_FILE"
        fi
    fi
    echo $$ > "$LOCK_FILE"

    # Parse args
    AUTO_MODE=false
    UPDATE_MODE=false
    UNINSTALL_MODE=false
    USE_DOCKER=false
    WHISPER=false
    OLLAMA=false
    TESSERACT=false
    NGINX=false
    VERBOSE=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h)          print_help ;;
            --auto)            AUTO_MODE=true ;;
            --update)          UPDATE_MODE=true ;;
            --uninstall)       UNINSTALL_MODE=true ;;
            --port)            SERVER_PORT="$2"; shift ;;
            --storage)         STORAGE_PATH="$2"; shift ;;
            --domain)          DOMAIN="$2"; shift ;;
            --with-whisper)    WHISPER=true ;;
            --with-ollama)     OLLAMA=true ;;
            --with-tesseract)  TESSERACT=true ;;
            --with-nginx)      NGINX=true ;;
            --docker)          USE_DOCKER=true ;;
            --verbose)         VERBOSE=true; set -x ;;
            *)                 warn "Opción desconocida: $1" ;;
        esac
        shift
    done

    print_banner

    if [[ "$UNINSTALL_MODE" == "true" ]]; then
        detect_os
        uninstall
        cleanup_and_exit 0
    fi

    if [[ "$UPDATE_MODE" == "true" ]]; then
        detect_os
        update
        cleanup_and_exit 0
    fi

    # FASE 1-3: Detección
    detect_os
    detect_resources
    detect_existing
    detect_node

    # FASE 4: Wizard
    if [[ "$AUTO_MODE" == "true" ]]; then
        header "Fase 4/7: Configuración (modo automático)"
        SERVER_PORT="$DEFAULT_PORT"
        BIND_HOST="127.0.0.1"
        STORAGE_PATH="$DEFAULT_STORAGE"
        INDEX_PATH="$INDEX_PATH"
        INDEX_PATH="$STORAGE_PATH-index.db"
        MAX_BACKUP_SIZE=$((DEFAULT_MAX_BACKUP_MB * 1024 * 1024))
        JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64)
        INSTALL_MODE="direct"
        if [[ "$HAS_SYSTEMD" == "true" ]]; then INSTALL_MODE="systemd"; fi
        if [[ "$HAS_LAUNCHD" == "true" ]]; then INSTALL_MODE="launchd"; fi
        if [[ "$USE_DOCKER" == "true" ]] && [[ "$HAS_DOCKER" == "true" ]]; then INSTALL_MODE="docker"; fi
        ENABLE_WHISPER="$WHISPER"
        ENABLE_OLLAMA="$OLLAMA"
        ENABLE_TESSERACT="$TESSERACT"
        ENABLE_NGINX="$NGINX"
        if [[ "$ENABLE_TESSERACT" == "true" && $TOTAL_RAM_MB -lt 1024 ]]; then
            ENABLE_TESSERACT=false
        fi
        info "Configuración automática aplicada"
    else
        wizard_intro
        wizard_port
        wizard_storage
        wizard_security
        wizard_mode
        wizard_features
    fi

    # Resumen de configuración
    header "Resumen de configuración"
    echo ""
    cat <<EOF
  Modo:           ${INSTALL_MODE}
  Puerto:         ${SERVER_PORT} (bind ${BIND_HOST})
  Storage:        ${STORAGE_PATH}
  Index:          ${INDEX_PATH}
  Max backup:     $((MAX_BACKUP_SIZE/1024/1024)) MB
EOF
    [[ "$ENABLE_WHISPER" == "true" ]] && echo "  Whisper:       habilitado"
    [[ "$ENABLE_OLLAMA" == "true" ]] && echo "  Ollama:        habilitado"
    [[ "$ENABLE_TESSERACT" == "true" ]] && echo "  Tesseract:     habilitado"
    [[ "$ENABLE_NGINX" == "true" ]] && echo "  Nginx:         habilitado (dominio: $DOMAIN)"
    echo ""

    if [[ "$AUTO_MODE" != "true" ]]; then
        if ! ask_bool "¿Proceder con la instalación" "y"; then
            info "Cancelado por el usuario"
            cleanup_and_exit 0
        fi
    fi

    # FASE 5-6: Instalación
    install_dependencies
    install_node
    setup_user
    setup_directories
    setup_backend_code
    install_npm_dependencies
    setup_env
    install_optional_features
    setup_systemd
    setup_launchd
    setup_nginx
    setup_firewall

    # FASE 7: Verificación
    start_and_verify
    test_backup_endpoint

    # Output final
    print_summary

    cleanup_and_exit 0
}

main "$@"
