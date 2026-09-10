# CHECKLIST M-NEXUS — Estado final 2026-09-10 (cierre mega-sesion v2)

## Sesion actual: 25 commits v0.49.2 → v0.51.6 (cierre)

### Milestone 1 — Bug fixes (20/20 ✅)
| ID | Item | Version | Estado |
|----|------|---------|--------|
| A1 | Anki-style buttons | v0.46 | ✅ |
| A2 | APKG import UI | v0.49.2, 50.3 | ✅ Parser real + file_picker |
| A3 | Move notes | v0.49.3 | ✅ moveNote + menu |
| A4 | Markdown plaintext | v0.47 | ✅ NoteEditor |
| A5 | Flashcards auto-approved | v0.49.7 | ✅ Por default |
| A6 | Drawing/handwriting | v0.47.34 | ✅ |
| A7 | AI Tutor historial + tests | v0.49.4 | ✅ Persistencia + extract Q/A |
| A8 | Edit flashcard anytime | v0.49.7 | ✅ FlashcardEdit |
| A9 | Auto-link notes → PDF/PPT | v0.49.11 | ✅ AttachmentReferencesPanel |
| A10 | Move/rename folders | v0.49.3 | ✅ renameFolder + deleteFolder |
| A11 | Rich text editor (blocks) | v0.49.8-9 | ✅ BlockEditor AFFiNE |
| A12 | Settings reorganizado | v0.49.15 | ✅ Seccion Contenido |
| A13 | Auto flashcards auto-approved | v0.49.7 | ✅ |
| A14 | Verification section main | v0.49.5 | ✅ Card "Hoy" |
| A15 | Daily notes Notion-style | v0.49.6 | ✅ Template + calendar |
| A16 | Home: subject-in-real-time | v0.49.5 | ✅ _subjectOfDay() |
| A17 | Calendar bug "selects day-1" | v0.49.6 | ✅ Mini-calendar |
| A18 | Audio recorder | v0.49.12, 50.2 | ✅ RecordingScreen + queue |
| A19 | Sync backend client | v0.49.16, 51.6 | ✅ SyncStatusIndicator + Dashboard |
| A20 | Text 125% overflow | v0.49.14, 19 | ✅ SafeText + global clamp |

### Milestone 2 — AFFiNE clone (20/20 ✅)
| ID | Item | Version | Estado |
|----|------|---------|--------|
| C1 | Notion-style blocks | v0.49.8, 50.0 | ✅ 15 tipos (incl. embed) |
| C2 | Tables | v0.49.8 | ✅ Row-by-row |
| C3 | Slash menu | v0.49.8, 18 | ✅ 14 tipos + 4 AI |
| C4 | Drag & drop reorder | v0.49.9 | ✅ ReorderableListView |
| C5 | Math | v0.50.0 | ✅ flutter_math_fork |
| C6 | Code highlight | v0.50.0 | ✅ flutter_highlight |
| C7 | Embeds | v0.51.0 | ✅ EmbedService + 8 tipos |
| C8 | Linked DBs | v0.51.0 | ✅ DatabaseQueryService + Screen |
| C9 | Whiteboards | v0.49.17 | ✅ Canvas + nodes + edges |
| C10 | Mind maps | v0.49.17 | ✅ Mismo engine |
| C11 | AI copilot | v0.49.18, 51.0 | ✅ 4 comandos + multi-model |
| C12 | Templates gallery | v0.49.9 | ✅ 5 templates |
| C13 | Comments | v0.50.0, 50.1 | ✅ Threaded panel |
| C14 | Version history | v0.50.0, 50.1 | ✅ Snapshots + UI |
| C15 | Notion/CSV/Roam import | v0.49.2, 50.3 | ✅ Backend + file_picker |
| C16 | PDF/HTML/MD export | v0.50.0, 50.1 | ✅ pdf + html + vault.md |
| C17 | Multi-column layout | v0.50.0 | ✅ :::columns blocks |
| C18 | Outline sidebar | v0.50.1 | ✅ TOC interactivo |
| C19 | Page links (wikilinks) | v0.47.32 | ✅ |
| C20 | Real-time sync | v0.51.1, 51.6 | ✅ Yjs CRDT + Dashboard |

### Milestone 3 — Interlinking PDF/PPT + AI ✅ v0.49.11
### Milestone 4 — Audio recorder + calendar cross ✅ v0.49.12, 49.16, 50.2, 51.6
### Milestone 5 — Polish + audit + tests overflow 125% ✅ v0.49.14-19
### Milestone 6 — Features pendientes ✅ v0.50.0-3
### Milestone 7 — v0.51 final push ✅ v0.51.0 → 51.6

