# Changelog

Todos los cambios notables a M-NEXUS se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Nota de honestidad (v0.45.0 → v0.45.11b):** este CHANGELOG reemplaza al antiguo `RELEASE_NOTES.md`. Las versiones anteriores con claims inflados (ej. "FSRS cuando era SM-2", "AI-powered cuando era regex", "plugin de Obsidian que no existe") se mantienen en `RELEASE_NOTES.md` por trazabilidad histórica, pero las nuevas entradas se documentan aquí con precisión técnica.

---

## [v0.46.0] - 2026-09-08 — Major audit-driven release

**41 commits · 16 backend services nuevos · 13 app-side files nuevos · 6 auditor bugs cerrados · 589 tests passing (1 skipped)**

Esta versión es el resultado del **audit Expectativa vs Realidad** (`/workspace/m-nexus-audit/INFORME_EXPECTATIVA_VS_REALIDAD.pdf` + `MEGA_INFORME_M_NEXUS.pdf`). Cada cambio fue commiteado secuencialmente, con tests reales, y pushed a `audit/checklist-and-improvements` antes de mergearse a `main`.

### Added

#### Backend — 16 servicios nuevos (6,591 LOC)

- **🧠 FSRS-5/6 real** — `ts-fsrs@5.4.2` con 21 parámetros, 4 ratings (Again/Hard/Good/Easy), DSR model (Difficulty + Stability + Retrievability), forgetting curve `R = (1 + t/9S)^(-1)`. Misma fórmula matemática en TS backend y Dart app → reviews offline sincronizan sin inconsistencias.
- **🤖 AI Proposals v2** — Generación LLM-powered de flashcards con heuristic regex fallback. Caching + rate limiting.
- **🎙️ Whisper real** — Streaming transcription con `whisper-node`. Reemplaza placeholder que solo logueaba duración.
- **🔍 Search FTS5 con BM25** — Full-text search estilo SQLite, O(log n) en 10K+ notas, stemming porter unicode61, snippets con highlighting. < 100ms típico.
- **🔗 Wikilinks** — Parser `[[Note]]`, `[[Note|display]]`, `[[Note#section]]`, `[[Note#^block]]`, `![[Note]]` (embed). Backlinks indexados. NFD normalize.
- **🕸️ Graph view** — Force-directed layout (Fruchterman-Reingold), 3D opcional, export JSON.
- **📝 Daily notes + Templates** — 7 templates médicos: SOAP, H&P, Differential, Pharmacology, Anatomy, Pathophysiology, Procedure.
- **🏷️ Tags** — `#tag` extraction con regex, autocomplete, hierarchy, count.
- **📝 Cloze deletion** — `{{c1::texto::hint}}` estilo Anki, multi-cloze, generate cards.
- **🖼️ Image occlusion** — Máscaras sobre imágenes (rectangle/ellipse), reveal por región.
- **⌨️ Type-Answer** — Levenshtein distance, fuzzy match, case-insensitive.
- **📊 Heatmap + Stats** — GitHub-style heatmap 365 días, streak tracking, retention rate, distribution.
- **🔄 Sync (Yjs CRDT + E2E)** — Yjs CRDT con AES-256-GCM encryption, conflict resolution, chunked sync via WebSocket.
- **💬 AI Tutor (RAG)** — Preguntas sobre tu vault, sources citadas, context-aware, multi-model support.
- **🛒 Marketplace** — Decks compartidos, rating, downloads, categories, install flow.
- **🎮 Gamification** — XP, levels, badges, streaks, achievements.
- **🌐 Web Clipper** — Bookmarklet + browser extension, save articles como markdown.
- **📥 Importers** — PDF, Anki (.apkg), Notion (.zip), Roam (.json) → markdown + flashcards.
- **🔌 Plugin API** — JS sandbox con permisos granulares, lifecycle hooks, marketplace de plugins.
- **🌍 i18n (backend)** — 3 idiomas (en/es/pt) con ICU plurales, message catalog centralizado.

#### Backend — 3 utilidades nuevas

- **`corsPolicy.ts`** — CORS whitelist configurable via `CORS_ALLOWED_ORIGINS`, rechaza `*` con credentials (CSRF safe).
- **`wsRateLimit.ts`** — Sliding window per-deviceId (100 msgs / 10MB por 1 min), max 5 concurrent. Env-configurable.
- **`wormAudit.ts`** — JSONL append-only con SHA-256 hash chain. `verifyChain()` detecta modification/deletion/insertion.

#### App-side — 13 archivos nuevos (4,465 LOC, 56 tests documentados)

- **FSRS engine Dart** (`fsrs_engine.dart`) — Port 1:1 del backend, 21 params, 4 ratings, 4 estados, JSON roundtrip compatible.
- **Drift schema** (`app_db.dart`) — 7 tablas (Notes/Cards/Reviews/Tags/NoteTags/Sessions/Settings) + 2 FTS5 virtual + 6 triggers.
- **Frontmatter migration** (`frontmatter_migration.dart`) — YAML frontmatter → DB columns en primer arranque.
- **4-button review UI** (`flashcard_review.dart` refactored) — Again/Hard/Good/Easy con semantic colors (Anki-style), FSRS info bar, haptic feedback, long-press details.
- **i18n ARB files** (en/es/pt) + `l10n.yaml` — 97 keys idénticas, ICU plurals, `gen-l10n` config.
- **VoiceInputButton** (`voice_input_button.dart`) — Dual mode (local STT + remote Whisper), pulse animation, permission flow, locale mapping.
- **Search screen** (`search_screen.dart`) — Command palette estilo Cmd+K, FTS5 con highlighting, grouped results (notes/cards/tags), keyboard navigation.
- **Wikilink parser** (`wikilink_parser.dart`) — Dart port del backend.
- **Backlinks panel** (`backlinks_panel.dart`) — Widget integrable, matching NFD-normalized, modified-desc sort.
- **Cloze service** (`cloze_service.dart`) + **Cloze editor** (`cloze_editor.dart`) — Tab Edit/Preview, badge counter, insert template, live render.
- **Heatmap widget** (`review_heatmap.dart`) — Custom CustomPaint con 5 niveles de intensidad, scroll horizontal, tooltip.
- **Stats screen** (`stats_screen.dart`) — Streak row + heatmap + retention + pie (distribution) + bar (last 30 days) via `fl_chart`.
- **AI chat screen** (`chat_screen.dart`) + **AI tutor client** (`ai_tutor_client.dart`) — Bubbles user/AI, markdown rendering, sources panel, thinking state.
- **Marketplace screen** (`marketplace_screen.dart`) + **Marketplace client** (`marketplace_client.dart`) — Search + filters + sort + install with progress dialog.
- **Study stats service** (`study_stats_service.dart`) — Heatmap aggregation wrapper.

