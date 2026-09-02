# M-NEXUS Backup System — Guía de Instalación

**v0.28.0** · Sistema de backups ultrarrápido con ZIP binario y drag-and-drop

Esta guía te lleva de cero a un sistema de backups completamente funcional: plugin
de Obsidian, backend con endpoints de backup, y app móvil para detección automática
de vaults.

---

## Tabla de contenidos

1. [Requisitos](#requisitos)
2. [Instalación rápida (5 minutos)](#instalación-rápida-5-minutos)
3. [Instalación del backend](#1-instalación-del-backend)
4. [Instalación del plugin de Obsidian](#2-instalación-del-plugin-de-obsidian)
5. [Instalación de la app móvil (opcional)](#3-instalación-de-la-app-móvil-opcional)
6. [Configuración inicial](#4-configuración-inicial)
7. [Verificación](#5-verificación)
8. [Próximos pasos](#próximos-pasos)

---

## Requisitos

| Componente | Requisito mínimo | Recomendado |
|---|---|---|
| **Backend** | Node.js 22.0+ (built-in `node:sqlite`) | Node.js 22 LTS |
| **Almacenamiento** | 5 GB libres | 50 GB+ para retención larga |
| **Sistema operativo** | Linux, macOS, Windows, Docker | Linux server |
| **Plugin** | Obsidian 1.5+ | Obsidian 1.7+ |
| **App móvil** (opcional) | Android 9+ | Android 13+ |
| **Red** | Plugin ↔ Backend accesible | Tailscale/VPN para redes no confiables |

> **Importante**: el backend usa `node:sqlite`, que es **experimental en Node 22**.
> Si tu Node es 21 o inferior, actualiza primero.

---

## Instalación rápida (5 minutos)

Si tienes prisa y Node 22 instalado:

```bash
# 1. Backend (en una terminal)
cd m-nexus-backend-v0.28.0
npm install --omit=dev
JWT_SECRET="$(openssl rand -hex 32)" \
  BACKUP_STORAGE_PATH=/var/lib/mnexus/backups \
  PORT=4000 \
  node dist/server.js

# 2. Plugin (en Obsidian)
# Settings → Community plugins → Install from disk
# Selecciona: m-nexus-plugin-v0.28.0.zip
# (contiene main.js, manifest.json, styles.css, versions.json)
```

¡Listo! Abre el panel de backups con el comando **`📦 Gestor de backups`**.

---

## 1. Instalación del backend

### Opción A: Instalación local (recomendada para empezar)

```bash
# 1. Descomprime
unzip m-nexus-backend-v0.28.0.zip -d m-nexus-backend
cd m-nexus-backend

# 2. Instala dependencias de producción (~100MB)
npm install --omit=dev

# 3. Genera un secret JWT seguro y guárdalo
echo "export JWT_SECRET=\"$(openssl rand -hex 32)\"" >> ~/.mnexus.env

# 4. Crea el directorio de backups
sudo mkdir -p /var/lib/mnexus/backups
sudo chown $USER:$USER /var/lib/mnexus/backups

# 5. Arranca el servidor
source ~/.mnexus.env
node dist/server.js
```

Deberías ver:

```
{"level":30,"time":...,"msg":"M-NEXUS Backend v0.28.0 escuchando en http://0.0.0.0:4000"}
```

### Opción B: Con variables de entorno inline

```bash
JWT_SECRET="tu-secret-seguro-aqui" \
BACKUP_STORAGE_PATH=/var/lib/mnexus/backups \
BACKUP_INDEX_PATH=/var/lib/mnexus/backups-index.db \
MAX_BACKUP_SIZE=524288000 \
PORT=4000 \
HOST=0.0.0.0 \
node dist/server.js
```

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `4000` | Puerto TCP |
| `HOST` | `0.0.0.0` | Interfaz de red |
| `JWT_SECRET` | `change-me-in-production` | **Cambiar en producción** |
| `BACKUP_STORAGE_PATH` | `/var/lib/mnexus/backups` | Directorio de .zip |
| `BACKUP_INDEX_PATH` | `/var/lib/mnexus/backups-index.db` | SQLite de índice |
| `MAX_BACKUP_SIZE` | `524288000` (500MB) | Tamaño máximo por backup |
| `AUTH_REQUIRED` | `true` | Si `false`, desactiva auth JWT (solo para LAN) |

### Opción C: Systemd (producción Linux)

```bash
# 1. Crear usuario dedicado
sudo useradd -r -s /bin/false mnexus

# 2. Copiar archivos
sudo mkdir -p /opt/mnexus
sudo cp -r dist /opt/mnexus/
sudo cp package.json /opt/mnexus/
sudo chown -R mnexus:mnexus /opt/mnexus
sudo chown -R mnexus:mnexus /var/lib/mnexus

# 3. Crear servicio systemd
sudo tee /etc/systemd/system/mnexus-backend.service << 'EOF'
[Unit]
Description=M-NEXUS Backend
After=network.target

[Service]
Type=simple
User=mnexus
WorkingDirectory=/opt/mnexus
EnvironmentFile=/etc/mnexus/backend.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/mnexus

[Install]
WantedBy=multi-user.target
EOF

# 4. Crear archivo de entorno
sudo tee /etc/mnexus/backend.env << EOF
JWT_SECRET=$(openssl rand -hex 32)
PORT=4000
HOST=127.0.0.1
BACKUP_STORAGE_PATH=/var/lib/mnexus/backups
BACKUP_INDEX_PATH=/var/lib/mnexus/backups-index.db
MAX_BACKUP_SIZE=524288000
EOF
sudo chmod 600 /etc/mnexus/backend.env

# 5. Activar y arrancar
sudo systemctl daemon-reload
sudo systemctl enable --now mnexus-backend
sudo systemctl status mnexus-backend
```

### Opción D: Docker (recomendada para producción)

Ver [BACKUP_DOCKER.md](./BACKUP_DOCKER.md) para la guía completa con `docker-compose`.

Resumen rápido:

```bash
docker run -d \
  --name mnexus-backend \
  --restart unless-stopped \
  -p 4000:4000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -v mnexus-backups:/var/lib/mnexus/backups \
  node:22-alpine \
  sh -c "cd /app && npm install --omit=dev && node dist/server.js"
```

---

## 2. Instalación del plugin de Obsidian

### Opción A: Instalación manual (recomendada para v0.28)

```bash
# 1. Localiza tu vault de Obsidian
# macOS:   ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>/
# Linux:   ~/.config/obsidian/<vault>/
# Windows: %APPDATA%\Obsidian\<vault>\
# iOS:     On My iPhone → Obsidian → <vault>
# Android: /storage/emulated/0/Documents/<vault>/

# 2. Copia los 4 archivos del ZIP al vault
VAULT="/path/to/your/vault"
PLUGIN_DIR="$VAULT/.obsidian/plugins/m-nexus"

mkdir -p "$PLUGIN_DIR"
cd "$PLUGIN_DIR"
unzip /path/to/m-nexus-plugin-v0.28.0.zip

# 3. Verifica que los 4 archivos están
ls -la
# main.js
# manifest.json
# styles.css
# versions.json
```

### Opción B: Desde Obsidian (Community plugins)

1. Abre Obsidian → **Settings** (icono ⚙️)
2. **Community plugins** → **Browse** (o en v1.5+ ves el toggle "Community plugins")
3. Busca "M-NEXUS" (si está publicado)
4. Click **Install** → **Enable**

> **Nota**: v0.28 todavía no está en la Community Plugins store. Usa la Opción A.

### Opción C: BRAT (Beta Reviewer's Auto-update Tool) — para v0.28 antes de store

1. Instala [BRAT](https://github.com/TfTHacker/obsidian42-brat) desde Community plugins
2. En BRAT: **Add Beta plugin** → pega el repo: `rodrigo/m-nexus-obsidian`
3. Selecciona versión: `0.28.0`
4. Click **Add Plugin** → habilita M-NEXUS

### Habilitar el plugin

1. **Settings** → **Community plugins**
2. Busca "M-NEXUS" en plugins instalados
3. Toggle **ON**
4. (Opcional) **Don't restrict mode** si Obsidian te lo pide

Verás en la cinta izquierda el icono del plugin.

### Configurar el backend en el plugin

1. **Settings** → **M-NEXUS** (búscalo en la lista de plugins)
2. Sección **Backend**:
   - **URL del servidor**: `http://localhost:4000` (o tu IP:puerto)
   - **Auto-registrar dispositivo**: ✅ ON
3. Click **Guardar**
4. Espera ~3 segundos a que se registre automáticamente

Si todo va bien, en el log inferior verás:

```
[INFO] Device registered: <uuid>
[INFO] BackupManager inicializado
```

---

## 3. Instalación de la app móvil (opcional)

La app móvil (Flutter Android) detecta vaults de Obsidian en el dispositivo e
instala/actualiza el plugin. Es opcional — sin ella, puedes usar la instalación
manual del plugin.

### Compilar desde fuente

```bash
# 1. Instala Flutter (si no lo tienes)
# https://docs.flutter.dev/get-started/install

# 2. Descomprime
unzip mnexus-installer-v0.28.0.zip -d mnexus-installer
cd mnexus-installer

# 3. Instala dependencias
flutter pub get

# 4. Compila APK release
flutter build apk --release

# 5. El APK está en:
ls -la build/app/outputs/flutter-apk/app-release.apk
```

### Instalar en el dispositivo

```bash
# Conecta el dispositivo por USB con depuración activada
adb install build/app/outputs/flutter-apk/app-release.apk
```

O transfiere el `.apk` al teléfono y ábrelo (con permiso "instalar de fuentes
desconocidas" activado).

### Permisos que pedirá

- **Almacenamiento**: para leer vaults en `/storage/emulated/0/Documents/`
- **Micrófono**: para grabar voice notes (opcional)
- **Internet**: para descargar actualizaciones del plugin

---

## 4. Configuración inicial

### Configuración del backend (producción)

Una vez instalado, ajusta estas variables:

```bash
# /etc/mnexus/backend.env
JWT_SECRET=<secret-generado-aleatorio-32-bytes-hex>
PORT=4000
HOST=0.0.0.0             # Cambia a 127.0.0.1 si usas reverse proxy
BACKUP_STORAGE_PATH=/var/lib/mnexus/backups
BACKUP_INDEX_PATH=/var/lib/mnexus/backups-index.db
MAX_BACKUP_SIZE=524288000  # 500MB
AUTH_REQUIRED=true          # true en producción
LOG_LEVEL=info              # debug para troubleshooting
```

### Reverse proxy con HTTPS (Nginx)

```nginx
# /etc/nginx/sites-available/mnexus
server {
  listen 443 ssl http2;
  server_name mnexus.example.com;

  ssl_certificate /etc/letsencrypt/live/mnexus.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mnexus.example.com/privkey.pem;

  # CORS para el plugin de Obsidian
  add_header Access-Control-Allow-Origin "*" always;
  add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
  add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Device-Id, X-Backup-Metadata" always;

  # Backup-specific: permite uploads grandes
  client_max_body_size 600M;
  proxy_read_timeout 300s;
  proxy_send_timeout 300s;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mnexus /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Backup automático del índice (cron)

```bash
# Backup diario del .db + sync a S3
sudo tee /etc/cron.d/mnexus-backup-db << 'EOF'
# Backup del índice a las 3am
0 3 * * * mnexus cp /var/lib/mnexus/backups-index.db /var/lib/mnexus/backups-index.db.$(date +\%Y\%m\%d)
0 4 * * * mnexus find /var/lib/mnexus -name "backups-index.db.*" -mtime +30 -delete

# Sync a S3 a las 5am (requiere aws-cli configurado)
0 5 * * * mnexus aws s3 sync /var/lib/mnexus/backups/ s3://mi-vault-mnexus/backups/ --exclude "*.tmp"
EOF
```

### Configuración del plugin

Settings → M-NEXUS → **Backups**:

| Setting | Default | Descripción |
|---|---|---|
| Auto-backup | ✅ ON | Crea backup automático cada 24h |
| Subir al server | ✅ ON | Sube al backend tras crear local |
| Máximo local | 10 | Cuántos snapshots locales mantener |
| Intervalo (h) | 24 | Cada cuántas horas auto-backup |
| Subir a WebDAV | ❌ OFF | (no implementado en v0.28) |

---

## 5. Verificación

### Health check del backend

```bash
curl -s http://localhost:4000/api/v1/health | python3 -m json.tool
```

Salida esperada:

```json
{
  "status": "degraded",
  "version": "0.28.0",
  "providers": {
    "whisper": "unavailable",
    "ollama": "unavailable",
    "openrouter": "unavailable",
    "tesseract": "available",
    "embeddings": "unavailable"
  },
  "uptimeSec": 42
}
```

> **"degraded"** es normal si no tienes Whisper/Ollama instalados. El sistema de
> backups funciona con cualquier status. Lo importante es `version: 0.28.0`.

### Verificar endpoints de backup

```bash
# 1. Registrar un device de prueba
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"verify-1","deviceName":"Verify","platform":"linux","pluginVersion":"0.28.0","protocolVersion":"1"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# 2. Subir un ZIP de prueba
echo "test" > /tmp/test.txt
cd /tmp && zip test.zip test.txt
SHA=$(sha256sum /tmp/test.zip | cut -d' ' -f1)

curl -X POST http://localhost:4000/api/v1/backup/upload \
  -H "Content-Type: application/zip" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Device-Id: verify-1" \
  -H "X-Backup-Metadata: {\"kind\":\"manual\",\"vaultPath\":\"test.zip\",\"fileCount\":1,\"sha256\":\"$SHA\"}" \
  --data-binary @/tmp/test.zip
# → {"id":"manual-...","size":...,"uploadedAt":"...","receivedBytes":...,"serverDurationMs":<10}

# 3. Listar
curl -H "Authorization: Bearer $TOKEN" -H "X-Device-Id: verify-1" \
  http://localhost:4000/api/v1/backup/list
# → [{"id":"...","size":...,"sha256":"..."}]

# 4. Descargar dump (drag-and-drop)
curl -H "Authorization: Bearer $TOKEN" -H "X-Device-Id: verify-1" \
  http://localhost:4000/api/v1/backup/dump -o /tmp/index.db
file /tmp/index.db
# → /tmp/index.db: SQLite 3.x database
```

### Verificar el plugin

1. Abre Obsidian con el plugin habilitado
2. **Command Palette** (Ctrl/Cmd+P) → escribe "backup"
3. Click **📦 Gestor de backups (con drag-and-drop)**
4. Deberías ver:
   - Sección **💾 Backups locales** (vacía al inicio)
   - Sección **☁️ Backups en el servidor** (vacía al inicio)
   - **Drop zone** en la parte superior
5. Click **➕ Backup manual** → debería crear un backup local en ~1 segundo
6. Espera 2-3 segundos → debería aparecer también en **☁️ Backups en el servidor**

Si todo esto funciona, **la instalación está completa**.

---

## Próximos pasos

- **[BACKUP_USER_GUIDE.md](./BACKUP_USER_GUIDE.md)** — Cómo usar drag-and-drop, restaurar, organizar
- **[BACKUP_ADMIN_GUIDE.md](./BACKUP_ADMIN_GUIDE.md)** — Administración del server: SQLite, dumps, automatización
- **[BACKUP_DOCKER.md](./BACKUP_DOCKER.md)** — Deployment con docker-compose
- **[BACKUP_TROUBLESHOOTING.md](./BACKUP_TROUBLESHOOTING.md)** — Problemas comunes y soluciones

---

## Resumen de archivos instalados

```
/var/lib/mnexus/
├── backups/
│   ├── <deviceId-1>/
│   │   ├── manual-2026-09-01T15-30-00-<rand>.zip
│   │   ├── auto-2026-09-02T03-00-00-<rand>.zip
│   │   └── emergency-2026-09-03T08-15-00-<rand>.zip
│   └── <deviceId-2>/
│       └── ...
└── backups-index.db          ← SQLite con metadata

<vault>/.obsidian/plugins/m-nexus/
├── main.js
├── manifest.json
├── styles.css
└── versions.json

<vault>/.mnexus-backups/      ← Snapshots locales (no se suben al server)
├── manual-2026-09-01T15-30-00-<rand>.mnexus-backup
├── auto-2026-09-02T03-00-00-<rand>.mnexus-backup
└── ...
```

**Drag-and-drop = mover un archivo.** El índice SQLite es un `.db` regular que
puedes copiar con `cp`, `rsync`, `scp`, USB, o cualquier método.

¿Problemas? → [BACKUP_TROUBLESHOOTING.md](./BACKUP_TROUBLESHOOTING.md)