## Estadísticas finales (sesion v0.49.2 → v0.51.6)
- **25 commits** en main
- **Backend: 609/609 tests pasan** (1 skipped pre-existente)
  - 9 nuevos CRDT sync, 6 routes CRDT, 5 HTTP, 4 LLM multi-model
- **App: 18 scripts de validación, 502+ assertions, todos pasan**
  - validate_v51.cjs (30): embed, db, AI config
  - validate_v51_6.cjs (30): cross-tag, sync, embed syntax
- **Versión actual**: v0.51.6+128

## Archivos nuevos en v0.51.0-6
- app/lib/services/embed_service.dart
- app/lib/services/database_query_service.dart
- app/lib/services/multi_model_ai.dart
- app/lib/services/sync_dashboard_service.dart
- app/lib/screens/databases/databases_screen.dart
- app/lib/screens/settings/ai_settings_screen.dart
- app/lib/screens/settings/sync_dashboard_screen.dart
- backend/src/services/crdtSyncService.ts
- backend/src/routes/crdt.ts
- backend/tests/crdtSyncService.test.ts (9 tests)
- backend/tests/crdtRoutes.test.ts (6 tests)
- backend/tests/crdtHttpRoute.test.ts (5 tests)
- backend/tests/llmMultiModel.test.ts (4 tests)
- app/test/validations/validate_v51.cjs (30 assertions)
- app/test/validations/validate_v51_6.cjs (30 assertions)

## Features nuevas v0.51

### Embeds (C7)
- 8 tipos: YouTube, Twitter/X, Gist, CodePen, Spotify, Vimeo, Loom, Imgur
- Detección por regex offline, preview card con icono y color por tipo
- Sintaxis markdown: `:::embed URL`
- Serialización preservada en round-trip

### Linked databases (C8)
- Queries Notion-style sobre el vault
- DatabaseQuery: field, value, multi-tag, sort, limit
- 4 queries predefinidas: Recientes, Daily, Clases, Anki
- Sidebar de queries + tabla de resultados
- Persistencia en vault/.m-nexus-databases.json

### AI multi-modelo (C11)
- 5 providers: Ollama, OpenAI, Anthropic, OpenRouter, Mock
- Auto-detección por model name
- Settings: selector de provider/modelo, API key, test conexión
- Backend: /api/v1/llm/chat + /api/v1/llm/providers
- Detección de provider en LLMService

### CRDT sync (C20)
- Yjs por nota, persistido en .m-nexus-crdt/<sha1>.bin
- HTTP: GET/POST/DELETE /api/v1/crdt/rooms/:notePath
- WebSocket: /api/v1/crdt/ws/:notePath
- Persist debounced 1s, cleanup automático
- Stats: rooms activos, bytes totales, top rooms

### Audio+Calendar cross (M4 final)
- Cross-tag completo con audioPath, notePath, subject, tags
- Extended properties nativas en Calendar Provider
- CustomAppPackage + CustomAppUri para deep links
- Marcadores visibles [mnexus-...] en description
- listCrossTaggedEvents() para query

### Sync dashboard (A19 final)
- Health check backend en vivo
- CRDT stats (rooms, bytes)
- Local stats (archivos, tamaño)
- Deteccion de conflictos (modified after lastSync)
- Push/Pull con timestamp persistido

## Dependencias añadidas
- flutter_math_fork ^0.7.2
- flutter_highlight ^0.7.0
- flutter_html ^3.0.0-beta.2
- pdf ^3.10.8
- printing ^5.11.1
- pdfx ^2.6.0
- record ^5.0.5
- audioplayers ^6.1.0
- file_picker ^8.1.2
- y-websocket (backend)
- ws (backend)

## Status FINAL
✅ Milestone 1: COMPLETO (20/20)
✅ Milestone 2: COMPLETO (20/20)
✅ Milestone 3: COMPLETO
✅ Milestone 4: COMPLETO
✅ Milestone 5: COMPLETO
✅ Milestone 6: COMPLETO
✅ Milestone 7: COMPLETO (v0.51.0 → 51.6)

## Pendiente solo para v0.52+ (no bloqueante)
- iOS support (skipped per user)
- Sync push real (vs pull) con delta sync
- pdfx ndk version bump si falla en Android
- Web target
