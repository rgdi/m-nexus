# M-NEXUS — Sistema de estudio médico con control humano

[![Release](https://img.shields.io/github/v/release/rgdi/m-nexus)](https://github.com/rgdi/m-nexus/releases/latest)
[![License](https://img.shields.io/github/license/rgdi/m-nexus)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-226%2B%20passing-brightgreen)]()
[![Topic](https://img.shields.io/badge/topics-15-blue)]()

> **v0.45.0** · App standalone (sin Obsidian), Material 3, AdaptiveScaffold, atajos de teclado estilo Obsidian, búsqueda full-text, FSRS spaced repetition, voice notes, multi-dispositivo (Android + Web)

**M-NEXUS** = backend Node.js + app standalone Flutter
para estudio médico con IA en el loop. App 100% independiente: vault local en Android (SAF), markdown viewer, flashcards con FSRS, voice notes, calendar, dashboard adaptativo, atajos de teclado.

Diseñado para ser **humano en el loop**: la IA propone, tú decides.

---

## 🏗️ Arquitectura

```
┌─────────────────┐         ┌──────────────────────────┐
│  Backend Node   │  ←───→  │  M-NEXUS App (standalone)│
│  (v0.45)        │  HTTP   │  (v0.45)                 │
│  TypeScript     │  /JSON  │  Android + Web           │
│  Fastify 5      │         │  Flutter 3.24            │
└─────────────────┘         └──────────────────────────┘
        ↓                              ↓
   Vault notes,                  Vault local (SAF en Android,
   FSRS, secret                  IndexedDB en Web),
   manager,                      Markdown viewer,
   chunked upload                Flashcards (FSRS),
                                 Voice notes, Calendar,
                                 Dashboard adaptativo
```

2 componentes: backend opcional + app standalone. La app funciona
100% offline-first y se sincroniza con el backend cuando está disponible.

---

## 🎯 ¿Qué hace M-NEXUS?

### v0.45.0 — Sistema de error codes unificado
- **🆔 Error codes `EC-XXX-NNN`** — 200 códigos en 28 categorías, frontend + backend sincronizados
- **🛡️ `safeCall` / `safeCallAsync`** — Helpers que centralizan try-catch con logging automático
- **📊 Logger estructurado** — `logOp`, `logError`, `logLifecycle`, `logNetwork`, `logPlatform` con redacción de secretos
- **🌐 Central error handler** — `setErrorHandler` con respuestas JSON + `requestId` para correlación
- **🔒 Redacción automática** — `*.password`, `*.token`, `*.secret`, `*.apiKey` no se loguean
- **🔄 HTTP status code auto-mapeado** — `AUTH`→401, `VAL`→400, `RATE`→429, `DB`/`SEC`→403, `NET`/`EXT`→502
- Ver [`docs/ERROR_CODES.md`](docs/ERROR_CODES.md) y [`docs/LOGGING.md`](docs/LOGGING.md)

### v0.44.2 — Real Settings
- **🎨 Tema dinámico** — system/light/dark, persistido en SharedPreferences
- **📏 Font scale** — 85%/100%/115%/130% vía `MediaQuery.textScaler`
- **🔌 Backend URL** — configurable, vacío = sin backend
- **📂 Vaults dialog** — lista de vaults detectados con método de detección
- **📅 Calendar picker** — permisos + lista de calendarios
- **📳 Vibración toggle** — on/off en tiempo real
- **📋 Changelog view** — histórico de versiones accesible desde Settings

### v0.43.0 — App standalone
- **📦 UNIFIED ARCHITECTURE** — Sin Obsidian, sin plugin: la app es todo
- **🎨 Material 3 + AdaptiveScaffold** — Bottom nav mobile / rail desktop
- **⌨️ Atajos estilo Obsidian** — `Ctrl+1/2/3/4` (nav), `Ctrl+N/S/E/B/I` (formato), `Ctrl+R` (repasar), `Ctrl+/` (buscar)
- **📱 Flutter Web** — PWA con splash + manifest
- **🧙 Setup wizard simplificado** — 6 pasos: Bienvenida → Permisos → Batería → Backend → Vault → Listo
- **🔋 Battery optimization** — desactivación guiada desde el wizard (Android 6+)
- **📅 Calendar selector robusto** — diálogo con StatefulBuilder, color avatar, auto-permiso
- **🔄 Sync queue offline-first** — cada recording tiene badge de estado (pending/uploading/synced/failed)
- **📲 SAF picker** — seleccionar vault manualmente con Storage Access Framework

### v0.33.0 — Notion-style
- **🗂️ Notion-style databases** — Typed properties (text/number/select/multi/date/url/email/relation/formula)
- **🔐 Secret Manager** — AES-256-GCM, API keys cifradas
- **🔄 Conflict Resolution** — LWW por FIELD con vector clocks
- **📦 Chunked Upload** — 1 MB chunks, resumable, SHA-256 verify
- **⏪ Rollback** — Backup antes de update, restore con un click

### Siempre
- **🧠 FSRS spaced repetition** — Algoritmo moderno (mejor que SM-2/Anki)
- **🤖 Proposals de IA** — Flashcards, resúmenes, preguntas
- **💾 Backup ultrarrápido** — ZIP binario con SQLite index
- **🔌 Offline-first** — Cola de cambios, sync cuando hay red
- **🚀 Auto-update** — Los 3 componentes se actualizan solos

---

## 🚀 Quick start (60 segundos)

### Opción A — Instalador automático (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --component=all --tag=stable
```

Para solo backend: `--component=backend`. Solo app: `--component=app`. Todo: `--component=all`.

Más opciones: `--update`, `--rollback`, `--uninstall`, `--list-versions`, `--version=v0.45.0`, `--auto`, `--dry-run`.

### Opción B — Manual

| Componente | Pasos |
|---|---|
| **Backend** | `cd backend && npm install && npm run build && npm start` |
| **App Android** | Descarga APK desde [Releases](https://github.com/rgdi/m-nexus/releases/latest) |

---

## 📂 Documentación por componente

Cada componente tiene su README detallado:

- **[Backend](backend/README.md)** — Fastify 5, 222 tests
- **[App](app/README.md)** — Flutter standalone, Material 3, AdaptiveScaffold

Otros docs:
- [RELEASE_NOTES.md](RELEASE_NOTES.md) — notas de cada release
- [docs/ERROR_CODES.md](docs/ERROR_CODES.md) — 200 códigos EC-XXX-NNN
- [docs/LOGGING.md](docs/LOGGING.md) — sistema de logging estructurado
- [docs/API.md](docs/API.md) — referencia completa de los endpoints
- [docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md) — auto-update
- [docs/BACKUP_*.md](docs/) — backup y restore
- [docs/STANDALONE_VISION.md](docs/STANDALONE_VISION.md) — visión del proyecto

---

## 🧪 Tests

```bash
# Backend
cd backend && npm test              # 222 tests passing

# App
cd app && flutter test              # 4 test files
```

**Total: 226+ tests passing**

Cubriendo:
- Backend: secretManager, conflictResolver, structuredNotes, upload, rollback, fsrsQueue, auth, api, llm, ocr, whisper, embeddings, push, metrics, y muchos más
- App: safe_call, settings_service, vault_service, flashcard_service

---

## 📊 Stack técnico

| Componente | Stack |
|---|---|
| **Backend** | Node.js 22+, Fastify 5, TypeScript 5.3, better-sqlite3, AES-256-GCM |
| **App (Android + Web)** | Flutter 3.24, Dart 3.5, Material 3, AdaptiveScaffold, Android 14+, AGP 8.3 |
| **Install** | Bash, systemd, OpenSSL, rsync |
| **CI/CD** | GitHub Actions (release + CI workflows) |

---

## 🆔 Sistema de error codes (v0.45)

M-NEXUS usa un **sistema unificado de códigos de error** `EC-{CATEGORÍA}-{NNN}` en frontend y backend, con logging estructurado, redacción automática de secretos, y correlación via `requestId`.

**Categorías compartidas**: `NET`, `FS`, `DB`, `AUTH`, `CFG`, `LIFECYCLE`, `INTERNAL`

**Solo frontend**: `CAL`, `PLAT`, `VAULT`, `CARD`, `NOTE`, `UP`, `UI`

**Solo backend**: `VAL`, `EXT`, `LLM`, `OCR`, `AUD`, `EMB`, `SEC`, `BK`, `CONFL`, `PUSH`, `QUIZ`, `STR`, `REL`, `WS`, `RATE`, `EVAL`

**Ejemplo frontend (Dart):**

```dart
throw AppError.vault(
  code: 'EC-VAULT-003',
  message: 'No se pudo leer la nota',
  context: { 'path': notePath, 'size': fileSize },
  hint: 'Verifica permisos en Settings',
);
```

**Ejemplo backend (TypeScript):**

```typescript
throw E.llm('EC-LLM-005', 'Ollama API error', {
  cause: originalError,
  context: { status: 500, model: 'llama3' },
  hint: 'Check Ollama is running and model is available',
});
```

El backend mapea automáticamente cada categoría a un HTTP status code (`AUTH`→401, `VAL`→400, `RATE`→429, `DB`/`SEC`→403, `NET`/`EXT`/`LLM`/`OCR`/`AUD`/`EMB`→502, resto→500).

📚 Ver [`docs/ERROR_CODES.md`](docs/ERROR_CODES.md) para la lista completa de ~100 códigos.

📚 Ver [`docs/LOGGING.md`](docs/LOGGING.md) para cómo ver logs (adb logcat, journalctl, pino-pretty, Loki).

---

## 🏗️ Estructura del repo

```
m-nexus/
├── backend/                  # Backend Node.js (Fastify 5) + error codes
├── app/                      # App standalone Flutter (sin Obsidian)
├── install/                  # Scripts de instalación (install.sh)
├── docs/                     # Documentación extendida
│   ├── ERROR_CODES.md        # 🆕 v0.45: ~100 códigos EC-XXX-NNN
│   ├── LOGGING.md            # 🆕 v0.45: guía de logging estructurado
│   ├── API.md                # 73+ endpoints documentados
│   ├── AUTO_UPDATE.md
│   ├── BACKUP_*.md           # Backup admin, docker, install, etc
├── scripts/                  # Scripts utilitarios (bump-version, push-to-github)
├── .github/
│   └── workflows/            # release.yml, ci.yml, update-version.yml
├── README.md                 # Este archivo
├── RELEASE_NOTES.md         # Notas de cada release
├── LICENSE                   # MIT
└── .github/workflows/        # release.yml, ci.yml, debug-apk.yml
```

---

## 📦 Releases

| Versión | Fecha | Highlights |
|---|---|---|
| **v0.35.0** | 2026-09-05 | Setup wizard 8 pasos, battery opt, sync queue offline-first, calendar selector robusto, anti-SnackBar-spam |
| v0.34.0 | 2026-09-04 | Long-press test mode, sync badges, rename recordings, SAF picker, in-app updates |
| v0.33.0 | 2026-09-04 | Notion-style, Secret Manager, Conflict Resolution, Chunked Upload, Rollback, Web Clipper, FSRS async |
| v0.32.0 | 2026-09-04 | Voice notes (speech_to_text 7.x), help page, foreground recording service |
| v0.31.0 | 2026-09-03 | Device identity, setup wizard, Google Calendar |
| v0.30.0 | 2026-09-03 | Auto-update (3 componentes), QR install |
| v0.29.7 | 2026-09-03 | Primer APK firmado |
| v0.28.0 | 2026-09-02 | Plugin v0.28 base + FSRS v5 |

Todas las releases: https://github.com/rgdi/m-nexus/releases

---

## 🤝 Contributing

1. Fork
2. Branch (`git checkout -b feature/loquesea`)
3. Commit (`git commit -m 'feat: añade X'`)
4. Push
5. PR

Convenciones:
- Conventional commits (`feat:`, `fix:`, `chore:`, etc)
- Tests con `fault-injection` (deben fallar bajo condiciones controladas)
- Sin secrets en el repo
- Sin código muerto
- Documentación actualizada

---

## 🔐 Security

- API keys cifradas con AES-256-GCM (Secret Manager)
- JWT para auth del backend
- Rate limiting (10 req/s)
- CORS configurable
- Audit log
- HTTPS recomendado en producción

Para reportar vulnerabilidades: abrir un [issue privado](https://github.com/rgdi/m-nexus/issues/new).

---

## 📄 License

MIT

---

## 🆘 Soporte

- **Docs:** ver [RELEASE_NOTES.md](RELEASE_NOTES.md), [docs/ERROR_CODES.md](docs/ERROR_CODES.md), y los READMEs por componente
- **Issues:** https://github.com/rgdi/m-nexus/issues
- **Releases:** https://github.com/rgdi/m-nexus/releases
- **Repo:** https://github.com/rgdi/m-nexus
# Force cache invalidation
