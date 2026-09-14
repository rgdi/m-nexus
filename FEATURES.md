# M-NEXUS — Lista completa de features y funciones

**Versión actual:** v0.62.18 (commit `a55ef22`)
**Estado del repo:** https://github.com/rgdi/m-nexus
**Auditado:** 2026-09-14

> Esta lista cubre TODAS las features visibles y servicios backend del repo. Cada item tiene el archivo fuente entre paréntesis. Items marcados con **(v0.X.Y)** indican cuándo se introdujo.

---

## 📋 Índice

1. [PKM Core (Notes / Vault)](#1-pkm-core-notes--vault)
2. [Markdown / Editor avanzado](#2-markdown--editor-avanzado)
3. [Flashcards / SRS](#3-flashcards--srs)
4. [AI (Inteligencia artificial)](#4-ai-inteligencia-artificial)
5. [Sync / Multi-device](#5-sync--multi-device)
6. [Seguridad / Encryption](#6-seguridad--encryption)
7. [Marketplace / Community](#7-marketplace--community)
8. [Import / Export](#8-import--export)
9. [Búsqueda / Knowledge Graph](#9-búsqueda--knowledge-graph)
10. [Multimedia (Audio / Video / Imágenes)](#10-multimedia-audio--video--imágenes)
11. [Whiteboard / Visual thinking](#11-whiteboard--visual-thinking)
12. [Calendar / Planning](#12-calendar--planning)
13. [Productividad / Organization](#13-productividad--organization)
14. [Stats / Gamification](#14-stats--gamification)
15. [Database / Structured data](#15-database--structured-data)
16. [Plugin system](#16-plugin-system)
17. [Web app](#17-web-app)
18. [i18n / Localization](#18-i18n--localization)
19. [Theming / UI](#19-theming--ui)
20. [Backend / API](#20-backend--api)
21. [Seguridad / Middleware](#21-seguridad--middleware)
22. [Observabilidad / Métricas](#22-observabilidad--métricas)
23. [Operativa / Deploy](#23-operativa--deploy)
24. [CI / CD](#24-ci--cd)

---

## 1. PKM Core (Notes / Vault)

| Feature | Archivo(s) |
|---------|------------|
| Vault local en filesystem (markdown plano) | `app/lib/services/vault_service.dart` |
| Vault picker (Storage Access Framework) | `app/lib/services/vault_saf_picker.dart` |
| Vault detector / auto-discovery | `app/lib/services/vault_detector.dart` |
| Onboarding / setup wizard | `app/lib/screens/setup/setup_wizard.dart` |
| Tutorial interactivo primera vez | `app/lib/screens/setup/onboarding_tutorial.dart` |
| Navegación de vault (carpetas, subcarpetas) | `app/lib/screens/vault/vault_browser.dart` |
| Vault browser con grid de carpetas | `app/lib/screens/vault/vault_browser.dart` |
| Recent files tracking | `app/lib/services/vault_service.dart` (v0.49.2) |
| Crear / renombrar / mover / borrar notas | `app/lib/services/vault_service.dart` |
| Frontmatter parsing (YAML) | `app/lib/services/wikilink_parser.dart` |
| Frontmatter migration (legacy → current) | `app/test/frontmatter_migration_test.dart` |
| Multi-workspace switcher | `app/lib/screens/vault/workspace_switcher.dart` (v0.62.16) |
| Trash / papelera con restore | `app/lib/screens/vault/trash_screen.dart` (v0.62.16) |
| Smart folders (queries saved) | `app/lib/screens/vault/smart_folders_screen.dart`, `services/smart_folder.dart` (v0.62.16) |
| Note metadata service | `app/lib/services/note_metadata.dart` (v0.62.16) |
| Custom metadata properties | `app/lib/services/note_metadata.dart` (v0.62.16) |
| Templates gallery (7 medical templates) | `app/lib/services/template_service.dart`, `screens/note/template_picker_screen.dart` (v0.62.16) |
| Template engine (variables `{{date}}`, `{{prompt}}`, `{{clipboard}}`) | `app/lib/services/template_engine.dart` |
| Daily notes (auto-creadas por fecha) | `app/lib/services/daily_note_service.dart` |
| Daily notes screen con calendar | `app/lib/screens/daily/daily_notes_screen.dart` |
| Daily notes prompts (objetivo, tareas) | `app/lib/services/daily_note_service.dart` |
| Note editor (markdown + WYSIWYG mixto) | `app/lib/screens/note/note_editor.dart` |
| Note view (read mode con embeds) | `app/lib/screens/note/note_view.dart` |
| Note inline rich editor (block-level) | `app/lib/widgets/note_inline_rich.dart` (v0.62.15) |
| Note block renderer (separators, callouts, toggles) | `app/lib/widgets/note_block_renderer.dart` (v0.62.15) |
| Markdown renderer (custom, soporta GFM) | `app/lib/widgets/markdown_renderer.dart` (v0.62.15) |
| Version history de notas | `app/lib/screens/notes/version_history_screen.dart`, `services/version_history_service.dart` |
| Outline sidebar (estructura del doc) | `app/lib/widgets/outline_sidebar.dart` |
| File locking (atomicidad de escrituras) | `app/lib/services/file_lock.dart` |
| Undo/Redo manager | `app/lib/services/undo_manager.dart` |
| Wikilinks `[[nota]]` con autocomplete | `app/lib/services/wikilink_parser.dart` |
| Wikilinks resolution (NFD normalize) | `app/lib/services/wikilink_parser.dart` |
| Wikilink resolver backend | `backend/src/services/wikilinkService.ts` |
| Backlinks panel | `app/lib/widgets/backlinks_panel.dart` |
| Embed service (YouTube, Twitter, CodePen, etc) | `app/lib/services/embed_service.dart` |
| WebView embed in-app | `app/lib/screens/embeds/webview_embed.dart` |
| YouTube embed | `app/lib/screens/embeds/youtube_embed.dart` |
| Twitter/X embed | `app/lib/screens/embeds/youtube_embed.dart` |
| Code blocks con syntax highlighting | `app/lib/widgets/markdown_renderer.dart` |
| Slash menu (block editor commands) | `app/lib/widgets/slash_menu.dart` (v0.62.16) |
| Math blocks (KaTeX-style) | `app/lib/widgets/markdown_renderer.dart` |
| Callouts (`> [!note]`, `> [!warning]`) | `app/lib/widgets/note_block_renderer.dart` |
| Toggles / collapsibles | `app/lib/widgets/note_block_renderer.dart` |
| Tables con sort | `app/lib/widgets/markdown_renderer.dart` |
| Task lists interactivas `- [ ]` | `app/lib/widgets/note_block_renderer.dart` |
| Image embedding con lightbox | `app/lib/widgets/markdown_renderer.dart` |
| Attachments service (referencias a PDFs/images) | `app/lib/services/attachments_service.dart`, `screens/attachments/attachments_screen.dart` |
| Attachment references panel | `app/lib/widgets/attachment_references_panel.dart` |
| Image OCR (cámara → texto) | `app/lib/screens/camera/ocr_screen.dart` (v0.62.16) |
| Image OCR backend (deepseek-ocr) | `backend/src/services/deepseekOcr.ts`, `routes/ocr.ts` |
| OCR handwritten notes (strokes → text) | `backend/src/services/handwritingService.ts` |
| Export service (MD, HTML, PDF) | `app/lib/services/export_service.dart` |

---

## 2. Markdown / Editor avanzado

| Feature | Archivo(s) |
|---------|------------|
| Markdown parser custom (no solo `flutter_markdown`) | `app/lib/widgets/markdown_renderer.dart` |
| GFM extensions (tables, strikethrough, task lists) | `app/lib/widgets/markdown_renderer.dart` |
| Auto-format on type (smart lists, auto-close brackets) | `app/lib/screens/note/note_editor.dart` |
| Block-level editing (cada bloque es editable) | `app/lib/widgets/note_inline_rich.dart` |
| Drag & drop de bloques | `app/lib/widgets/note_inline_rich.dart` |
| Keyboard shortcuts (Cmd+B, Cmd+I, etc) | `app/lib/core/shortcuts.dart` |
| Slash menu (insertar bloques) | `app/lib/widgets/slash_menu.dart` |
| Markdown export | `app/lib/services/export_service.dart` |
| HTML export | `app/lib/services/export_service.dart` |
| PDF export | `app/lib/services/export_service.dart` |
| Wikilink preprocessor | `app/lib/services/wikilink_parser.dart` |

---

## 3. Flashcards / SRS

### Algoritmos

| Feature | Archivo(s) |
|---------|------------|
| **FSRS v5** (algoritmo moderno, no SM-2) | `app/lib/services/fsrs_engine.dart`, `backend/node_modules/ts-fsrs` |
| FSRS 21 parámetros (configurable) | `app/lib/services/fsrs_engine.dart` |
| FSRS optimizer (random search + hill-climbing) | `app/lib/services/fsrs_optimizer.dart` |
| FSRS review logging (para optimization) | `app/lib/services/fsrs_optimizer.dart` |
| 4-button review (Again/Hard/Good/Easy) | `app/lib/screens/flashcards/flashcard_review.dart` |
| FSRS info bar (mostrar próxima review) | `app/lib/screens/flashcards/flashcard_review.dart` |
| DSR model (difficulty, stability, retrievability) | `app/lib/services/fsrs_engine.dart` |
| Forgetting curve visualization | `app/lib/screens/stats/stats_screen.dart` |
| **Leech detection** (lapses >= 8, ratio > 0.25) | `app/lib/services/flashcard_service.dart` |
| Cramming mode (shuffle sin FSRS) | `app/lib/services/flashcard_service.dart` |
| Burned cards (state=4) | `app/lib/services/flashcard_service.dart` |
| Auto-evaluation (FSRS calcula dificultad) | `app/lib/services/fsrs_engine.dart` |

### Tipos de cards

| Feature | Archivo(s) |
|---------|------------|
| Basic cards (front/back) | `app/lib/services/flashcard_service.dart` |
| Cloze deletion (`{{c1::texto}}`) | `app/lib/services/cloze_service.dart`, `screens/flashcards/cloze_editor.dart` |
| Image occlusion (con oclusions normalizadas 0..1) | `app/lib/services/image_occlusion_service.dart`, `screens/flashcards/image_occlusion_editor.dart` |
| Type-answer cards (validación exacta) | `backend/src/services/typeAnswerService.ts` |
| Audio cards (TTS en review) | `app/lib/services/tts_service.dart` |
| Multi-cloze en una sola nota | `app/lib/services/cloze_service.dart` |

### Operaciones

| Feature | Archivo(s) |
|---------|------------|
| Crear / editar / borrar cards | `app/lib/services/flashcard_service.dart` |
| Flashcards list con filtros | `app/lib/screens/flashcards/flashcards_list.dart` |
| Review queue screen | `app/lib/screens/review_queue/review_queue_screen.dart` |
| Generate flashcards (auto-generate desde nota) | `app/lib/screens/review_queue/generate_flashcards_screen.dart`, `services/auto_flashcard_service.dart` |
| Inline tutor (explica respuesta durante review) | `app/lib/screens/flashcards/flashcard_review.dart` |
| Markdown rendering en cards | `app/lib/widgets/markdown_renderer.dart` |
| TTS en cards (12 idiomas) | `app/lib/services/tts_service.dart` |
| FSRS review endpoint backend | `backend/src/routes/fsrsQueue.ts` |
| Cloze search | `app/test/validations/validate_cloze_search.cjs` |

---

## 4. AI (Inteligencia artificial)

### Modelos / Providers

| Feature | Archivo(s) |
|---------|------------|
| Multi-provider LLM (OpenAI, Anthropic, Ollama, OpenRouter, DeepSeek, Mock) | `app/lib/services/multi_model_ai.dart` |
| Autodetect de provider por nombre de modelo | `app/lib/services/multi_model_ai.dart` |
| Secure API key storage (flutter_secure_storage) | `app/lib/services/multi_model_ai.dart` |
| AI settings screen (provider/model picker + test) | `app/lib/screens/settings/ai_settings_screen.dart` |
| Backend LLMService con openai/anthropic/ollama adapters | `backend/src/services/llm.ts`, `routes/llm.ts` |

### Features AI

| Feature | Archivo(s) |
|---------|------------|
| **AI Tutor** (RAG workspace) | `backend/src/services/aiTutorService.ts`, `app/lib/screens/ai/ai_chat_screen.dart` (v0.62.14) |
| AI Chat panel con RAG | `app/lib/screens/ai/ai_chat_screen.dart` (v0.62.14) |
| AI Tutor client (Dart) | `app/lib/services/ai_tutor_client.dart` |
| Local tutor (offline semantic search) | `app/lib/services/local_tutor_service.dart` |
| RAG semántico on-device (TF-IDF + RRF) | `app/lib/services/semantic_search.dart` |
| Embeddings cache | `backend/src/services/embeddingCache.ts` |
| Embeddings service | `backend/src/services/embeddings.ts` |
| RAG search endpoint | `backend/src/routes/ai_v2.ts` |
| AI Mind Map (genera grafo desde nota) | `app/lib/screens/ai/mindmap_screen.dart` (v0.62.16) |
| AI Slides (genera presentación) | `app/lib/screens/ai/slides_screen.dart` (v0.62.16) |
| AI Copilot (inline suggestions) | `app/lib/services/ai_copilot.dart` |
| AI Proposals V2 (LLM-powered con fallback regex) | `backend/src/services/proposalsV2.ts` |
| Adaptive quiz (siguiente card según performance) | `backend/src/services/adaptiveQuizEngine.ts` |
| Cross-relevance scoring | `backend/src/services/crossRelevance.ts` |
| Voice input dual mode (local STT + remote Whisper) | `app/lib/widgets/voice_input_button.dart` |

---

## 5. Sync / Multi-device

| Feature | Archivo(s) |
|---------|------------|
| **Yjs CRDT sync** (real-time collaboration) | `backend/src/services/crdtSyncService.ts`, `routes/crdt.ts` |
| WebSocket hub con broadcast binario | `backend/src/routes/crdt.ts` |
| Heartbeat ping/pong (60s timeout) | `backend/src/routes/crdt.ts` |
| Awareness protocol (presence + cursor) | `backend/src/routes/crdt.ts` |
| **Sync LWW (Last-Write-Wins)** inter-device | `backend/src/routes/sync.ts`, `app/lib/services/sync_service.dart` (v0.62.17) |
| Sync screen con Push/Pull manual | `app/lib/screens/sync/sync_screen.dart` (v0.62.17) |
| Sync worker (background cada 5 min) | `app/lib/services/sync_worker.dart` (v0.62.17) |
| Sync status indicator | `app/lib/widgets/sync_status_indicator.dart` |
| Sync dashboard (health check, conflicts) | `app/lib/screens/settings/sync_dashboard_screen.dart`, `services/sync_dashboard_service.dart` |
| Conflict resolver backend | `backend/src/services/conflictResolver.ts` |
| Conflict resolution (timestamp más reciente gana) | `backend/src/routes/sync.ts` |
| Sync E2E test (script bash) | `scripts/test_sync_e2e.sh` |
| Atomic persistencia (tmp + rename) | `backend/src/routes/sync.ts` |
| Persistence en `data/sync.json` | `backend/data/sync.json` |
| Device ID (unique per install) | `app/lib/services/device_id.dart` |
| Device info (model, OS) | `app/lib/services/device_info.dart` |
| Devices management backend | `backend/src/auth/devices.ts` |
| Push notifications (FCM) | `backend/src/services/pushNotifications.ts`, `routes/push.ts` |
| Auth devices endpoint | `backend/src/auth/devices.ts` |

---

## 6. Seguridad / Encryption

| Feature | Archivo(s) |
|---------|------------|
| **E2E encryption AES-256-GCM** | `app/lib/services/e2e_encryption.dart` |
| Master key 32 bytes random | `app/lib/services/e2e_encryption.dart` |
| Recovery phrase (12 palabras + PBKDF2 10000 iter) | `app/lib/services/e2e_encryption.dart` |
| **ECDH P-256 key exchange** | `backend/src/services/keyExchangeService.ts` |
| HKDF-SHA256 key derivation | `backend/src/services/keyExchangeService.ts` |
| Keypair fingerprint verification | `backend/src/services/keyExchangeService.ts` |
| **flutter_secure_storage** (Android Keystore + iOS Keychain) | `app/lib/services/multi_model_ai.dart` |
| API keys encrypted at rest | `app/lib/services/multi_model_ai.dart` |
| JWT auth | `backend/src/auth/jwt.ts`, `middleware/auth.ts` |
| Auth refresh tokens | `backend/src/routes/auth.ts` |
| Audit log | `backend/src/auth/audit.ts` |
| Secrets manager | `backend/src/services/secretManager.ts`, `routes/secrets.ts` |
| **Path validation** (anti path-traversal) | `backend/src/utils/pathValidation.ts` |
| **Per-user rate limit** (no solo IP) | `backend/src/middleware/perUserRateLimit.ts` |
| **CSP headers** middleware | `backend/src/middleware/cspHeaders.ts` |
| HSTS, X-Frame-Options, X-Content-Type-Options | `backend/src/middleware/cspHeaders.ts` |
| CORS policy configurable | `backend/src/utils/corsPolicy.ts` |

---

## 7. Marketplace / Community

| Feature | Archivo(s) |
|---------|------------|
| Marketplace screen (lista de decks) | `app/lib/screens/marketplace/marketplace_screen.dart` |
| Deck detail screen | `app/lib/screens/marketplace/deck_detail_screen.dart` |
| **Marketplace SQLite** (persistencia real) | `backend/src/services/marketplaceSqliteService.ts` |
| Marketplace routes (decks, reviews, installs) | `backend/src/routes/marketplaceSqlite.ts` |
| Marketplace legacy (in-memory) | `backend/src/services/marketplaceRealService.ts` |
| Deck reviews + ratings | `backend/src/services/marketplaceSqliteService.ts` |
| Install batch (instalar N decks a la vez) | `backend/src/routes/marketplaceSqlite.ts` |
| Marketplace stats (top categories, avg rating) | `backend/src/services/marketplaceSqliteService.ts` |
| 3 official decks seeded (anatomía, farmacología, histología) | `backend/src/services/marketplaceSqliteService.ts` |
| **APKG import** (Anki deck format) | `backend/src/services/importService.ts`, `routes/import.ts` |
| **APKG download** (v0.60 stub, mejor en v0.61) | `backend/src/routes/marketplaceSqlite.ts` |
| Authors registry (verified badges) | `backend/src/services/marketplaceSqliteService.ts` |
| Multi-language marketplace (es, en) | `backend/src/services/marketplaceSqliteService.ts` |
| Search NFD (anatomía matches anatomia) | `backend/src/services/marketplaceSqliteService.ts` |
| Categories (anatomy, pharmacology, pathology, etc) | `backend/src/services/marketplaceSqliteService.ts` |

---

## 8. Import / Export

| Feature | Archivo(s) |
|---------|------------|
| **Import desde Anki (.apkg)** | `backend/src/services/importService.ts`, `routes/import.ts` |
| Import desde PDF | `backend/src/services/importService.ts` |
| Import desde Notion (JSON) | `backend/src/services/importService.ts` |
| Import desde Roam (JSON) | `backend/src/services/importService.ts` |
| Import desde Obsidian (markdown + frontmatter) | `backend/src/services/importService.ts` |
| Import desde CSV | `backend/src/services/importService.ts` |
| **Web Clipper** (HTML → MD) | `backend/src/routes/clip.ts`, `services/webClipperService.ts` |
| Web Clipper desde URL (server-side fetch) | `backend/src/routes/clip.ts` |
| Web Clipper timeout 15s | `backend/src/routes/clip.ts` |
| Web Clipper protocol validation (http/https only) | `backend/src/routes/clip.ts` |
| Export MD / HTML / PDF | `app/lib/services/export_service.dart` |
| Export deck a APKG | `backend/src/services/marketplaceSqliteService.ts` (planned v0.61) |
| Frontmatter migration tool | `app/test/frontmatter_migration_test.dart` |
| Attachment extract (PDF, images) | `app/test/validations/validate_attachment_extract.cjs` |

---

## 9. Búsqueda / Knowledge Graph

| Feature | Archivo(s) |
|---------|------------|
| **FTS5 con porter stemming** | `backend/src/services/searchService.ts` |
| FTS5 virtual tables (BM25 ranking) | `backend/src/services/searchService.ts` |
| **Stemmer bilingüe ES/EN** (custom) | `backend/src/services/stemmer.ts`, `routes/stemmer.ts` |
| Stemmer NFD normalize (sin acentos) | `backend/src/services/stemmer.ts` |
| Stemmer auto-detect de idioma | `backend/src/services/stemmer.ts` |
| Stemmer stopwords ES/EN | `backend/src/services/stemmer.ts` |
| Stemmer build FTS query con wildcards | `backend/src/services/stemmer.ts` |
| **RAG semántico on-device** (TF-IDF + RRF) | `app/lib/services/semantic_search.dart` |
| Semantic search persistido en disco | `app/lib/services/semantic_search.dart` |
| Bigram tokenization | `app/lib/services/semantic_search.dart` |
| **Command palette** (Cmd+K) | `app/lib/widgets/command_palette_dialog.dart` |
| Search screen con filtros | `app/lib/screens/search/search_screen.dart` |
| **Graph view** (force-directed) | `app/lib/screens/graph/graph_view_screen.dart` |
| Graph view service (wikilinks → nodes/edges) | `app/lib/services/graph_view_service.dart` |
| Graph view isolate (no bloquea UI) | `app/lib/services/graph_isolate.dart` |
| Graph max 500 nodos (sort by modified) | `app/lib/services/graph_view_service.dart` |
| Graph local mode (focus en un nodo) | `app/lib/screens/graph/graph_view_screen.dart` |
| Graph filter por folder/tag | `app/lib/screens/graph/graph_view_screen.dart` |
| Graph color por folder | `app/lib/screens/graph/graph_view_screen.dart` |
| Lazy search service (deferred indexing) | `backend/src/services/lazySearchService.ts` |
| Backlinks panel (NFD normalize) | `app/lib/widgets/backlinks_panel.dart` |
| Cross-relevance scoring | `backend/src/services/crossRelevance.ts` |

---

## 10. Multimedia (Audio / Video / Imágenes)

| Feature | Archivo(s) |
|---------|------------|
| **Audio recording** (voice notes) | `app/lib/services/voice_note_service.dart`, `screens/recording/recording_screen.dart` |
| **Whisper transcription** (real STT) | `backend/src/services/whisper.ts`, `routes/audio.ts` |
| **Streaming transcription** (WebSocket) | `backend/src/services/streamingTranscription.ts`, `routes/transcriptionStream.ts` |
| Audio transcribe queue | `app/lib/services/transcription_queue.dart`, `screens/recording/transcription_queue_screen.dart` |
| TranscriptionScreen (UI multipart upload) | `app/lib/screens/recording/transcription_screen.dart` (v0.62.18) |
| **TTS (text-to-speech)** en cards | `app/lib/services/tts_service.dart` |
| TTS 12 idiomas (es-ES, en-US, fr-FR, de-DE, it-IT, pt-BR, ja-JP, zh-CN, la) | `app/lib/services/tts_service.dart` |
| TTS control rate/pitch/volume | `app/lib/services/tts_service.dart` |
| Audio player widget | `app/lib/widgets/audio_player_widget.dart` |
| Audio attachments | `app/lib/services/attachments_service.dart` |
| Audio + Calendar cross-tag | `app/lib/services/calendar_service.dart` |
| Image picker (gallery + camera) | `app/lib/services/attachments_service.dart` |
| Camera OCR (imagen → texto) | `app/lib/screens/camera/ocr_screen.dart` |
| Deepseek OCR backend | `backend/src/services/deepseekOcr.ts` |
| Image occlusion cards | `app/lib/services/image_occlusion_service.dart` |
| Handwriting canvas | `app/lib/widgets/handwriting_canvas.dart` |
| Handwriting recognition (tesseract + heuristica) | `backend/src/services/handwritingService.ts` |
| YouTube embed | `app/lib/screens/embeds/youtube_embed.dart` |
| WebView embed in-app | `app/lib/screens/embeds/webview_embed.dart` |
| Twitter/X embed | `app/lib/screens/embeds/youtube_embed.dart` |

---

## 11. Whiteboard / Visual thinking

| Feature | Archivo(s) |
|---------|------------|
| Whiteboard screen | `app/lib/screens/whiteboard/whiteboard_screen.dart` |
| Whiteboards list | `app/lib/screens/whiteboard/whiteboards_list_screen.dart` |
| Mind map screen (AI-generated) | `app/lib/screens/ai/mindmap_screen.dart` |
| Slides screen (AI-generated) | `app/lib/screens/ai/slides_screen.dart` |
| Drag & drop en blocks | `app/lib/widgets/note_inline_rich.dart` |
| Graph view (también visual thinking) | `app/lib/screens/graph/graph_view_screen.dart` |

---

## 12. Calendar / Planning

| Feature | Archivo(s) |
|---------|------------|
| Exams screen | `app/lib/screens/exams/exams_screen.dart` |
| Exams service (create, list, save) | `app/lib/services/exams_service.dart` |
| **Timeline / Gantt view** | `app/lib/screens/exams/timeline_view.dart` |
| Timeline drag para reagendar | `app/lib/screens/exams/timeline_view.dart` |
| Timeline color por urgency | `app/lib/screens/exams/timeline_view.dart` |
| Calendar service (CRUD events) | `app/lib/services/calendar_service.dart` |
| Calendar cross-tag con audio | `app/lib/services/calendar_service.dart` |
| Calendar cross-tag con notas | `app/lib/services/calendar_service.dart` |
| System calendar integration | `app/lib/services/system_calendar_service.dart` |
| Calendar permissions | `app/lib/services/permissions.dart` |
| Plan screen | `app/lib/screens/plan/plan_screen.dart` (v0.62.11) |
| Daily notes con calendar UI | `app/lib/screens/daily/daily_notes_screen.dart` |

---

## 13. Productividad / Organization

| Feature | Archivo(s) |
|---------|------------|
| Subjects (asignaturas) | `app/lib/services/subjects_service.dart`, `screens/subjects/subjects_screen.dart` |
| Tags + tag pages | `backend/src/services/tagService.ts` |
| Kanban board (drag&drop) | `app/lib/services/kanban_service.dart`, `screens/kanban/kanban_screen.dart` |
| Kanban status en frontmatter | `app/lib/services/kanban_service.dart` |
| **Global Tasks** (`- [ ]` en todo el vault) | `app/lib/services/global_tasks_service.dart`, `screens/tasks/global_tasks_screen.dart` |
| Tasks con priority (🔺⏫🔼🔽⏬) | `app/lib/services/global_tasks_service.dart` |
| Tasks con due date (📅) | `app/lib/services/global_tasks_service.dart` |
| Tasks filter por tag/estado | `app/lib/screens/tasks/global_tasks_screen.dart` |
| **Database formulas** (mini-parser recursivo) | `app/lib/services/formula_engine.dart` |
| Database functions (sum/avg/if/now/dateAdd) | `app/lib/services/formula_engine.dart` |
| Database rollups | `app/lib/services/database_query_service.dart` |
| Database multi-view (table, board, list) | `app/lib/screens/database/database_screen.dart` |
| Database query service | `app/lib/services/database_query_service.dart` |
| Smart folders (queries saved) | `app/lib/services/smart_folder.dart` |
| Multi-workspace switcher | `app/lib/screens/vault/workspace_switcher.dart` |
| Trash con restore | `app/lib/screens/vault/trash_screen.dart` |
| Templates gallery | `app/lib/screens/note/template_picker_screen.dart` |
| Templater-style (variables en templates) | `app/lib/services/template_engine.dart` |
| Structured notes (custom types) | `backend/src/services/structuredNotes.ts` |
| Structured databases (rows + views) | `backend/src/routes/structuredDatabases.ts`, `structuredRows.ts`, `structuredViews.ts` |
| Adaptive quiz | `backend/src/services/adaptiveQuizEngine.ts` |
| Cramming mode | `app/lib/services/flashcard_service.dart` |

---

## 14. Stats / Gamification

| Feature | Archivo(s) |
|---------|------------|
| Stats dashboard | `app/lib/screens/stats/stats_screen.dart` |
| Study stats service | `app/lib/services/study_stats_service.dart` |
| **Heatmap** de repasos (365 días) | `app/lib/widgets/review_heatmap.dart`, `services/heatmap_service.dart` |
| Heatmap backend | `backend/src/services/heatmapService.ts` |
| Streaks (días consecutivos) | `app/lib/screens/stats/stats_screen.dart` |
| Retention rate (% correcta) | `app/lib/services/study_stats_service.dart` |
| FSRS curve visualization | `app/lib/screens/stats/stats_screen.dart` |
| Card distribution (state, due today) | `app/lib/screens/stats/stats_screen.dart` |
| Dashboard backend (métricas agregadas) | `backend/src/routes/dashboard.ts` |
| **Gamification** (XP, levels, achievements) | `backend/src/services/gamificationService.ts` |
| Metrics endpoint | `backend/src/routes/metrics.ts` |

---

## 15. Database / Structured data

| Feature | Archivo(s) |
|---------|------------|
| Database block (Notion-style) | `app/lib/screens/database/database_screen.dart` |
| Databases list | `app/lib/screens/database/databases_list_screen.dart` |
| Database service (Dart) | `app/lib/services/database_service.dart` |
| Database query service | `app/lib/services/database_query_service.dart` |
| Structured notes backend | `backend/src/services/structuredNotes.ts` |
| Structured databases API | `backend/src/routes/structuredDatabases.ts` |
| Structured rows API | `backend/src/routes/structuredRows.ts` |
| Structured views API | `backend/src/routes/structuredViews.ts` |
| Structured store | `backend/src/routes/structuredStore.ts` |
| Formulas engine (sum/avg/if) | `app/lib/services/formula_engine.dart` |
| Rollups (cross-database aggregation) | `app/lib/services/database_query_service.dart` |

---

## 16. Plugin system

| Feature | Archivo(s) |
|---------|------------|
| Plugin service (JS sandbox) | `backend/src/services/pluginService.ts` |

> ⚠️ Plugin system está marcado como "skipped" en el roadmap actual por decisión del usuario (no aporta valor al target), pero el código existe.

---

## 17. Web app

| Feature | Archivo(s) |
|---------|------------|
| Flutter Web build funcional | (compilación vía `flutter build web`) |
| **Web vault** (localStorage via shared_preferences) | `app/lib/services/web_vault_service.dart` (v0.62.18) |
| **Web seed** (3 notas demo en primera sesión) | `app/lib/services/web_seed.dart` (v0.62.18) |
| Web model JSON roundtrip | `app/lib/services/web_vault_service.dart` |
| Responsive layout (phone/tablet/desktop) | `app/lib/widgets/responsive.dart` (v0.62.17) |
| Tablet scaffold (sidebar + lista + detail) | `app/lib/screens/vault/vault_browser.dart` |
| IndexedDB (pendiente para vaults > 5MB) | (v0.63 pendiente) |

---

## 18. i18n / Localization

| Feature | Archivo(s) |
|---------|------------|
| App localizations base | `app/lib/l10n/app_localizations.dart` |
| Inglés (en) | `app/lib/l10n/app_localizations_en.dart` |
| Español (es) | `app/lib/l10n/app_localizations_es.dart` |
| Portugués (pt) | `app/lib/l10n/app_localizations_pt.dart` |
| i18n backend | `backend/src/utils/i18n.ts` |
| 97 keys idénticas en 3 idiomas | (ARB files) |
| Detección automática de idioma | `app/lib/l10n/app_localizations.dart` |

---

## 19. Theming / UI

| Feature | Archivo(s) |
|---------|------------|
| 4 temas built-in (Default Dark/Light, Solarized, Monokai) | `backend/src/services/themesService.ts` |
| Custom themes (user CRUD) | `backend/src/routes/themes.ts` |
| Theme density (compact, normal, cozy) | `backend/src/services/themesService.ts` |
| CSS variables output para webview | `backend/src/services/themesService.ts` |
| Theme export/import (JSON) | `backend/src/services/themesService.ts` |
| Design tokens (colores, spacing) | `app/lib/core/design_tokens.dart` |
| Glass widgets (frosted glass) | `app/lib/widgets/glass_widgets.dart` |
| Adaptive widgets (responsive) | `app/lib/widgets/adaptive/adaptive.dart` |
| Animations | `app/lib/core/main_shell.dart` |
| Empty states | `app/lib/widgets/empty_state.dart` |
| Safe text (anti-XSS) | `app/lib/widgets/safe_text.dart` |
| Settings screen | `app/lib/screens/settings/settings_screen.dart` |
| Changelog view in-app | `app/lib/screens/settings/changelog_view.dart` |
| Logs screen | `app/lib/screens/settings/logs_screen.dart` |
| Update dialog | `app/lib/widgets/update_dialog.dart` |
| **Gestures mobile** (SwipeToDelete, SwipeToAction, PullToRefresh, LongPressMenu) | `app/lib/widgets/gestures.dart` |
| HapticHelper (light/medium/heavy) | `app/lib/widgets/gestures.dart` |

---

## 20. Backend / API

### Servicios (45+ archivos)

| Servicio | Archivo |
|----------|---------|
| Adaptive quiz | `backend/src/services/adaptiveQuiz.ts`, `adaptiveQuizEngine.ts` |
| AI tutor | `backend/src/services/aiTutorService.ts` |
| Auto-backup | `backend/src/services/autoBackupService.ts` |
| Backup index | `backend/src/services/backupIndex.ts` |
| Cloze | `backend/src/services/clozeService.ts` |
| Conflict resolver | `backend/src/services/conflictResolver.ts` |
| CRDT sync | `backend/src/services/crdtSyncService.ts` |
| Cross-relevance | `backend/src/services/crossRelevance.ts` |
| Deepseek OCR | `backend/src/services/deepseekOcr.ts` |
| Embeddings cache | `backend/src/services/embeddingCache.ts` |
| Embeddings | `backend/src/services/embeddings.ts` |
| Gamification | `backend/src/services/gamificationService.ts` |
| Graph | `backend/src/services/graphService.ts` |
| Handwriting OCR | `backend/src/services/handwritingService.ts` |
| Heatmap | `backend/src/services/heatmapService.ts` |
| Image occlusion | `backend/src/services/imageOcclusionService.ts` |
| Import (APKG, PDF, Notion, Roam, Obsidian, CSV) | `backend/src/services/importService.ts` |
| Key exchange ECDH | `backend/src/services/keyExchangeService.ts` |
| Lazy search | `backend/src/services/lazySearchService.ts` |
| LLM multi-provider | `backend/src/services/llm.ts` |
| Marketplace legacy | `backend/src/services/marketplaceRealService.ts` |
| Marketplace SQLite | `backend/src/services/marketplaceSqliteService.ts` |
| OCR | `backend/src/services/ocr.ts` |
| PDF annotation | `backend/src/services/pdfAnnotationService.ts` |
| Plugin sandbox | `backend/src/services/pluginService.ts` |
| Proposals LLM | `backend/src/services/proposalsV2.ts` |
| Push notifications FCM | `backend/src/services/pushNotifications.ts` |
| Search FTS5 | `backend/src/services/searchService.ts` |
| Secret manager | `backend/src/services/secretManager.ts` |
| Stemmer ES/EN | `backend/src/services/stemmer.ts` |
| Streaming transcription | `backend/src/services/streamingTranscription.ts` |
| Structured notes | `backend/src/services/structuredNotes.ts` |
| Tag service | `backend/src/services/tagService.ts` |
| Template service | `backend/src/services/templateService.ts` |
| Themes | `backend/src/services/themesService.ts` |
| Type-answer cards | `backend/src/services/typeAnswerService.ts` |
| Vault evaluation | `backend/src/services/vaultEval.ts` |
| Web clipper | `backend/src/services/webClipperService.ts` |
| Whisper | `backend/src/services/whisper.ts` |
| Wikilinks | `backend/src/services/wikilinkService.ts` |

### Rutas / Endpoints (35+ archivos)

| Endpoint | Archivo |
|----------|---------|
| AI v1 (legacy) | `backend/src/routes/ai.ts` |
| AI v2 (chat, embeddings, rag) | `backend/src/routes/ai_v2.ts` |
| Audio (upload + transcribe) | `backend/src/routes/audio.ts` |
| Auth (login, refresh, devices) | `backend/src/routes/auth.ts` |
| Auto-backup | `backend/src/routes/autoBackup.ts` |
| Backup (zip) | `backend/src/routes/backup.ts` |
| Web Clipper | `backend/src/routes/clip.ts` |
| CRDT WebSocket | `backend/src/routes/crdt.ts` |
| Dashboard | `backend/src/routes/dashboard.ts` |
| Flashcards | `backend/src/routes/flashcards.ts` |
| FSRS queue | `backend/src/routes/fsrsQueue.ts` |
| Handwriting | `backend/src/routes/handwriting.ts` |
| Health | `backend/src/routes/health.ts` |
| Import | `backend/src/routes/import.ts` |
| Key exchange | `backend/src/routes/keyExchange.ts` |
| LLM | `backend/src/routes/llm.ts` |
| Marketplace legacy | `backend/src/routes/marketplaceReal.ts` |
| Marketplace SQLite | `backend/src/routes/marketplaceSqlite.ts` |
| Metrics | `backend/src/routes/metrics.ts` |
| Notes flow (test) | `backend/src/routes/notesFlow.ts` |
| OCR | `backend/src/routes/ocr.ts` |
| PDF | `backend/src/routes/pdf.ts` |
| PDF annotation | `backend/src/routes/pdfAnnotation.ts` |
| Push | `backend/src/routes/push.ts` |
| Rollback | `backend/src/routes/rollback.ts` |
| Search | `backend/src/routes/search.ts` |
| Secrets | `backend/src/routes/secrets.ts` |
| Stemmer | `backend/src/routes/stemmer.ts` |
| Structured databases | `backend/src/routes/structuredDatabases.ts` |
| Structured rows | `backend/src/routes/structuredRows.ts` |
| Structured views | `backend/src/routes/structuredViews.ts` |
| Structured store | `backend/src/routes/structuredStore.ts` |
| Sync LWW | `backend/src/routes/sync.ts` |
| Themes | `backend/src/routes/themes.ts` |
| Transcription stream | `backend/src/routes/transcriptionStream.ts` |
| Update | `backend/src/routes/update.ts` |
| Upload | `backend/src/routes/upload.ts` |
| WebSocket | `backend/src/routes/ws.ts` |

---

## 21. Seguridad / Middleware

| Feature | Archivo(s) |
|---------|------------|
| JWT middleware | `backend/src/middleware/auth.ts` |
| CSP headers | `backend/src/middleware/cspHeaders.ts` |
| Per-user rate limit | `backend/src/middleware/perUserRateLimit.ts` |
| CORS policy | `backend/src/utils/corsPolicy.ts` |
| Path validation (anti traversal) | `backend/src/utils/pathValidation.ts` |
| WebSocket rate limit | `backend/src/services/wsRateLimit.ts` |
| Worm audit (anti prompt injection) | `backend/src/services/wormAudit.ts` |
| Error codes estructurados | `backend/src/utils/errorCodes.ts` |
| Safe call wrapper | `backend/src/utils/safeCall.ts` |
| Safe call app-side | `app/lib/utils/safe_call.dart` |

---

## 22. Observabilidad / Métricas

| Feature | Archivo(s) |
|---------|------------|
| Logger backend | `backend/src/utils/log.ts` |
| Logger app | `app/lib/services/logger.dart`, `logger_models.dart` |
| Metrics endpoint | `backend/src/routes/metrics.ts` |
| Metrics util | `backend/src/utils/metrics.ts` |
| Health endpoint | `backend/src/routes/health.ts` |
| Update checker | `backend/src/services/updateChecker.ts`, `routes/update.ts` |
| Updater service app | `app/lib/state/updater_service.dart` |
| Updater IO | `app/lib/services/updater_io.dart` |
| Updater models | `app/lib/services/updater_models.dart` |
| Updater cache test | `app/test/updater_cache_test.dart` |
| Logs screen (in-app) | `app/lib/screens/settings/logs_screen.dart` |

---

## 23. Operativa / Deploy

| Feature | Archivo(s) |
|---------|------------|
| **Dockerfile** multi-stage (node:22-alpine) | `Dockerfile` |
| **docker-compose.yml** (m-nexus + nginx) | `docker-compose.yml` |
| **nginx.conf** (SSL + CSP + rate limit + WebSocket) | `nginx.conf` |
| **.dockerignore** | `.dockerignore` |
| Healthcheck en Dockerfile | `Dockerfile` |
| Usuario no-root en Docker | `Dockerfile` |
| Setup device script | `scripts/setup_device.sh` |
| Health check script | `scripts/health_check.sh` |
| Sync E2E test script | `scripts/test_sync_e2e.sh` |
| Install script | `install/install.sh` |
| Backup (auto-backup service) | `backend/src/services/autoBackupService.ts` |
| Backup restore | `backend/src/services/autoBackupService.ts` |
| Rollback endpoint | `backend/src/routes/rollback.ts` |

---

## 24. CI / CD

| Feature | Archivo(s) |
|---------|------------|
| **CI workflow** (test backend + app + docker) | `.github/workflows/ci.yml` |
| **Release workflow** (auto-release en push a main) | `.github/workflows/release.yml` |
| Build Docker image en CI | `.github/workflows/release.yml` (job `build-docker`) |
| Push Docker image a ghcr.io | `.github/workflows/release.yml` |
| Test Docker image (healthcheck) | `.github/workflows/ci.yml` (job `test-docker`) |
| Build APK (release + debug) | `.github/workflows/release.yml` |
| Package installer | `.github/workflows/release.yml` |
| Create GitHub Release | `.github/workflows/release.yml` |
| Detect version (pubspec.yaml) | `.github/workflows/release.yml` |
| Cache gradle | `.github/workflows/release.yml` |
| Cache npm | `.github/workflows/ci.yml` |
| Cache pub | `.github/workflows/ci.yml` |
| Debug APK workflow | `.github/workflows/debug-apk.yml` |

---

## 📊 Resumen numérico (snapshot v0.62.18)

| Categoría | Cantidad |
|-----------|----------|
| Archivos backend TS | 107 |
| Archivos app Dart | 153 |
| Servicios backend | 45+ |
| Rutas backend | 35+ |
| Pantallas app (Screens) | 55+ |
| Widgets app | 20 |
| Tests backend | ~700+ (686 pass, 6 fail, 56 skip en main) |
| Tests Flutter | 91 |
| Validation scripts (.cjs) | 22 |
| Idiomas soportados | 3 (en, es, pt) |
| Temas built-in | 4 |
| Decks marketplace seeded | 3 |
| Idiomas TTS | 12 |
| Algoritmo SRS | FSRS v5 (21 parámetros) |
| Endpoints API | 100+ |

---

## 🚧 Pendiente / Roadmap

Próximas versiones según `ROADMAP.md`:

- **Fase A** (v0.63): CRDT Yjs en cliente + Whisper audio route
- **Fase B** (v0.64): Web completo (IndexedDB para vaults grandes)
- **Fase C** (v0.65): Multi-workspace colaborativo

Backlog:
- Cram mode UI
- Filtered decks
- Interleaving automático
- Custom retention target UI
- Audio cards completas
- Block-level references UI
- Themes custom UI
- OCR UI pulida
- Voice commands
- Landing page
- Discord community

---

> **Generado:** 2026-09-14
> **Fuente:** exploración directa del repo en `main` (post-pull de v0.62.18)
> **Mantenedor:** este archivo se debe regenerar tras cada release mayor.
