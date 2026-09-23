# M-NEXUS — Features Index

> **v2.32.1** — Educational OS for any career · self-hosted · multi-device · accessible.
>
> Stack: TypeScript (Fastify) backend + Vanilla JS+CSS frontend. **Zero frameworks.**
>
> 100 files en el bundle, **1645 tests automatizados** (1147 backend + 498 frontend).

---

## Tabla de contenidos

1. [Dock principal (9 items)](#dock-principal-9-items)
2. [Drawer — sección Advanced](#drawer--sección-advanced)
3. [Lista completa de features](#lista-completa-de-features)
4. [Endpoints API por feature](#endpoints-api-por-feature)
5. [Mapa widget → screen](#mapa-widget--screen)

---

## Dock principal (9 items)

| # | Icono | Item | Hash | Descripción | Backend |
|---|-------|------|------|-------------|---------|
| 1 | ⊞ | Overview | `#/overview` | Dashboard con agenda, asignaturas, FSRS preview, AI insights | `/dashboard`, `/fsrs/queue` |
| 2 | ▦ | Calendar | `#/calendar` | Vista día/semana/mes con eventos y notas vinculadas | `/events` |
| 3 | ◍ | Subjects | `#/subjects` | Asignaturas con grades, templates custom | `/subjects` |
| 4 | ✎ | Notes | `#/notes` | Editor con atomic blocks, wikilinks `[[]]`, OCR inline | `/notes`, `/blocks`, `/ocr/recognize-highlight` |
| 5 | ✓ | To-dos | `#/todos` | Tareas con deadlines y prioridad | `/tasks` |
| 6 | ✦ | AI | `#/ai` | AI Tutor con multiple providers (Ollama, OpenRouter, OpenAI) | `/ai`, `/llm` |
| 7 | 📓 | Journal | `#/journal` | Daily journal con templates, mood, streak, heatmap | `/journal` |
| 8 | 💡 | Insights | `#/v232` | 3 tabs: 🕸️ Graph · 📚 Multi-board · 📈 FSRS Dashboard | `/kg`, `/boards`, `/fsrs/{predict,optimal-window,risk-heatmap}` |
| 9 | ⚙ | Settings | `#/settings` | Tema, idioma, vault switcher, backup, advanced | todos |

---

## Drawer — sección Advanced

Accesible via hamburger FAB (bottom-left). Contiene items menos usados:

| Icono | Item | Hash | Descripción |
|-------|------|------|-------------|
| 📄 | PDF | `#/pdf` | Visor con anotaciones, image occlusion, sync CRDT |
| 🕸️ | Graph | `#/kg` | Knowledge Graph standalone (canvas force-directed) |
| 🛰️ | Cluster | `#/cluster` | P2P multi-server cluster admin |

---

## Lista completa de features

### v2.32.0 — OCR / Handwriting + Multi-board + Smart Notifications

#### OCR + Handwriting Recognition
- **Pipeline**: Tesseract (system binary) → Vision LLM fallback (Ollama llava).
- **Endpoints**: `POST /api/v1/ocr/recognize`, `/recognize-pdf-page`, `/recognize-highlight`.
- **Widget**: `widgets/ocr_recognize.js` — drag/drop, language selector (spa+eng/spa/eng/lat), confidence slider, handwritten region detector, "Save as atomic card".
- **Cache**: SHA-1(image bytes) → evita re-OCR.

#### Multi-Board Spaced Repetition
- **Endpoints**: `/api/v1/boards` CRUD, `/boards/:id/calibrate`, `/boards/diagnostic`.
- **Widget**: `widgets/multi_board.js` — sidebar con deck list, detail panel, cross-deck diagnostic table.
- **Diagnostic**: overlap detection, divergent FSRS state across boards, consolidation recommendations.

#### Smart Retention-Predictive Notifications
- **Endpoints**: `/api/v1/notifications-smart/generate`, `/:id/{read,dismiss}`.
- **Widget**: `widgets/smart_notifications.js` — global bell (mounted via `notifications_bell.js`), polled 60s.
- **Severity tiers**: critical (review-now), warning (today), info (soon), success (≥70% safe).
- **Dedup**: by cardIds per generation.

### v2.31.0 — Knowledge Graph

- **Extractor**: `services/kgExtractor.ts` — TF + n-grams (1..3) + diacritic stripping.
- **Communities**: greedy label propagation.
- **Weight**: PageRank-lite `freq × (1 + log(communityDensity))`.
- **Endpoints**: `/api/v1/kg/graph`, `/neighbours/:id?hops=`, `/communities`, `/search?q=`, `/rebuild`.
- **Widget**: `widgets/kg_graph.js` — canvas force-directed, drag, zoom, hover tooltip, ego-network panel.

### v2.30.0 — FSRS-7 + Predictive Scheduler

- **Algorithm**: 19-param FSRS vector (FSRS-6 17 + w[17] curve stretch + w[18] post-lapse boost).
- **Canonical formula**: `t = (R^(1/d) - 1) / f * S` with `d = -w[15]`, `f = exp(ln(0.9)/d) - 1`.
- **Endpoints**: `/api/v1/fsrs/{predict,optimal-window,risk-heatmap,calibrate,calibration/:key}`.
- **Widget**: `widgets/fsrs_dashboard.js` — retention dial, 3 stat cards, 30-day heatmap, top-K list.

### v2.29.0 — PDF Image Occlusion v2 + Cross-device CRDT sync

- **Occlusion**: drag-to-create masks en PDF pages, ARIA-labelled boxes.
- **CRDT sync**: Yjs Doc per documentPath, 3 maps (highlights/occlusions/meta) + Lamport clock.
- **Persistence**: `vault/.m-nexus-crdt/pdf-<hash>.bin`.
- **Endpoints**: `/api/v1/sync/pdf/{state,update,log,devices,stats}`, `/api/v1/pdf/occlusion/*`.
- **Widgets**: `pdf_occlusion.js`, `pdf_sync_indicator.js`.

### v2.28.0 — PDF Annotation pipeline

- **Endpoints**: `/api/v1/pdf/*` (highlights → atomic flashcard → FSRS).
- **Widget**: `pdf_viewer.js` — floating "Crear flashcard" on selection, side panel, batch convert.

### v2.27.0 — Anki .apkg + Multiple Choice

- **Import**: parse .apkg (sqlite + zip) → atomic cards.
- **Export**: round-trip .apkg.
- **Card type**: Multiple Choice.

### v2.26.0 — Daily Journal Notion-grade

- **Templates**, mood tracker, live embeds, streak, heatmap.
- **Endpoint**: `/api/v1/journal`.
- **Rollover**: `journalDayKey()` with ROLLOVER_HOUR=4.

### v2.25.0 — Atomic Block Outliner

- **Block UUIDs**, `[[]]` y `((uuid))` block refs, backlinks index.
- **Endpoints**: `/api/v1/blocks`, `/api/v1/notes/query`.

### v2.24.0 — Dynamic Customizable Subjects

- **Templates**: engineering, law, business, nursing, veterinary, custom.
- **Endpoint**: `/api/v1/flashcards/atomic-extract`.

### v2.23.x — Foundation

- v2.23.0: Cross-device CRDT sync
- v2.23.1: Audio transcription (Whisper)
- v2.23.2: OCR (Tesseract fallback)
- v2.23.3: Single-command installer + auto-upgrade
- v2.23.4: Multi-server cluster auto-discovery

---

## Endpoints API por feature

| Feature | Endpoints |
|---------|-----------|
| Auth | `/api/v1/auth/*`, `/api/v1/devices/*` |
| Subjects | `/api/v1/subjects` |
| Notes | `/api/v1/notes`, `/api/v1/blocks`, `/api/v1/notes/query` |
| Tasks | `/api/v1/tasks` |
| Events | `/api/v1/events` |
| Flashcards | `/api/v1/flashcards`, `/api/v1/flashcards/atomic-extract`, `/api/v1/flashcards/generate` |
| Audio | `/api/v1/audio/transcribe`, `/api/v1/audio/*` |
| OCR | `/api/v1/ocr`, `/api/v1/ocr/{recognize,recognize-pdf-page,recognize-highlight,stats}` |
| HTR | `/api/v1/htr` |
| PDF | `/api/v1/pdf`, `/api/v1/pdf/occlusion/*`, `/api/v1/sync/pdf` |
| FSRS | `/api/v1/fsrs/{eval,predict,optimal-window,risk-heatmap,calibrate,calibration/:key}`, `/api/v1/fsrs/queue` |
| KG | `/api/v1/kg/{graph,neighbours/:id,communities,search,rebuild,documents}` |
| Boards | `/api/v1/boards`, `/api/v1/boards/diagnostic` |
| Notifications | `/api/v1/notifications/ingest`, `/api/v1/notifications-smart/*` |
| Journal | `/api/v1/journal` |
| Anki | `/api/v1/anki` |
| AI | `/api/v1/ai`, `/api/v1/ai_v2`, `/api/v1/llm`, `/api/v1/llm/embed` |
| Backup | `/api/v1/backup`, `/api/v1/auto-backup` |
| Sync | `/api/v1/sync/{replay,metrics,publish,history,stats}`, `/api/v1/sync_v2` |
| Cluster | `/api/v1/cluster/{peers,leader}` |
| Upload | `/api/v1/upload/{init,chunk,complete}` |
| Update | `/api/v1/update/{check,apply}` |
| Marketplace | `/api/v1/marketplace*` |
| WebSocket | `/ws/sync` |

---

## Mapa widget → screen

| Screen | Widgets usados |
|--------|---------------|
| overview | cross_verify_panel, exam_runner, file_attachments |
| notes | ai_tutor, audio_recorder, cloze_test, file_attachments, flashcard_slash, icons, modal, pdf_export, study_session, tags_cloud |
| calendar | modal |
| journal | journal_block_renderers, modal, outliner |
| todos | modal |
| insights (v232) | kg_graph, multi_board, fsrs_dashboard |
| settings | anki_import, export |
| pdf | pdf_viewer |
| occlusion_screen | image_occlusion |

### Widgets globales (mounted una vez)

| Widget | Mount point |
|--------|-------------|
| `lang_switcher` | topbar |
| `theme_toggle` | topbar |
| `command_palette` (Cmd+K) | topbar |
| `swipe_nav` | body |
| `offline_pill` | body |
| `vault_switcher` | topbar |
| `peer_indicator` | topbar |
| `notifications_bell` (smart notifications) | topbar |
| `ai_tutor` | body |
| `top_toolbar` | topbar |

### Widgets removidos en v2.32.1

| Widget | Razón |
|--------|-------|
| `anatomy_generator` | Reemplazado por `glbModels` route + `three_d_viewer` widget. Los assets se sirven vía `/api/v1/glb/*`. |
| `boards.js` (screen) | Consolidado en Insights/Multi-board. |
