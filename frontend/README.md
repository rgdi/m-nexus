# M-NEXUS — Frontend (v2.17.0)

> **Tablet-first** Education Service UI: Overview, Calendar, Subjects, Notes (stylus-first canvas con pressure + tilt + palm rejection + OCR), To-do's, AI Tutor, 3D models (cell biology), 3D knowledge graph, FSRS-4.5 spaced repetition, Yjs official sync, conflict merge UI, pressure curve settings, command palette, multi-vault.

## Stack

- **Zero framework.** Vanilla ES modules + CSS variables (design tokens).
- **PointerEvents API** for stylus (pressure, tilt) on the canvas.
- **three.js (CDN)** for 3D viewer (loader, hotspots, orbit camera).
- **Yjs (CDN)** for binary CRDT sync (binary deltas + awareness).
- **localStorage** fallback when the backend is offline (auto-detected).
- **No build step required** — open `public/index.html` from any static server. ESbuild produces a 1.2 MB single-file bundle for Capacitor/Cordova/WebView.

## Run locally

```bash
# 1. From the repo root
cd frontend
python3 -m http.server 8080

# 2. Open http://localhost:8080
```

The app expects the backend at `http://localhost:4100`. If unreachable, it falls back to localStorage (demo seed loads automatically).

### Build for production (single-file webview)

```bash
# From repo root
bash scripts/build_webview.sh /tmp/mnexus-bundle

# Output: /tmp/mnexus-bundle (1.2 MB, ~71 files)
# Single-file bundle for Capacitor/Cordova WebView.
```

## Tests

```bash
cd frontend
./node_modules/.bin/vitest run

# v2.16.0: 21 test files, 255 tests passing
```

## File map

```
frontend/
├── public/
│   ├── index.html             entry point + dock bottom
│   ├── manifest.json          PWA manifest
│   └── favicon.svg
└── src/
    ├── main.js                router + bootstrap + lazy widget installs (ocrToast,
    │                          conflict_merge_panel, etc)
    ├── styles/
    │   ├── tokens.css         design tokens (colors, spacing)
    │   ├── base.css           reset + typography
    │   ├── layout.css         app shell + dock
    │   ├── components.css     buttons, cards, modals
    │   ├── calendar.css       day / week calendar
    │   └── notebook.css       stylus canvas + pencil drawer
    ├── services/
    │   ├── api.js             HTTP client (REST + Bearer token)
    │   ├── auth.js            login/refresh tokens
    │   ├── dataSource.js      store backend (localStorage wrapper)
    │   ├── i18n.js            es/en/pt messages (130+ strings)
    │   ├── fsrs.js            spaced repetition client (delegates to backend)
    │   ├── syllabus.js        deadline-aware study planner
    │   ├── exam.js            exam mode coordinator
    │   ├── theme.js           light/dark/auto
    │   ├── vault.js           multi-vault switcher
    │   ├── device.js          device fingerprinting
    │   ├── crdt.js            local CRDT LWW + tombstones
    │   ├── sync_client.js     WebSocket client + sync:merged events (v2.16)
    │   ├── yjs_client.js      Yjs official client via CDN (v2.16)
    │   ├── stylus.js          pressure curves + tiltAlpha (v2.16)
    │   └── safe.js            escapeHtml, escapeAttr, lazy guards
    ├── screens/
    │   ├── overview.js        landing screen
    │   ├── calendar.js        day / week calendar with drag-to-create
    │   ├── subjects.js        list + detail (grades grid)
    │   ├── notes.js           stylus canvas (pressure + tilt + palm + OCR + hover)
    │   ├── todos.js           to-do's with priority + due dates
    │   ├── ai.js              AI tutor chat
    │   ├── settings.js        preferences incl. AI provider, Stylus & pressure (v2.16)
    │   └── login.js           admin login screen
    └── widgets/
        ├── study_session.js           study/exam/review/cram modes
        ├── cloze_test.js              open cloze with fuzzy match
        ├── command_palette.js         Cmd+K palette
        ├── file_attachments.js        image / pdf / .glb
        ├── ai_tutor.js                FAB chat
        ├── graph_3d.js                three.js force-directed
        ├── three_d_viewer.js          3D model viewer (GLB hotspots)
        ├── anatomy_generator.js       cell biology models (v2.15)
        ├── syllabus_dashboard.js      Syllabus tracker
        ├── ocr_toast.js               OCR feedback transient (v2.14)
        ├── palm_rejection.js          capture-phase listener (v2.13)
        ├── conflict_merge_panel.js    CRDT merge UI (v2.16)
        ├── setup_wizard.js            8-slide first-run
        └── …                          27 widgets total
```

