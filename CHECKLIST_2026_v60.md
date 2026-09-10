# CHECKLIST v0.60 — P0-P3 audit closure

**Fecha:** 2026-09-10
**Versión:** 0.60.1+131
**Status:** ✅ TODOS LOS GAPS P0-P3 CERRADOS

## P0 — Críticos (9/9 ✅)

| Gap | Status | Detalles |
|-----|--------|----------|
| P0.1 CRDT WS broadcast real | ✅ | Hub global + heartbeat + awareness + magic bytes. 11/11 tests |
| P0.2 File locking `synchronized` | ✅ | FileLock.run aplicado a 5 services. Validated |
| P0.3 `AppState.recordReview` in-place | ✅ | getCard/updateCard sin re-list |
| P0.4 Secure storage API keys | ✅ | flutter_secure_storage + AiConfig.toJson sin key |
| P0.5 Cleanup código muerto | ✅ | syncService.ts + proposals.ts eliminados |
| P0.6 Logger en vez de print | ✅ | 3 services migrados |
| P0.7 RAG semántico on-device | ✅ | TF-IDF + RRF + persistencia. 5 tests |
| P0.8 FSRS optimizer | ✅ | Random search + hill-climbing 21 params. 3 tests |
| P0.9 E2E encryption AES-256-GCM | ✅ | cryptography pkg + recovery 12 palabras. 3 tests |

## P1 — Core features (11/11 ✅)

| Gap | Status | Detalles |
|-----|--------|----------|
| P1.1 Image Occlusion editor UI | ✅ | InteractiveViewer + GestureDetector + label dialog |
| P1.2 Leech + Cramming + Burned | ✅ | detectLeeches, cram, markAsBurned en FlashcardService |
| P1.3 TTS 12 idiomas | ✅ | flutter_tts + TtsService |
| P1.4 Web Clipper endpoint | ✅ | /api/v1/clip/{html,url,info}. 9 tests |
| P1.5 Graph view UI | ✅ | Force-directed CustomPaint + InteractiveViewer |
| P1.6 Timeline / Gantt | ✅ | timeline_view.dart con drag&drop reagendar |
| P1.7 Global Tasks | ✅ | GlobalTasksService + screen con filter por estado/tag |
| P1.8 Templater-style | ✅ | date/time/title/uuid/rand/prompt/clipboard/var. 9 tests |
| P1.9 Kanban board | ✅ | status frontmatter + DragTarget<KanbanCard> |
| P1.10 Database formulas | ✅ | sum/avg/if/now/dateAdd. Mini-parser recursivo. 5 tests |
| P1.11 AnkiHub marketplace | ✅ | decks/versions/reviews/installs/stats. 21 tests |

## P2 — Nice-to-have (4/4 ✅)

| Gap | Status | Detalles |
|-----|--------|----------|
| P2.1 PDF highlighting | ✅ | text+rect format, export markdown. 10 tests |
| P2.2 Handwriting OCR | ✅ | tesseract + heuristica. 8 tests |
| P2.3 Auto-backup | ✅ | intervalMin + maxBackups + SHA256 + restore. 10 tests |
| P2.4 Custom themes | ✅ | 4 built-in + CSS vars + density. 19 tests |

## P3 — Low priority (4/4 ✅)

| Gap | Status | Detalles |
|-----|--------|----------|
| P3.1 Path validation | ✅ | safePath/safeName anti traversal. 15 tests |
| P3.2 Per-user rate limit | ✅ | Bucket per-user + burst. 4 tests |
| P3.3 CSP headers | ✅ | CSP + X-Frame + HSTS. 9 tests |
| P3.4 Undo/Redo | ✅ | UndoManager + NoteCreateOp/DeleteOp/RenameOp. 3 tests |

## Resumen final

- **28/28 gaps cerrados** (100%)
- **Tests:** 619 backend pass + 596 app assertions = 1215 total
- **Líneas añadidas:** ~6000 Dart + ~3000 TS
- **Commits nuevos en v0.60.x:** 2 (v0.60.0 P0 + v0.60.1 P1-P3)
- **Pendiente para v0.61:**
  - Migrar marketplace a SQLite
  - RSA keypair real para E2E
  - WebView embeds in-app
  - Isolate para force-directed layout
  - Integration tests E2E
  - Backup integrity signing
