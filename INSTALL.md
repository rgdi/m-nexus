# M-NEXUS — Guía de instalación

## Método rápido (recomendado)

El instalador automático detecta tu OS, instala dependencias, y configura
cada componente con systemd. Funciona en Linux, macOS y WSL.

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

### Tags

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
| `--version=v0.32.0` | Instala una versión específica |
| `--auto` | Sin prompts (asume "sí" a todo) |
| `--dry-run` | Solo muestra lo que haría |

## Instalación manual

### Plugin de Obsidian

1. Descarga el ZIP desde [Releases](https://github.com/rgdi/m-nexus/releases/latest)
2. Extrae en `{vault}/.obsidian/plugins/m-nexus/`
3. Settings → Community plugins → Enable "M-NEXUS"

### Backend (Node 22+)

```bash
git clone https://github.com/rgdi/m-nexus.git
cd m-nexus/backend
npm install
npm run build
node dist/index.js
```

El backend escucha en `:8787` por default. Configurable vía `MNEXUS_PORT`.

### Companion Android

1. Descarga el APK desde [Releases](https://github.com/rgdi/m-nexus/releases/latest)
2. En Android: Settings → Security → Install unknown apps → Allow
3. Abre el APK
4. Al primer launch, completa el wizard (te pregunta URL del backend)

## Verificar instalación

```bash
# Backend
curl http://localhost:8787/api/v1/health
# → {"status":"ok","version":"0.33.0",...}

# Plugin: abrir Obsidian → Settings → M-NEXUS → debería verse "Conectado"
# Companion: abrir app → debería verse el wizard (solo primer launch)
```

## Configurar API keys (LLM)

Para usar IA (DeepSeek, OpenAI, etc.), guarda las keys en el Secret Manager:

```bash
# Opción A: por la API
curl -X POST http://localhost:8787/api/v1/secrets/openai_api_key \
  -H "Content-Type: application/json" \
  -d '{"value":"sk-..."}'

# Opción B: variable de entorno MNEXUS_SECRET_MASTER_KEY
# (necesaria para descifrar)
export MNEXUS_SECRET_MASTER_KEY=$(openssl rand -hex 32)
echo "MNEXUS_SECRET_MASTER_KEY=$MNEXUS_SECRET_MASTER_KEY" >> /etc/mnexus.env
```

## Rollback (si algo falla)

```bash
# El instalador guarda 3 backups en /var/backups/mnexus
ls /var/backups/mnexus/

# Revertir a la versión anterior
sudo /var/backups/mnexus/restore.sh

# O vía la API
curl -X POST http://localhost:8787/api/v1/rollback/restore \
  -H "Content-Type: application/json" \
  -d '{"backupId":"backup-1693876543210","confirm":true}'
```

## Logs

- Backend: `journalctl -u mnexus -f`
- Plugin: abrir DevTools en Obsidian (Ctrl+Shift+I) → Console
- Companion: `adb logcat -s mnexus`

## Troubleshooting

### El backend no arranca
```bash
sudo journalctl -u mnexus -n 50
# Común: puerto 8787 ocupado, Node < 22, permisos
```

### El plugin no se conecta al backend
- Verifica URL: Settings → M-NEXUS → Backend URL
- Verifica que el backend está accesible: `curl $URL/api/v1/health`
- Si usas HTTPS con cert self-signed, el plugin requiere `--insecure-https`

### El companion no puede instalar el plugin
- Verifica que el APK está firmado (Settings → Apps → M-NEXUS → App info)
- Si dice "App not installed", probablemente es signature mismatch (desinstala y reinstala)

Más ayuda: abre un [issue](https://github.com/rgdi/m-nexus/issues).