## Modules by feature

### Canvas/stylus (notes.js)

| v2.16 helpers | Description |
|---|---|
| `applyPressureCurve(rawP, curve, opts)` | linear/soft/firm/exponential mapping |
| `tiltAlpha(tiltDeg, response)` | 0° → 1.0, 90° → 0.4 opacity |
| `getPressureConfig()` / `setPressureConfig()` | localStorage `mnexus.stylus.v1` |
| `installPalmRejection(canvas)` | capture-phase >1500 px² guard |
| `runOCR(stroke)` | debounced 800ms, POST `/api/v1/handwriting/recognize` |
| `showOcrToast(text, conf, source)` | transient feedback |

### 3D models

- `three_d_viewer.js` carga three.js de CDN, dynamic-import `GLTFLoader`
- `anatomy_generator.js` mantiene `CELL_DATA` con hotspots (`animal_cell`, `plant_cell`, `bacterium`)
- Click hotspot → `location.hash = "#/notes?topic=..."` con anchor

### Sync (dual pipeline)

- `crdt.js` (local LWW + tombstones) — bootstrap data antes de WS
- `sync_client.js` — WS connection a `ws://localhost:4100/ws/sync`, dispatch `sync:incoming` y `sync:merged`
- `yjs_client.js` — Yjs official WS a `/api/v1/crdt/ws/:notePath` para notas

### AI

- Settings → AI Provider (Ollama URL, OpenRouter key, OpenAI base) → persiste en `data/ai-config.json`
- aiTagger heurístico: `extractHeuristic()` con diccionario Spanish/Latin
- aiTagger LLM: prompts bounded 200 tokens, JSON output, 3s timeout
- Approve candidate → flashcard real via `studyPlanner.ts decide()`

## Design philosophy

- **Tablet-first**, mobile-friendly (responsive 360×640 / 390×844 / 720×1024 / 1440×900).
- **Glass-style dock** at the bottom (Education Service reference), adaptive per viewport.
- **Subject bubbles** with strong color identity (red/yellow/blue/purple/green).
- **Pencil drawer** with multiple pens (colors + sizes).
- **Pressure-sensitive** drawing configurable (curve, sensitivity, tilt response).
- **Palm rejection** for natural hand position on tablets.
- **Hover preview** for stylus pen (size + crosshair).
- **Auto-save** on every stroke.
- **Offline-first**: works without backend.
- **Cristal-clean** rounded corners (12px border-radius).
- **Spanish from Spain** primary, English code comments.

## Roadmap

✅ **Done (v1.0 → v2.16)**:
- v2.16: Conflict merge UI, Yjs official, .glb upload, Pressure curves
- v2.15: Cell .glb models (animal/plant/bacterium), CRDT vector clocks + field LWW
- v2.14: OCR confidence (real TSV), tilt opacity, OCR toast, GLB infra
- v2.13: Pressure drawing, palm rejection, offline OCR via tesseract
- v2.12: LLM auto-tagging (heuristic + Ollama/OpenRouter), mobile canvas, sync E2E tests
- v2.11: AI tagger, CF Access cache, splitter hint, mobile toolbar drawer
- v2.10: Approval→flashcard auto, occlusion persistence, GLB loader, deterministic FSRS
- v2.9: Occlusion UI, FSRS simulator, approval persistence
- v2.8: Knowledge diagnostic, exam scheduler, AI approvals, anatomy
- v2.7: Cmd-K verified, swipe nav, vault export, FSRS sim, occlusion backend
- v2.6: Production-ready admin auth, backups, AI providers, tunnel
- v2.4–v2.5: Adaptive UI per viewport
- v2.3: Notes folders hierarchical sidebar
- v2.0–v2.1: Webview bundle, exams, syllabus, attachments, AI tutor
- v1.5–v1.9: Editor, icons, FSRS, palette, multi-vault
- v1.0: RESET (vanilla JS+CSS)

🔜 **Next (v2.17 candidates)**:
- Clickable merge cards (navigate to merged resource from panel)
- Drag & drop .glb upload UI (frontend, not curl)
- Yjs awareness cursors (see where other users are typing)
- Per-field undo/redo using the CRDT state
