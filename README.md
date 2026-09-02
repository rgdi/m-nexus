# M-NEXUS — Sistema de estudio médico para Obsidian

**v0.28.0** · Knowledge graph + adaptive quiz + StudyOrchestrator + FSRS boost + Free review + Backups ultrarrápidos (ZIP binario con drag-and-drop)

M-NEXUS es un plugin de Obsidian + backend opcional + app companion Android
para estudio médico. Diseñado para ser **humano en el loop**: la IA propone,
tú decides.

---

## 🚀 Descarga rápida (autoupdating)

Estos enlaces apuntan siempre a la **última versión**:

| Componente | Descarga | Auto-update |
|---|---|---|
| 🧩 **Plugin Obsidian** | [⬇ m-nexus-plugin.zip](https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-plugin.zip) | BRAT / Community Plugins |
| ⚙️ **Backend** (Node 22+) | [⬇ m-nexus-backend.zip](https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-backend.zip) | `install.sh --update` |
| 📱 **Companion App** (Android) | [⬇ m-nexus-companion.apk](https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-companion.apk) | Notificación en la app |
| 🔧 **Install script** | [⬇ install.sh](https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-install.sh) | — |

> 📱 **Nota sobre el APK**: la primera release (v0.28.0) no incluye APK pre-compilado. Para generar la companion app Android necesitas Flutter SDK + Android SDK. Ver [docs/BUILD_APK.md](docs/BUILD_APK.md) o compílalo con:
> ```bash
> git clone https://github.com/rgdi/m-nexus.git
> cd m-nexus/companion-app
> flutter pub get
> flutter build apk --release
> ```

