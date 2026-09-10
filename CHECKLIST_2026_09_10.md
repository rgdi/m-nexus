# CHECKLIST M-NEXUS — Estado al 2026-09-10

## Milestone 1 — Bug fixes + UX basico ✅ COMPLETADO (v0.49.2 → v0.49.7)

| ID | Item | Version | Estado |
|----|------|---------|--------|
| A1 | Anki-style buttons | v0.46 | ✅ Ya estaba (Again/Hard/Good/Easy) |
| A2 | APKG import UI | v0.49.2 | ✅ Backend + dialog client |
| A3 | Move notes | v0.49.3 | ✅ moveNote + menu contextual |
| A4 | Markdown plaintext | — | ⏳ NoteEditor ya lo hacia |
| A5 | Flashcards auto-approved | v0.49.7 | ✅ Por default en create() |
| A6 | Drawing/handwriting | v0.47.34 | ✅ Ya estaba |
| A7 | AI Tutor historial + tests | v0.49.4 | ✅ Persistencia + extract Q/A |
| A8 | Edit flashcard anytime | v0.49.7 | ✅ FlashcardEdit con existing |
| A9 | Auto-link notes → PDF/PPT | — | ⏳ Pendiente (Milestone 3) |
| A10 | Move/rename folders | v0.49.3 | ✅ renameFolder + deleteFolder |
| A11 | Rich text editor (blocks) | v0.49.8-9 | ✅ BlockEditor AFFiNE-style |
| A12 | Remove 'asignaturas' de settings | — | ⏳ Pendiente |
| A13 | Auto flashcards auto-approved | v0.49.7 | ✅ |
| A14 | Verification section main | v0.49.5 | ✅ Subject del dia + tareas |
| A15 | Daily notes Notion-style | v0.49.6 | ✅ Template + calendario |
| A16 | Home: subject-in-real-time | v0.49.5 | ✅ _subjectOfDay() |
| A17 | Calendar bug "selects day-1" | v0.49.6 | ✅ Mini-calendar con day=1..31 |
| A18 | Audio recorder | — | ⏳ Pendiente (Milestone 4) |
| A19 | Sync backend client | — | ⏳ Pendiente |
| A20 | Text 125% overflow | — | ⏳ Pendiente (Milestone 5) |

## Milestone 2 — AFFiNE-style editor (parcial) ✅

| ID | Item | Version | Estado |
|----|------|---------|--------|
| C1 | Notion-style blocks | v0.49.8 | ✅ 14 tipos de bloque |
| C2 | Tables | v0.49.8 | ✅ Row-by-row (grid real v0.50) |
| C3 | Slash menu | v0.49.8 | ✅ 14 tipos |
| C4 | Drag & drop reorder | v0.49.9 | ✅ ReorderableListView |
| C5 | Math | v0.49.8 | ⏳ Monospace italic (KaTeX v0.50) |
| C6 | Code highlight | v0.49.8 | ⏳ Basic (syntax en v0.50) |
| C7 | Embeds | — | ⏳ Pendiente (v0.50) |
| C8 | Linked DBs | — | ⏳ Pendiente (v0.50) |
| C9 | Whiteboards | — | ⏳ Pendiente (v0.51) |
| C10 | Mind maps | — | ⏳ Pendiente (v0.51) |
| C11 | AI copilot | v0.49.4 | ✅ Chat + extraer Q/A |
| C12 | Templates gallery | v0.49.9 | ✅ 5 templates |
| C13 | Comments | — | ⏳ Pendiente (v0.50) |
| C14 | Version history | — | ⏳ Pendiente (v0.50) |
| C15 | Notion/CSV/Roam import | v0.49.2 | ✅ Backend ready (clients parcial) |
| C16 | PDF/HTML/MD export | — | ⏳ Pendiente (v0.50) |
| C17 | Multi-column layout | — | ⏳ Pendiente (v0.50) |
| C18 | Outline sidebar | — | ⏳ Pendiente (v0.50) |
| C19 | Page links (wikilinks) | v0.47.32 | ✅ Ya estaba |
| C20 | Real-time sync | — | ⏳ Pendiente (v0.51) |

## Milestone 3 — Interlinking PDF/PPT + AI — PENDIENTE

## Milestone 4 — Audio recorder + clase auto-asignación — PENDIENTE

## Milestone 5 — Polish + audit + tests overflow 125% — PENDIENTE

## Tests
- Backend: 585/585 pasan (1 skipped pre-existente)
- App validations: 122 tests en 9 scripts (todos pasan)
- APKG parsing: 3 tests nuevos en importService.test.ts
- Mocks: 0 (validación real con AdmZip + better-sqlite3)

## Commits esta sesión
- v0.49.2: APKG import real (Anki deck parser)
- v0.49.3: Move/rename/delete notes + folders + import dialog
- v0.49.4: Chat AI con historial, generar flashcards/tests
- v0.49.5: Home con subject-of-the-day, tareas, próximo examen
- v0.49.6: Daily notes Notion-style con calendario
- v0.49.7: Edit/delete flashcard, Anki-style flow
- v0.49.8: Block editor AFFiNE-style con slash menu
- v0.49.9: Block editor: drag&drop + templates gallery
