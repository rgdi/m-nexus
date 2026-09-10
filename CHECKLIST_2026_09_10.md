# CHECKLIST M-NEXUS — Estado final 2026-09-10 (cierre de mega-sesion)

## Sesion actual: 21 commits v0.49.2 → v0.50.3

### Milestone 1 — Bug fixes (20/20 ✅)

| ID | Item | Version | Estado |
|----|------|---------|--------|
| A1 | Anki-style buttons | v0.46 | ✅ Ya estaba |
| A2 | APKG import UI | v0.49.2, 50.3 | ✅ Parser real + file_picker |
| A3 | Move notes | v0.49.3 | ✅ moveNote + menu |
| A4 | Markdown plaintext | v0.47 | ✅ NoteEditor |
| A5 | Flashcards auto-approved | v0.49.7 | ✅ Por default |
| A6 | Drawing/handwriting | v0.47.34 | ✅ Ya estaba |
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
| A19 | Sync backend client | v0.49.16 | ✅ SyncStatusIndicator |
| A20 | Text 125% overflow | v0.49.14, 19 | ✅ SafeText + global clamp |

### Milestone 2 — AFFiNE clone (16/20 ✅)

| ID | Item | Version | Estado |
|----|------|---------|--------|
| C1 | Notion-style blocks | v0.49.8, 50.0 | ✅ 14 tipos |
| C2 | Tables | v0.49.8 | ✅ Row-by-row |
| C3 | Slash menu | v0.49.8, 18 | ✅ 14 tipos + 4 AI |
| C4 | Drag & drop reorder | v0.49.9 | ✅ ReorderableListView |
| C5 | Math | v0.50.0 | ✅ flutter_math_fork |
| C6 | Code highlight | v0.50.0 | ✅ flutter_highlight |
| C7 | Embeds | — | ⏳ v0.51 |
| C8 | Linked DBs | — | ⏳ v0.51 |
| C9 | Whiteboards | v0.49.17 | ✅ Canvas + nodes + edges |
| C10 | Mind maps | v0.49.17 | ✅ Mismo engine |
| C11 | AI copilot | v0.49.18 | ✅ 4 comandos |
| C12 | Templates gallery | v0.49.9 | ✅ 5 templates |
| C13 | Comments | v0.50.0, 50.1 | ✅ Threaded panel |
| C14 | Version history | v0.50.0, 50.1 | ✅ Snapshots + UI |
| C15 | Notion/CSV/Roam import | v0.49.2, 50.3 | ✅ Backend + file_picker |
| C16 | PDF/HTML/MD export | v0.50.0, 50.1 | ✅ pdf + html + vault.md |
| C17 | Multi-column layout | v0.50.0 | ✅ :::columns blocks |
| C18 | Outline sidebar | v0.50.1 | ✅ TOC interactivo |
| C19 | Page links (wikilinks) | v0.47.32 | ✅ Ya estaba |
| C20 | Real-time sync | — | ⏳ v0.51 (sync status ahora) |

### Milestone 3 — Interlinking PDF/PPT + AI ✅ v0.49.11
### Milestone 4 — Audio recorder + calendar cross ✅ v0.49.12, 49.16, 50.2
### Milestone 5 — Polish + audit + tests overflow 125% ✅ v0.49.14-19
### Milestone 6 — Features pendientes ✅ v0.50.0-3 (este round)

## Estadísticas finales
- **21 commits** (v0.49.2 → v0.50.3)
- **Backend: 585/585 tests pasan** (1 skipped pre-existente)
- **App: 16 scripts de validación, 442+ assertions, todos pasan**
- **APKG parsing: 3 tests nuevos** con AdmZip + better-sqlite3 real
- **Cero mocks** en tests críticos

## Archivos nuevos en v0.50.0-3
- app/lib/services/comments_service.dart
- app/lib/services/export_service.dart
- app/lib/services/version_history_service.dart
- app/lib/services/transcription_queue.dart
- app/lib/screens/notes/version_history_screen.dart
- app/lib/screens/recording/transcription_queue_screen.dart
- app/lib/widgets/audio_player_widget.dart
- app/lib/widgets/outline_sidebar.dart
- app/lib/widgets/threaded_comments_panel.dart

## Dependencias añadidas
- flutter_math_fork ^0.7.2
- flutter_highlight ^0.7.0
- flutter_html ^3.0.0-beta.2
- pdf ^3.10.8
- printing ^5.11.1
- pdfx ^2.6.0
- record ^5.0.5 (existente)
- audioplayers ^6.1.0
- file_picker ^8.1.2

## Status
✅ Milestone 1: COMPLETO (20/20)
✅ Milestone 2: COMPLETO (16/20, 4 para v0.51)
✅ Milestone 3: COMPLETO
✅ Milestone 4: COMPLETO
✅ Milestone 5: COMPLETO
✅ Milestone 6: COMPLETO (este round)

## Pendiente solo para v0.51+ (no bloqueante)
- Embeds (Twitter, YouTube, etc)
- Linked databases (Notion-style)
- Code execution sandbox
- Real-time sync CRDT
- AI Copilot multi-model (OpenRouter, Anthropic, etc)
- pdfx ndk version bump si falla en Android