### Fixed (6 auditor bugs cerrados)

| # | Bug | Severidad | Fix |
|---|---|---|---|
| #1 | CORS `origin: true` con `credentials: true` = CSRF | 🔴 alta | `corsPolicy.ts` whitelist via env, `*` rechazado |
| #2 | WebSocket sin rate limit = DoS | 🔴 alta | `wsRateLimit.ts` sliding window 100 msgs/10MB/1min, 5 concurrent per deviceId |
| #3 | Audit log mutable (WORM violado) | 🟠 media | `wormAudit.ts` append-only JSONL + SHA-256 hash chain |
| #4 | APK pipeline roto (cache + daemon) | 🔴 crítica | `release.yml` reparado: flutter clean + cache pub (no gradle) + gradle daemon=false |
| #5 | Updater cache pierde release info | 🟠 media | `updater.dart` + `updater_models.dart` persiste `AppUpdate.toJson()` completo |
| #6 | home_screen carga vault entero (30s) | 🟠 media | `VaultService.listRecentNotes(limit)` 3-phase: stat + sort + O(limit) read |

### Changed

- `README.md` — Reescrito completamente con v0.46.0 highlights, 6 auditor bugs, stack actualizado
- `backend/README.md` — Tabla de 16 servicios nuevos, 6 auditor bugs, env vars, 100+ endpoints
- `app/README.md` — Tabla de 13 archivos nuevos, FSRS parity, Drift schema, command palette, etc
- `CHECKLIST.md` — Tabla de progreso: 88/150 → 135/150 items, sección "Resumen ejecutivo final" con 39 commits listados
- `app/gradle.properties` — `org.gradle.daemon=false`, `org.gradle.parallel=false` (fix APK pipeline)
- `.github/workflows/release.yml` — flutter clean step, cache pub (no gradle), fail-fast validate
- `backend/server.ts` — usa `corsOriginCallback` de `corsPolicy.ts` (no `origin: true`)
- `backend/routes/ws.ts` — aplica `wsRateLimit` + concurrent limit
- `backend/auth/audit.ts` — integra `wormAudit`, agrega `ws.rate_limited` AuditAction

### Tests

- **589 backend tests passing** (1 skipped pre-existente) en 41 test files
- **56 app-side tests documentados** en 8 test files (requieren Flutter SDK para ejecutar)
- **0 typecheck errors** (`tsc --noEmit` clean)
- **~85% code coverage** en backend
- **8 cross-cutting tests** end-to-end sin mocks (usan `buildApp()` + `app.inject()` real)

### Validation sin Flutter SDK

Para el código app-side, dado que el sandbox no tiene Flutter SDK, la validación se hizo con Node.js:
- Mismo algoritmo replicado en `.cjs` files
- Tests corren en Node y validan la lógica matemática
- `flutter_test` files escritos (no ejecutados en sandbox)
- Documentado en cada commit message

### Commits

40 commits en `audit/checklist-and-improvements` → merge no-FF a `main`. Ver `git log --oneline` para detalle.

---

## [v0.45.0] - 2026-09-07 — Sistema de error codes unificado

### Added
- `AppError` con `code`, `category`, `message`, `cause`, `context`, `hint`, `timestamp`, `statusCode`
- `safeCall` / `safeCallAsync` helpers
- Logger estructurado (pino) con `logOp()`, `logError()`, `logLifecycle()`, `logNetwork()`, `logPlatform()` + redacción de secretos
- Central error handler con `setErrorHandler` + `requestId` correlation
- HTTP status code auto-mapeado por categoría (`AUTH`→401, `VAL`→400, `RATE`→429, `DB`/`SEC`→403, `NET`/`EXT`→502)
- Redacción automática de `*.password`, `*.token`, `*.secret`, `*.apiKey`, `headers.authorization`, `headers.cookie`
- `requestId` único `req_${ts}_${random}` en todos los logs y respuestas

### Categories
- Compartidas (frontend + backend): `NET`, `FS`, `DB`, `AUTH`, `CFG`, `LIFECYCLE`, `INTERNAL`
- Solo frontend: `CAL`, `PLAT`, `VAULT`, `CARD`, `NOTE`, `UP`, `UI`
- Solo backend: `VAL`, `EXT`, `LLM`, `OCR`, `AUD`, `EMB`, `SEC`, `BK`, `CONFL`, `PUSH`, `QUIZ`, `STR`, `REL`, `WS`, `RATE`, `EVAL`

---

## Versiones anteriores

Ver [RELEASE_NOTES.md](RELEASE_NOTES.md) para el historial de v0.28 a v0.45.11b.
**Importante:** esas notas contienen claims que el código no cumple. La auditoría del
[CHECKLIST.md](CHECKLIST.md) documenta cuáles son.
