# M-NEXUS — Sistema de estudio médico con control humano

[![Release](https://img.shields.io/github/v/release/rgdi/m-nexus)](https://github.com/rgdi/m-nexus/releases/latest)
[![License](https://img.shields.io/github/license/rgdi/m-nexus)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-300%2B%20passing-brightgreen)]()
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

### v0.43.0 — App standalone
- **📦 UNIFIED ARCHITECTURE** — Sin Obsidian, sin plugin: la app es todo
- **🎨 Material 3 + AdaptiveScaffold** — Bottom nav mobile / rail desktop
- **⌨️ Atajos estilo Obsidian** — `Ctrl+1/2/3/4` (nav), `Ctrl+N/S/E/B/I` (formato), `Ctrl+R` (repasar), `Ctrl+/` (buscar)
- **📱 Flutter Web** — PWA con splash + manifest
- **🧙 Setup wizard simplificado** — 6 pasos: Bienvenida → Permisos → Batería → Backend → Vault → Listo
- **🔋 Battery optimization** — desactivación guiada desde el wizard (Android 6+)
- **📅 Calendar selector robusto** — diálogo con StatefulBuilder, color avatar, auto-permiso
- **🔄 Sync queue offline-first** — cada recording tiene badge de estado (pending/uploading/synced/failed)
- **🎙️ Recording rename + retry** — renombrar con validación, reintentar sync individual
- **📲 SAF picker** — seleccionar vault manualmente con Storage Access Framework
- **🚫 Anti-SnackBar-spam** — `_notify()` con `hideCurrentSnackBar()`, update notification dedupe

### v0.33.0 — Notion-style
- **🗂️ Notion-style databases** — Typed properties (text/number/select/multi/date/url/email/relation/formula)
- **🔐 Secret Manager** — AES-256-GCM, API keys cifradas
- **🔄 Conflict Resolution** — LWW por FIELD con vector clocks
- **📦 Chunked Upload** — 1 MB chunks, resumable, SHA-256 verify
- **⏪ Rollback** — Backup antes de update, restore con un click
- **📎 Web Clipper** — Extensión Chrome con detección de dominios médicos

### v0.32.0 — Voice notes
- **🎙️ Voice notes con speech_to_text 7.x** — foreground service, MANAGE_EXTERNAL_STORAGE
- **🆘 Help page** — Diagnóstico copiable, troubleshooting, FAQ

### v0.31.0 — Device identity
- **🔐 Device identity** — UUID v4 + ANDROID_ID persistente
- **🧙 Setup wizard** — Solo primer launch
- **📅 Google Calendar** — Vía ContentResolver (sin Google Sign-In)
- **🖼️ Logo** — M + heartbeat blue gradient

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

Para solo backend: `--component=backend`. Solo plugin: `--component=plugin`. Solo companion: `--component=companion`.

Más opciones: `--update`, `--rollback`, `--uninstall`, `--list-versions`, `--version=v0.35.0`, `--auto`, `--dry-run`.

### Opción B — Manual

| Componente | Pasos |
|---|---|
| **Backend** | `cd backend && npm install && npm run build && npm start` |
| **App Android** | Descarga APK desde [Releases](https://github.com/rgdi/m-nexus/releases/latest) |

---

## 📂 Documentación por componente

Cada componente tiene su README detallado:

- **[Backend](backend/README.md)** — Fastify 5, 245 tests, 73+ endpoints
- **[Companion App](companion-app/README.md)** — Flutter, 4 platform channels, 40 tests

Otros docs:
- [INSTALL.md](INSTALL.md) — guía de instalación paso a paso
- [docs/API.md](docs/API.md) — referencia completa de los 73+ endpoints
- [CHANGELOG.md](CHANGELOG.md) — historial de cambios
- [docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md) — auto-update
- [docs/BACKUP_*.md](docs/) — backup y restore

---

## 🧪 Tests

```bash
# Backend
cd backend && npm test              # 245 tests

# Plugin

# Companion
cd companion-app && flutter test    # 40 tests
```

**Total: 1484 tests passing**

Cubriendo:
- Backend: secretManager (11), conflictResolver (17), structuredNotes (24), upload (11), rollback (6), fsrsQueue (8), auth (21), api (21), y muchos más
- Plugin: 18+ subsistemas, e2e flows, FSRS, RAG, Notion-style, etc
- Companion: backend_client, chunked_upload, recorder, permissions, vault_detector, updater, etc

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
├── INSTALL.md                # Guía de instalación
├── CHANGELOG.md              # Historial
├── LICENSE                   # MIT
└── GITHUB_SETUP.md           # Setup inicial del repo
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

- **Docs:** ver [INSTALL.md](INSTALL.md), [docs/API.md](docs/API.md), y los READMEs por componente
- **Issues:** https://github.com/rgdi/m-nexus/issues
- **Releases:** https://github.com/rgdi/m-nexus/releases
- **Repo:** https://github.com/rgdi/m-nexus
# Force cache invalidation
