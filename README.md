# M-NEXUS — Sistema de estudio médico con control humano

[![Release](https://img.shields.io/github/v/release/rgdi/m-nexus)](https://github.com/rgdi/m-nexus/releases/latest)
[![License](https://img.shields.io/github/license/rgdi/m-nexus)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1460%20passing-brightgreen)]()
[![Topic](https://img.shields.io/badge/topics-15-blue)]()

> **v0.35.0** · Notion-style databases, Secret Manager, Conflict Resolution, Chunked Upload, Rollback, Web Clipper, FSRS async, Battery optimization, Setup wizard 8 pasos, Sync queue offline-first

**M-NEXUS** = plugin de Obsidian + backend Node.js + companion app Android
para estudio médico con IA en el loop (FSRS spaced repetition, voice notes,
Notion-style databases con typed properties, conflict resolution por vector
clocks, chunked upload resumable, secret manager AES-256-GCM, rollback
automático antes de updates).

Diseñado para ser **humano en el loop**: la IA propone, tú decides.

---

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Obsidian plugin │ ←→ │  Backend Node   │ ←→ │ Companion app   │
│ (v0.35)         │    │  (v0.35)        │    │ Android (v0.35) │
│ TypeScript      │    │  TypeScript     │    │ Flutter/Dart    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        ↓                      ↓                       ↓
   Vault notes            SQLite + DB             Recordings,
   + frontmatter         Secret manager          Calendar,
   + Notion DBs          FSRS async              Plugin install
```

3 componentes independientes que se comunican por HTTP/JSON.
Cualquiera puede estar offline; el plugin queuea cambios.

---

## 🎯 ¿Qué hace M-NEXUS?

### v0.35.0 — Stability + UX
- **🧙 Setup wizard 8 pasos** — Bienvenida → Permisos → Batería → Backend → Calendario → Vault → Plugin → Listo
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
| **Plugin Obsidian** | Settings → Community plugins → Browse → "M-NEXUS" → Install → Enable |
| **Backend** | `cd backend && npm install && npm run build && npm start` |
| **Companion Android** | Descarga APK desde [Releases](https://github.com/rgdi/m-nexus/releases/latest) |

---

## 📂 Documentación por componente

Cada componente tiene su README detallado:

- **[Plugin de Obsidian](obsidian-plugin/README.md)** — TypeScript, 18+ subsistemas, 1162 tests
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
cd obsidian-plugin && npm test      # 1162 tests

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
| **Plugin** | TypeScript 5.3, Obsidian API 1.5+, esbuild 0.25, vitest 2.1, jsdom 24 |
| **Backend** | Node.js 22+, Fastify 5, TypeScript 5.3, better-sqlite3, AES-256-GCM |
| **Companion** | Flutter 3.24, Dart 3.5, Android 14+, AGP 8.3, vitest-equivalent |
| **Install** | Bash, systemd, OpenSSL, rsync |
| **CI/CD** | GitHub Actions (release + CI workflows) |

---

## 🏗️ Estructura del repo

```
m-nexus/
├── obsidian-plugin/          # Plugin de Obsidian (TypeScript)
├── backend/                  # Backend Node.js (Fastify 5)
├── companion-app/            # Companion Android (Flutter)
├── install/                  # Scripts de instalación (install.sh)
├── docs/                     # Documentación extendida
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
