# Backend-only Features — Estado de exposición

> **Propósito:** transparencia sobre qué features del backend están realmente usadas por el frontend, cuáles están parciales, y cuáles son backend-only sin UI.
>
> **Última actualización:** 2026-09-15 · **v2.1.4** (vanilla JS frontend, no Flutter)

---

## ✅ Features expuestas en el frontend

### Notas / Knowledge

| Feature | Estado frontend | Notas |
|---|---|---|
| CRUD notes | ✅ Total | `screens/notes.js` notebook + canvas |
| CRUD subjects | ✅ Total | `screens/subjects.js` bubbles + detail |
| CRUD events | ✅ Total | `screens/calendar.js` day/week + drag-create |
| CRUD tasks | ✅ Total | `screens/todos.js` priority + due + chips |
| CRUD recordings | ✅ Parcial | `widgets/audio_recorder.js` (crea), list no expuesto |
| Text-layer markup | ✅ Total | `==under==`, `!!hi!!`, `[[wiki]]`, `@book/ref`, `{{c1::}}` |
| Wikilinks → navigate | ✅ Total | click → busca nota por título |
| Cross-verify | ✅ Total | `widgets/cross_verify_panel.js` |
| Book refs jump-to-minute | ✅ Total | `cross_verify_panel.js` |

### Flashcards / FSRS

| Feature | Estado | Notas |
|---|---|---|
| Create flashcards | ✅ Total | manual + extract from `{{c1::}}` |
| FSRS spaced repetition | ✅ Total | `services/fsrs.js` + `widgets/study_session.js` |
| Study session (4 modes) | ✅ Total | study/exam/review/cram |
| Anki-grade requeue | ✅ Total | 4 states, REQUEUE_MAX=3 |
| Cloze deletion test | ✅ Total | `widgets/cloze_test.js` |
| Image occlusion | ✅ Total | `widgets/file_attachments.js` + quiz mode |
| Attachments | ✅ Total | image/pdf/.glb preview |
| PDF export | ✅ Total | `widgets/pdf_export.js` (strokes + flashcards) |

### Syllabus / Study plan

| Feature | Estado | Notas |
|---|---|---|
| Syllabus CRUD | ✅ Total | `services/syllabus.js` + `widgets/syllabus_dashboard.js` |
| Mastery tracking | ✅ Total | per-topic, FSRS-based |
| Deadline-aware plan | ✅ Total | `studyPlan()` con status + tips |
| Auto-extract topics | ✅ Total | from `[[]]`, headings, `#tags` |
| Gap detection | ✅ Total | low mastery or stale (>14 days) |
| Recommendations | ✅ Total | top-10 per subject |

### AI

| Feature | Estado | Notas |
|---|---|---|
| AI Tutor FAB | ✅ Total | `widgets/ai_tutor.js` (chat panel + FAB) |
| AI context (note+subject) | ✅ Total | `setAIContext()` |
| AI submenu (extract/summarize/quiz/define) | ✅ Total | notebook + AI menu |
| Tutor chat | ✅ Total | POST `/api/v1/ai/tutor` (Ollama) |
| Quiz mode AI | ✅ Total | adaptive questions |
| Knowledge graph (AI) | ❌ Backend only | backend tracks concepts + gaps |
| Cross-relevance AI | ❌ Backend only | no UI exposed |

### Sync / CRDT

| Feature | Estado | Notas |
|---|---|---|
| Sync WebSocket | ⚠️ Parcial | `services/sync_client.js` connect + publish, pero UI sin dashboard |
| CRDT LWW | ✅ Total | backend applies on receive |
| Tombstones | ✅ Total | GC 7 days |
| History replay | ✅ Total | late joiners catch up |
| Multi-vault | ✅ Total | `services/vault.js` + switcher pill |

### Discovery / UI

| Feature | Estado | Notas |
|---|---|---|
| Cmd+K palette | ✅ Total | 5 groups (subjects/notes/flashcards/tasks/events) |
| Tags cloud | ✅ Total | sidebar + inline injection |
| Theme toggle | ✅ Total | light/dark/auto |
| Lang switcher | ✅ Total | es/en/pt |
| Top toolbar (undo/redo/bg/hide) | ✅ Total | notebook + global |
| Splash screen | ✅ Total | "Education Service / always at hand" |
| 3D viewer (.glb) | ✅ Total | `widgets/three_d_viewer.js` |
| 3D graph (force-directed) | ✅ Total | `widgets/graph_3d.js` (wikilinks + book refs + tags) |
| Slash command `/flashcards` | ✅ Total | `widgets/flashcard_slash.js` |
| Definition popup | ✅ Total | long-press 600ms en canvas |

---

## ⚠️ Backend-only (sin UI expuesta)

| Feature | Backend | Por qué sin UI |
|---|---|---|
| `/api/v1/handwriting/recognize` | ✅ | OCR está expuesto como `/ocr/image`. Reconoce handwriting pero UI actual no lo invoca específicamente. |
| Backup ZIP upload/download | ✅ | Sin UI; intended para instalación desktop |
| Auto-update (GitHub Releases) | ✅ | Sin UI; corre en background |
| Themes CRUD | ✅ | Solo "default + dark" usados en frontend |
| LLM multi-provider (Anthropic/OpenAI/OpenRouter) | ✅ | UI solo expone Ollama |
| Secrets (AES-256-GCM) | ✅ | Solo backend-only |
| Push notifications | ✅ | Backend listo, frontend no suscrito |
| Stemmer/Search FTS5 | ✅ | UI tiene Cmd+K que no usa FTS5 directamente |
| Import (HTML/MD/Notion) | ✅ | Sin wizard UI |
| Structured databases / views / rows | ✅ | Sin UI (Airtable-style) |
| Marketplace | ✅ | Solo backend |
| Audio transcription stream (WS) | ✅ | UI solo one-shot |
| PDF diff | ✅ | Sin UI |

---

## 📋 Features todavía NO implementadas en backend

- Real-time collaborative editing (CRDT per-field, only LWW)
- Voice-to-voice (TTS)
- Web Clipper browser extension
- Native mobile sync (iOS Swift / Android Kotlin clients)

---

## 📊 Métricas

- **Frontend**: 44 archivos (JS + CSS), ~8,500 LOC vanilla
- **Backend**: 46 routes + 45 services + 11 utils, ~19,200 LOC TS
- **Tests**: 796 backend vitest + 315+ frontend validation + 31 e2e + 24 mobile screenshots = ~1,170 verifications
- **CI**: 4 jobs (test-backend, test-frontend, test-e2e-mobile, test-docker)
- **Tags**: v1.0.0 → v2.1.4 (13 releases)