**Última release**: [github.com/rgdi/m-nexus/releases/latest](https://github.com/rgdi/m-nexus/releases/latest)

---

## ⚡ Instalación rápida (5 minutos)

```bash
# 1. Backend
curl -fsSL https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-install.sh | bash

# 2. Plugin de Obsidian
# Settings → Community plugins → Install from disk
# Selecciona: m-nexus-plugin.zip
```

El script de instalación es **universal**: detecta tu OS, RAM, CPU, disco, y
adapta la instalación. Soporta Linux, macOS, WSL, Docker, systemd, launchd.

---

## 📚 Documentación

| Guía | Descripción |
|---|---|
| [INSTALL](docs/BACKUP_INSTALL.md) | Instalación detallada del backend (4 opciones) |
| [USER GUIDE](docs/BACKUP_USER_GUIDE.md) | Cómo usar el sistema de backups con drag-and-drop |
| [ADMIN](docs/BACKUP_ADMIN_GUIDE.md) | Mantenimiento del server, SQLite, S3, monitorización |
| [DOCKER](docs/BACKUP_DOCKER.md) | Deployment con docker-compose + Nginx + TLS |
| [TROUBLESHOOTING](docs/BACKUP_TROUBLESHOOTING.md) | Problemas comunes con soluciones |

Más documentación en [docs/](docs/).

---

## 🎯 Features principales

### Plugin de Obsidian
- **Knowledge graph** + **adaptive quiz** con mastery bayesiano
- **StudyOrchestrator** (agente IA que genera propuestas)
- **FSRS boost** integrado con knowledge mastery
- **Free review** sin scheduling (estudia lo que TÚ quieras)
- **Snooze system** ("no me molestes con esto por X tiempo")
- **Backups ZIP binarios** con drag-and-drop a un `.db` SQLite
- **18 subsistemas lazy** que solo se cargan cuando se necesitan
- **Logging exhaustivo** + **Caja negra / breadcrumbs** para debugging
- **Human-in-the-loop** estricto: la IA propone, tú apruebas

### Backend (opcional pero recomendado)
- **Whisper** para transcripción de audio
- **OCR** (Tesseract) para imágenes
- **LLM** (Ollama, OpenRouter) para chat y propuestas
- **Embeddings** + RAG para búsqueda semántica
- **Cross-relevance** entre notas
- **Knowledge graph** persistente por usuario
- **Adaptive quiz** server-side con FSRS

### Companion App (Android, Flutter)
- Detecta vaults de Obsidian en el dispositivo
- Instala/actualiza el plugin automáticamente
- **Voice notes**: graba audio m4a y lo sube al backend
- Auto-clasifica por horario de clases
- Drag & drop de backups

---

## 🏗️ Arquitectura

```
┌──────────────────┐         ┌──────────────────┐
│   Obsidian       │  HTTPS  │   Backend        │
│   (plugin)       │ ◄─────► │   (Node 22+)     │
│                  │         │   Fastify        │
│   - Knowledge    │         │   - Whisper      │
│   - Quiz         │         │   - Tesseract    │
│   - Backups      │         │   - LLM          │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │ ZIP/drag-drop             │ SQLite .db
         │                            │
         ▼                            ▼
   .mnexus-backups/            /var/lib/mnexus/
   {manual,auto,emergency}-    {deviceId}/{id}.zip
   {timestamp}.mnexus-backup   backups-index.db
```

**Thin client**: el plugin NO ejecuta IA localmente, todo va al backend.
**Privacy-first**: E2E encryption opcional por nota.
**Offline-first**: OfflineQueue intercepta cuando el server está caído.

---

## 🔄 Auto-updating

Cada componente verifica updates automáticamente:

| Componente | Mecanismo | Frecuencia |
|---|---|---|
| **Plugin** | Al abrir Obsidian (5s después) | Una vez por sesión |
| **Backend** | Al arrancar el server | Una vez por startup |
| **Companion** | Al abrir la app | Una vez por sesión |

Todos consultan la GitHub Releases API y notifican si hay versión nueva
con un link directo a la release.

Para **autoupdate completo del backend**, ejecuta:
```bash
./install.sh --update
```

Para el **plugin via BRAT** (Beta Reviewer's Auto-update Tool):
1. Instala [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. BRAT → Add Beta plugin → `rgdi/m-nexus`
3. Las nuevas versiones se actualizan automáticamente

---

## 📊 Estado

| Componente | Tests | Tamaño |
|---|---|---|
| Plugin | 1125/1125 ✅ | 163KB |
| Backend | 145/145 ✅ | 63KB |
| Companion (Dart) | 30 tests ✅ | 28KB |
| **TypeScript errors** | **0** en plugin y backend ✅ | |

---

## 🛠️ Development

```bash
# Plugin
cd obsidian-plugin
npm install
npm test
npx esbuild src/main.ts --bundle --format=cjs --platform=node \
  --external:obsidian --external:electron --outfile=dist/main.js

# Backend
cd backend
npm install
npm test
npm run build

# Companion
cd companion-app
flutter pub get
flutter test
flutter build apk --release
```

### Crear un release

```bash
# Bump version
./scripts/bump-version.sh 0.29.0

# Commit
git add -A
git commit -m "Release v0.29.0"
git tag v0.29.0
git push --tags

# GitHub Actions se encarga del resto:
# - Compila todo
# - Crea la release con ZIPs y APK
# - Publica el changelog
```

---

## 📜 Licencia

MIT — ver [LICENSE](LICENSE).

---

## 🙏 Créditos

- **FSRS**: algoritmo de spaced repetition de [open-spaced-repetition](https://github.com/open-spaced-repetition)
- **Obsidian**: plataforma de notas
- **Comunidad**: contribuciones, issues, sugerencias

---

**Repositorio**: [github.com/rgdi/m-nexus](https://github.com/rgdi/m-nexus)
**Issues**: [github.com/rgdi/m-nexus/issues](https://github.com/rgdi/m-nexus/issues)
**Releases**: [github.com/rgdi/m-nexus/releases](https://github.com/rgdi/m-nexus/releases)
