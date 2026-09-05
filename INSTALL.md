# M-NEXUS — Guía de instalación

> Última versión: **v0.35.0** · **URL:** https://github.com/rgdi/m-nexus/releases/latest

## Método rápido (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --component=all --tag=stable
```

### Componentes

| Flag | Qué instala |
|---|---|
| `--component=backend` | Solo el backend Node.js (systemd) |
| `--component=plugin` | Solo el plugin de Obsidian (instrucciones) |
| `--component=companion` | Solo el companion (instrucciones APK) |
| `--component=all` | Backend + plugin + companion (default) |

### Tags (canales)

| Tag | Significado |
|---|---|
| `stable` | Última release firmada (recomendado) |
| `beta` | Pre-release de la siguiente versión |
| `nightly` | Última build de `main` (puede ser inestable) |

### Otros flags

| Flag | Uso |
|---|---|
| `--update` | Actualiza a la última versión del tag seleccionado |
| `--rollback` | Revierte a la versión anterior (usando backup) |
| `--uninstall` | Borra el backend + datos |
| `--list-versions` | Lista versiones disponibles |
| `--version=v0.35.0` | Instala una versión específica |
| `--auto` | Sin prompts (asume "sí" a todo) |
| `--dry-run` | Solo muestra lo que haría |

---

## Instalación manual (paso a paso)

### Requisitos

- **Backend:** Node.js >= 22, npm >= 10, 512 MB RAM, 2 GB disco
- **Plugin:** Obsidian >= 1.5.0
- **Companion:** Android >= 7.0 (API 24), pero todas las features requieren Android 10+ (API 29)
- **OS (server):** Linux (Ubuntu 22+, Debian 11+, CentOS 9+), macOS 12+, WSL2

### 1. Plugin de Obsidian

#### Vía Community Plugins (recomendado)
1. Abre Obsidian → Settings → Community plugins
2. Click "Browse" → busca "M-NEXUS"
3. Click "Install" → "Enable"

#### Vía BRAT (beta)
1. Instala [BRAT](https://github.com/TfTHacker/obsidian42-brat) desde Community plugins
2. En BRAT: "Add Beta plugin" → pega `rgdi/m-nexus`
3. Click "Add Plugin" → habilita M-NEXUS

#### Manual
1. Descarga [m-nexus-plugin.zip](https://github.com/rgdi/m-nexus/releases/latest) (última versión)
2. Extrae en `{vault}/.obsidian/plugins/m-nexus/`
   - Asegúrate de que existan: `main.js`, `manifest.json`, `styles.css`
3. Settings → Community plugins → Enable "M-NEXUS"

### 2. Backend (Node.js)

#### Opción A: install.sh
```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --component=backend --auto
```

#### Opción B: Manual con systemd
```bash
# 1. Instalar Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Crear usuario y directorio
sudo useradd -r -m -d /var/lib/mnexus mnexus
sudo mkdir -p /var/lib/mnexus/{data,uploads,backups}
sudo chown -R mnexus:mnexus /var/lib/mnexus

# 3. Generar master key para Secret Manager
export MNEXUS_SECRET_MASTER_KEY=$(openssl rand -hex 32)
echo "MNEXUS_SECRET_MASTER_KEY=$MNEXUS_SECRET_MASTER_KEY" | sudo tee /etc/mnexus.env

# 4. Descargar e instalar
sudo mkdir -p /opt/mnexus
cd /opt/mnexus
sudo curl -fsSL https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-backend.zip -o backend.zip
sudo unzip backend.zip
sudo npm install --production

# 5. Crear servicio systemd
sudo tee /etc/systemd/system/mnexus.service << 'EOF'
[Unit]
Description=M-NEXUS Backend
After=network.target

[Service]
Type=simple
User=mnexus
WorkingDirectory=/opt/mnexus
EnvironmentFile=/etc/mnexus.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

#### Opción C: Docker
```bash
docker run -d \
  --name mnexus \
  -p 8787:8787 \
  -v /var/lib/mnexus:/data \
  -e MNEXUS_SECRET_MASTER_KEY=$(openssl rand -hex 32) \
  ghcr.io/rgdi/m-nexus-backend:v0.35.0
```

### 3. Companion App Android

