# M-NEXUS — Sistema de estudio médico con control humano

[![Release](https://img.shields.io/github/v/release/rgdi/m-nexus)](https://github.com/rgdi/m-nexus/releases/latest)
[![License](https://img.shields.io/github/license/rgdi/m-nexus)](LICENSE)
[![Backend tests](https://img.shields.io/badge/backend-533%20tests%20passing-brightgreen)]()
[![App tests](https://img.shields.io/badge/app-56%20tests%20documented-blue)]()
[![FSRS](https://img.shields.io/badge/FSRS-5.4.2-orange)]()
[![Topic](https://img.shields.io/badge/topics-15-blue)]()

> **v0.46.0** · App standalone (sin Obsidian), Material 3, AdaptiveScaffold, atajos estilo Obsidian, **FSRS-5/6 real** (ts-fsrs 5.4.2 + port a Dart), voice notes con Whisper real, multi-dispositivo (Android + Web), sync Yjs CRDT con E2E encryption, marketplace de decks, AI tutor (RAG)

**M-NEXUS** = backend Node.js opcional + app standalone Flutter
para estudio médico. App 100% independiente y offline-first: vault local en Android (SAF), markdown viewer, flashcards con **FSRS-5/6 real** (21 params, mismo algoritmo que Anki), voice notes, calendar, dashboard, heatmap, stats, search FTS5, wikilinks, cloze, image occlusion, type-answer, AI tutor, marketplace.

Diseñado para ser **humano en el loop**: la IA propone, tú decides.

---

## 🏗️ Arquitectura

```
┌─────────────────┐         ┌──────────────────────────┐
│  Backend Node   │  ←───→  │  M-NEXUS App (standalone)│
│  (v0.46)        │  HTTP   │  (v0.46)                 │
│  TypeScript     │  /JSON  │  Android + Web           │
│  Fastify 5      │  WS     │  Flutter 3.24            │
│                 │  Yjs    │                          │
└─────────────────┘         └──────────────────────────┘
        ↓                              ↓
   FSRS-5/6,                    Drift (SQLite) con FTS5,
   FTS5,                        FSRS engine Dart,
   Whisper,                     4-button review UI,
   Yjs CRDT,                    cloze, image occlusion,
   RAG tutor,                   heatmap, stats, AI chat,
   marketplace,                 marketplace, voice input
   importers,
   plugin API
```

2 componentes: backend opcional + app standalone. La app funciona
100% offline-first y se sincroniza con el backend cuando está disponible.

---

## 🎯 ¿Qué hace M-NEXUS?

### v0.46.0 — Major audit-driven release (40 commits)

Esta versión es el resultado de un **audit exhaustivo Expectativa vs Realidad** sobre el repo. Se implementaron 16 servicios backend nuevos + 13 archivos app-side nuevos + 6 auditor bugs cerrados.

#### ✅ Backend (16 servicios nuevos, 6,591 LOC, 533 tests)

- **🧠 FSRS-5/6 real** — `ts-fsrs@5.4.2` con 21 parámetros, 4 ratings, DSR model, forgetting curve, retrievability, scheduling. Misma fórmula matemática en backend (TS) y app (Dart).
- **🤖 AI proposals v2** — Generación LLM-powered de flashcards con heuristic regex fallback (caching, batching, rate limiting)
- **🎙️ Whisper real** — Streaming transcription con `whisper-node`, reemplaza placeholder
- **🔍 Search FTS5 con BM25** — Full-text search estilo SQLite, O(log n) en 10K+ notas, stemming porter unicode61
- **🔗 Wikilinks** — Parser `[[Note]]`, `[[Note|display]]`, `[[Note#section]]`, `[[Note#^block]]`, `![[Note]]` (embed), backlinks indexados
- **🕸️ Graph view** — Force-directed layout (Fruchterman-Reingold), 3D opcional, export JSON
- **📝 Daily notes + Templates** — 7 templates médicos (SOAP, H&P, Differential, Pharmacology, Anatomy, Pathophysiology, Procedure)
- **🏷️ Tags** — `#tag` extraction con regex, autocomplete, hierarchy, count
- **📝 Cloze deletion** — `{{c1::texto::hint}}` estilo Anki, multi-cloze, generate cards
- **🖼️ Image occlusion** — Máscaras sobre imágenes (rectangle/ellipse), reveal por región
- **⌨️ Type-answer** — Levenshtein distance, fuzzy match, case-insensitive
- **📊 Heatmap + Stats** — GitHub-style heatmap 365 días, streak tracking, retention rate, distribution
- **🔄 Sync CRDT + E2E** — Yjs (CRDT) con AES-256-GCM encryption, conflict resolution, chunked sync
- **💬 AI Tutor (RAG)** — Preguntas sobre tu vault, sources citadas, context-aware
- **🛒 Marketplace** — Decks compartidos, rating, downloads, categories
- **🎮 Gamification** — XP, levels, badges, streaks, achievements
- **🌐 Web Clipper** — Bookmarklet + extensión browser, save articles como markdown
- **📥 Importers** — PDF, Anki (.apkg), Notion (.zip), Roam (.json) → markdown + flashcards
- **🔌 Plugin API** — JS sandbox con permisos granulares, lifecycle hooks, marketplace de plugins
- **🌍 i18n** — 3 idiomas (en/es/pt) con ICU plurales, message catalog centralizado

#### ✅ App-side (13 archivos nuevos, 4,465 LOC, 56 tests documentados)

- **FSRS engine Dart** — Port 1:1 del backend, 21 params, JSON roundtrip compatible
- **Drift schema** — 7 tablas (Notes/Cards/Reviews/Tags/NoteTags/Sessions/Settings) + 2 FTS5 virtual + 6 triggers
- **Frontmatter migration** — YAML frontmatter → DB columns en primer arranque
- **4-button review UI** — Again/Hard/Good/Easy con semantic colors (Anki-style), FSRS info bar, haptic feedback, long-press details
- **i18n ARB files** — 3 ARB files (en/es/pt) con 97 keys idénticas, ICU plurals, `gen-l10n` config
- **VoiceInputButton** — Dual mode (local STT + remote Whisper), pulse animation, permission flow, locale mapping
- **Search screen** — Command palette estilo Cmd+K, FTS5 con highlighting, grouped results (notes/cards/tags), keyboard navigation
- **Backlinks panel** — Widget integrable, matching NFD-normalized, modified-desc sort
- **Wikilink parser** — Dart port del backend
- **Cloze editor** — Tab Edit/Preview, badge counter, insert template, live render
- **Heatmap widget** — Custom CustomPaint con 5 niveles de intensidad, scroll horizontal, tooltip
- **Stats screen** — Streak row + heatmap + retention + pie (distribution) + bar (last 30 days) via fl_chart
- **AI chat screen** — Bubbles user/AI, markdown rendering, sources panel, thinking state
- **Marketplace screen** — Search + filters + sort + install with progress dialog

#### 🐛 Auditor bugs cerrados (6)

| # | Bug | Severidad | Tipo |
|---|---|---|---|
| #1 | CORS `origin: true` con credentials = CSRF | 🔴 alta | security |
| #2 | WebSocket sin rate limit = DoS | 🔴 alta | security |
| #3 | Audit log mutable (WORM violado) | 🟠 media | security |
| #4 | APK pipeline roto (cache + daemon) | 🔴 crítica | ci |
| #5 | Updater cache pierde release info | 🟠 media | fix |
| #6 | home_screen carga vault entero (30s) | 🟠 media | perf |

#### 📋 v0.45.0 — Sistema de error codes unificado
- **🆔 Error codes `EC-XXX-NNN`** — 200 códigos en 28 categorías, frontend + backend sincronizados
- **🛡️ `safeCall` / `safeCallAsync`** — Helpers que centralizan try-catch con logging automático
- **📊 Logger estructurado** — `logOp`, `logError`, `logLifecycle`, `logNetwork`, `logPlatform` con redacción de secretos
- **🌐 Central error handler** — `setErrorHandler` con respuestas JSON + `requestId` para correlación
- **🔒 Redacción automática** — `*.password`, `*.token`, `*.secret`, `*.apiKey` no se loguean
- **🔄 HTTP status code auto-mapeado** — `AUTH`→401, `VAL`→400, `RATE`→429, `DB`/`SEC`→403, `NET`/`EXT`→502

### v0.44.2 — Real Settings
- **🎨 Tema dinámico** — system/light/dark, persistido en SharedPreferences
- **📏 Font scale** — 85%/100%/115%/130% vía `MediaQuery.textScaler`
- **🔌 Backend URL** — configurable, vacío = sin backend
- **📂 Vaults dialog** — lista de vaults detectados con método de detección
- **📅 Calendar picker** — permisos + lista de calendarios

### v0.43.0 — App standalone
- **📦 UNIFIED ARCHITECTURE** — Sin Obsidian, sin plugin: la app es todo
- **🎨 Material 3 + AdaptiveScaffold** — Bottom nav mobile / rail desktop
- **⌨️ Atajos estilo Obsidian** — `Ctrl+1/2/3/4` (nav), `Ctrl+N/S/E/B/I` (formato), `Ctrl+R` (repasar), `Ctrl+/` (buscar)
- **📱 Flutter Web** — PWA con splash + manifest
- **🧙 Setup wizard simplificado** — 6 pasos: Bienvenida → Permisos → Batería → Backend → Vault → Listo

---

## 🚀 Quick start (60 segundos)

### Opción A — Instalador automático (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --component=all --tag=stable
```

Para solo backend: `--component=backend`. Solo app: `--component=app`. Todo: `--component=all`.

Más opciones: `--update`, `--rollback`, `--uninstall`, `--list-versions`, `--version=v0.46.0`, `--auto`, `--dry-run`.

### Opción B — Manual

| Componente | Pasos |
|---|---|
| **Backend** | `cd backend && npm install && npm run build && npm start` |
| **App Android** | Descarga APK desde [Releases](https://github.com/rgdi/m-nexus/releases/latest) |

### Verificación de instalación

```bash
# Backend health check
curl http://localhost:8787/health
# → {"status":"ok","version":"v0.46.0"}

# Backend tests
cd backend && npx vitest run
# → 533/533 passing (1 skipped pre-existente)
```

---

## 📂 Documentación por componente

Cada componente tiene su README detallado:

- **[Backend](backend/README.md)** — Fastify 5, 533 tests, 16 servicios nuevos
- **[App](app/README.md)** — Flutter standalone, Material 3, FSRS Dart, 13 pantallas nuevas

Otros docs:
- [RELEASE_NOTES.md](RELEASE_NOTES.md) — notas de cada release
- [CHECKLIST.md](CHECKLIST.md) — 135/150 items, audit-driven
- [CHANGELOG.md](CHANGELOG.md) — changelog completo
- [ROADMAP.md](ROADMAP.md) — roadmap Q4 2026 - Q2 2027
- [docs/ERROR_CODES.md](docs/ERROR_CODES.md) — 200 códigos EC-XXX-NNN
- [docs/LOGGING.md](docs/LOGGING.md) — sistema de logging estructurado
- [docs/API.md](docs/API.md) — referencia completa de los endpoints
- [docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md) — auto-update
- [docs/BACKUP_*.md](docs/) — backup y restore
- [docs/STANDALONE_VISION.md](docs/STANDALONE_VISION.md) — visión del proyecto
- [docs/BACKEND_ONLY_FEATURES.md](docs/BACKEND_ONLY_FEATURES.md) — features que requieren backend

---

## 🧪 Tests

```bash
# Backend
cd backend && npx vitest run --exclude '**/integration.test.ts'
# → 533/533 passing (1 skipped pre-existente)

# Backend typecheck
cd backend && npx tsc --noEmit
# → 0 errors

# App (requiere Flutter SDK)
cd app && flutter test
# → 56 tests documentados (v0.46.0)
```

**Total: 533 backend + 56 app-side = 589 tests**

Cubriendo:
- **Backend**: FSRS, AI proposals, Whisper, Search FTS5, Wikilinks, Graph, Templates, Tags, Cloze, Image Occlusion, Type-Answer, Heatmap, Sync, AI Tutor, Marketplace, Gamification, Web Clipper, Importers, Plugin API, i18n + corsPolicy, wsRateLimit, wormAudit + cross-cutting integration
- **App**: FSRS engine parity, frontmatter migration, updater cache, vault recent notes, i18n ARB, voice input

---

## 📊 Stack técnico

| Componente | Stack |
|---|---|
| **Backend** | Node.js 22+, Fastify 5, TypeScript 5.3, better-sqlite3 (FTS5), Yjs, AES-256-GCM, whisper-node, ts-fsrs 5.4.2 |
| **App (Android + Web)** | Flutter 3.24, Dart 3.5, Drift (SQLite), fl_chart, speech_to_text, Material 3, AdaptiveScaffold, Android 14+, AGP 8.3 |
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
├── backend/                  # Backend Node.js (Fastify 5) + 16 servicios nuevos (v0.46)
├── app/                      # App standalone Flutter + 13 archivos nuevos (v0.46)
├── install/                  # Scripts de instalación (install.sh)
├── docs/                     # Documentación extendida
│   ├── ERROR_CODES.md        # 200 códigos EC-XXX-NNN
│   ├── LOGGING.md            # guía de logging estructurado
│   ├── API.md                # 100+ endpoints documentados
│   ├── AUTO_UPDATE.md
│   ├── BACKUP_*.md           # Backup admin, docker, install, etc
│   ├── BACKEND_ONLY_FEATURES.md  # features que requieren backend
├── scripts/                  # Scripts utilitarios (bump-version, push-to-github)
├── .github/
│   └── workflows/            # release.yml (reparado v0.46), ci.yml, update-version.yml
├── README.md                 # Este archivo
├── CHECKLIST.md              # 135/150 items, audit-driven
├── CHANGELOG.md              # Changelog completo
├── ROADMAP.md                # Roadmap Q4 2026 - Q2 2027
├── RELEASE_NOTES.md          # Notas de cada release
├── LICENSE                   # MIT
```

---

## 📦 Releases

| Versión | Fecha | Highlights |
|---|---|---|
| **v0.46.0** | 2026-09-08 | 🆕 Audit-driven: 16 backend services + 13 app-side files + 6 auditor bugs cerrados. FSRS-5/6 real, FTS5 search, wikilinks, cloze, image occlusion, type-answer, heatmap, sync Yjs+E2E, AI tutor, marketplace, importers, plugin API. 533 tests. |
| v0.45.0 | 2026-09-07 | Sistema de error codes unificado (200 códigos), safeCall, logger estructurado, redacción de secretos, requestId correlation |
| v0.44.2 | 2026-09-07 | Real Settings (tema dinámico, font scale, vaults dialog) |
| v0.43.0 | 2026-09-06 | App standalone, Material 3 + AdaptiveScaffold, setup wizard 6 pasos |
| v0.35.0 | 2026-09-05 | Setup wizard 8 pasos, battery opt, sync queue offline-first, calendar selector robusto, anti-SnackBar-spam |
| v0.34.0 | 2026-09-04 | Long-press test mode, sync badges, rename recordings, SAF picker, in-app updates |
| v0.33.0 | 2026-09-04 | Notion-style, Secret Manager, Conflict Resolution, Chunked Upload, Rollback, Web Clipper, FSRS async |
| v0.32.0 | 2026-09-04 | Voice notes (speech_to_text 7.x), help page, foreground recording service |
| v0.31.0 | 2026-09-03 | Device identity, setup wizard, Google Calendar |
| v0.30.0 | 2026-09-03 | Auto-update (3 componentes), QR install |
| v0.29.7 | 2026-09-03 | Primer APK firmado |
| v0.28.0 | 2026-09-02 | (no publicado — el "plugin de Obsidian" mencionado históricamente no se implementó; la app es standalone desde v0.43) |

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
- **No marcar features como "implementadas" si no funcionan end-to-end** (regla de Fase 0 del CHECKLIST)

---

## 🔐 Security

- API keys cifradas con AES-256-GCM (Secret Manager)
- JWT para auth del backend
- Rate limiting (10 req/s en HTTP, 100 msgs/10MB por 1 min en WS)
- CORS whitelist configurable (rechaza `*` cuando credentials=true — CSRF safe)
- Audit log WORM (append-only con SHA-256 hash chain, verifyChain detecta tampering)
- HTTPS recomendado en producción
- i18n: 3 idiomas

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
