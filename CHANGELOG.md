# CHANGELOG — M-NEXUS

## v1.0.0 (2026-09-14) — Reset & rewrite

**Reset total.** Frontend y apps eliminados. Empezamos de cero con el enfoque Education Service.

### Eliminado

- `app/` (Flutter Android, 153 archivos, 2.4MB)
- `install/` (script bash legacy)
- `_M-NEXUS/` (vault personal)
- 72 tags históricos (v0.28 a v0.62) y 3 ramas (`feat/audit-2026-09-10`, `production-ready-v0.63`, `v1.0-rewrite`)

### Frontend nuevo (`frontend/`, 128KB, zero framework)

- `public/index.html` — entry con dock bottom (estilo Education Service)
- `src/styles/` — design tokens + base + layout + components + calendar + notebook
- `src/services/api.js` — HTTP client con timeout
- `src/services/store.js` — localStorage wrapper + `collection()` helper
- `src/services/demoSeed.js` — sembrado offline
- `src/screens/overview.js` — landing con eventos + subject bubbles + stats
- `src/screens/calendar.js` — Day/Week + create event modal
- `src/screens/subjects.js` — bubbles + detail con grades grid + e-books
- `src/screens/notes.js` — **STYLUS CANVAS** con PointerEvents + multi-page + pencil drawer
- `src/screens/todos.js` — to-dos con priority + due dates
- `src/screens/ai.js` — AI Tutor chat

### Features del frontend

- Tablet-first responsive (≥720dp sidebar, <720dp single column)
- Auto-save en cada stroke del notebook
- Pressure + tilt del stylus (PointerEvents API)
- Multiple pencils (rojo/azul/morado/negro) + highlighter + eraser
- Insert toolbar: voice, code, image, graph, link, table
- Intelligent overview (AI summary placeholder)
- Offline-first: detecta backend, fallback localStorage automático
- Dark mode via `prefers-color-scheme`

### Backend conservado

- 45+ servicios, 35+ rutas
- FSRS Spaced Repetition (21 parámetros, 4 ratings)
- Sync LWW (Last-Write-Wins) inter-device
- E2E encryption (AES-256-GCM + ECDH P-256)
- Marketplace con SQLite real
- Web Clipper (HTML→MD, URL→MD)
- Search FTS5 + stemmer ES/EN bilingüe
- Whisper transcription
- AI Tutor con RAG

### Roadmap

Próximas versiones:

- **v1.1.0** — Conectar todos los endpoints del backend al frontend (marketplace, sync, E2E settings)
- **v1.2.0** — i18n en frontend (es/en/pt)
- **v1.3.0** — Handwriting OCR + PDF import + highlights
- **v1.4.0** — Theme custom UI + sync dashboard
- **v1.5.0** — Tests E2E con Playwright

### Stats

- **Frontend:** 21 archivos, ~3000 LOC, 0 deps
- **Backend:** 107 archivos TS, 700+ tests
- **Total nuevo:** ~9000 LOC
- **Eliminado:** ~15000 LOC (código Flutter legacy)