1. Descarga [m-nexus-companion.apk](https://github.com/rgdi/m-nexus/releases/latest) (~52 MB)
2. En Android: Settings → Apps → Install unknown apps → Permitir para tu navegador/file manager
3. Abre el APK descargado
4. Click "Instalar"
5. Abre la app → completa el wizard de 8 pasos:
   - **Bienvenida** → Siguiente
   - **Permisos** → "Pedir todos" → concede los 6 permisos
   - **Batería** → "Pedir desactivar" → confirma en la pantalla del sistema
   - **Backend** → ingresa la URL (ej. `http://192.168.1.10:8787`) → "Probar"
   - **Calendario** → escoge un calendario (o salta)
   - **Vault** → detecta el vault o salta
   - **Plugin** → "Descargar e instalar plugin" (si tienes vault)
   - **Listo** → Finalizar

> **Tip:** Long-press en el logo del splash activa "test mode" (fuerza wizard siempre).

---

## Verificar instalación

```bash
# Backend
curl http://localhost:8787/api/v1/health
# → {"status":"ok","version":"0.35.0",...}

# Plugin: en Obsidian, Settings → M-NEXUS → "Backend URL" debe decir OK
# Companion: en Home, debe verse el backend como conectado
```

---

## Configurar API keys (LLM)

Para usar IA (DeepSeek, OpenAI, etc.), guarda las keys en el Secret Manager:

### Opción A: por la API
```bash
# DeepSeek
curl -X POST http://localhost:8787/api/v1/secrets/deepseek_api_key \
  -H "Content-Type: application/json" \
  -d '{"value":"sk-..."}'

# OpenAI
curl -X POST http://localhost:8787/api/v1/secrets/openai_api_key \
  -H "Content-Type: application/json" \
  -d '{"value":"sk-..."}'
```

### Opción B: variables de entorno
```bash
echo "MNEXUS_OPENAI_API_KEY=sk-..." | sudo tee -a /etc/mnexus.env
sudo systemctl restart mnexus
```

> **Importante:** El `MNEXUS_SECRET_MASTER_KEY` debe estar configurado antes de usar Secret Manager.
> Si lo cambiaste, los secrets existentes no se podrán descifrar (haz `rotateMasterKey`).

---

## Rollback (si algo falla)

```bash
# Listar backups disponibles
curl http://localhost:8787/api/v1/rollback/list

# Restaurar uno específico
curl -X POST http://localhost:8787/api/v1/rollback/restore \
  -H "Content-Type: application/json" \
  -d '{"backupId":"backup-1693838400","confirm":true}'

# O usar install.sh
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --rollback --auto
```

Los backups se guardan en `/var/lib/mnexus/backups/` (mantiene los últimos 3).

---

## Actualizar a una nueva versión

### Plugin
- Auto-update: el plugin chequea cada 6h, muestra banner si hay update
- Manual: en Obsidian → Settings → M-NEXUS → "Check for updates"

### Backend
```bash
# Auto
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --update --component=backend --auto

# Manual
cd /opt/mnexus
git pull  # o descarga el ZIP
sudo systemctl restart mnexus
```

### Companion
- Auto-update: chequea cada 6h, muestra diálogo
- Manual: descarga APK de la release, instálalo encima (la firma debe coincidir)

---

## Logs

| Componente | Comando |
|---|---|
| Backend (systemd) | `journalctl -u mnexus -f` |
| Backend (Docker) | `docker logs -f mnexus` |
| Plugin | Obsidian → Ctrl+Shift+I → Console |
| Companion | `adb logcat -s mnexus` (o Flutter DevTools) |

---

## Troubleshooting

| Problema | Solución |
|---|---|
| `lsof: 8787: already in use` | `MNEXUS_PORT=8888` en `/etc/mnexus.env` |
| `MNEXUS_SECRET_MASTER_KEY` perdido | Restaurar de backup o rotar con `rotateMasterKey` |
| Plugin no se conecta | Verifica URL en Settings; revisa que backend es accesible |
| Companion no puede instalar APK | Verifica "Instalar apps de origen desconocido" en Settings de Android |
| Permission denied en vault | Settings → Apps → M-NEXUS → Storage |
| Battery mata la grabación | Settings → Apps → M-NEXUS → Battery → Unrestricted |
| No se detecta el vault | Usa "Elegir manualmente" (SAF) o concede MANAGE_EXTERNAL_STORAGE |
| Plugin ZIP sin manifest.json | Bug del CI (v0.35 lo arregla): descarga de nuevo |

Más ayuda: abre un [issue](https://github.com/rgdi/m-nexus/issues).
