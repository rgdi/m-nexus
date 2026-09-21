# M-NEXUS — Frontend (v2.23.4)

> Tablet-first · offline-first · accessible-by-default. Vanilla JS + CSS variables, no
> framework. Built with esbuild into a single 1.4 MB / 79 file bundle for the
> Capacitor WebView, or served directory-by-directory from any static host.

## Stack

- **Zero framework.** Vanilla ES modules + CSS variables (design tokens).
- **PointerEvents API** for stylus (pressure, tilt) on the canvas.
- **three.js (CDN)** for the 3D viewer (loader, hotspots, orbit camera).
- **CRDT (custom + Yjs via CDN)** for note sync with field-level conflict merge.
- **localStorage** fallback when the backend is offline.
- **Cluster-aware**: peers WS-reconnect to whichever node is closest. See
  [docs/SCALING.md](../docs/SCALING.md).
- **No build step required** for dev. Production builds with `scripts/build_webview.sh`.

## Run locally

```bash
# 1. From the repo root, serve the source as static files
cd frontend
python3 -m http.server 8080

# 2. Open http://localhost:8080
```

The app expects the backend at `http://localhost:4100`. If unreachable, it falls back
to localStorage (demo seed loads automatically).

### Build for production (single-file webview bundle)

```bash
# From repo root
bash scripts/build_webview.sh /tmp/mnexus-bundle

# Output: /tmp/mnexus-bundle (1.4 MB, ~79 files)
# Single-file bundle for Capacitor/Cordova WebView.
```

## Tests

```bash
cd frontend
./node_modules/.bin/vitest run

# v2.23.3: 30 files, 422 tests, ~3 s
```

## File map (v2.23.3)

```
frontend/
├── public/
│   ├── index.html                entry point + dock bottom (FAB top-left for menu)
│   ├── manifest.json             PWA manifest
│   └── favicon.svg
└── src/
    ├── main.js                   router + bootstrap + cluster peer indicator
    ├── styles/
    │   ├── tokens.css            colors, spacing, hit-target sizes, safe-area
    │   ├── base.css              reset + typography, focus-visible 3 px outline
    │   ├── layout.css            app shell + dock + hamburger drawer
    │   ├── components.css        buttons, cards, modals, sub-row, color-swatches
    │   │                         + drop-target indicator + templates-modal
    │   ├── calendar.css          day / week calendar
    │   └── notebook.css          stylus canvas + pencil drawer
    ├── services/
    │   ├── api.js                HTTP client (REST + Bearer) + subjects methods
    │   │                         (reorder, bulkReplace, removeAll)
    │   ├── auth.js               login/refresh tokens
    │   ├── dataSource.js         backend (localStorage wrapper + IndexedDB queue)
    │   ├── i18n.js               es/en/pt messages (130+ strings)
    │   ├── fsrs.js               spaced repetition client
    │   ├── syllabus.js           deadline-aware study planner
    │   ├── exam.js               exam mode coordinator
    │   ├── theme.js              light/dark/auto
    │   ├── vault.js              multi-vault switcher
    │   ├── device.js             device fingerprinting + WS reconnect key
    │   ├── crdt.js               local CRDT LWW + tombstones + per-field undo
    │   ├── sync_client.js        WS /ws/sync + sync:incoming + sync:merged events
    │   ├── yjs_client.js         Yjs official client via CDN
    │   ├── stylus.js             pressure curves + tiltAlpha
    │   ├── safe.js               escapeHtml, escapeAttr, lazy guards
    │   ├── field_history.js      per-field undo/redo, 50 steps max, in-memory
    │   ├── safe_areas.js         notch / camera-cutout / curved-edge detection
    │   ├── notif_capture.js      Android notification listener poll + IndexedDB retry
    │   └── syncMetrics.js        admin dashboard metrics (replays, supersedes, etc)
    ├── screens/
    │   ├── overview.js           landing screen (today / due / streak)
    │   ├── calendar.js           day / week calendar with drag-to-create
    │   ├── subjects.js           flat list, drag-drop, color picker,
    │   │                         bulk adder, templates, multi-device sync
    │   ├── notes.js              stylus canvas (pressure + tilt + palm + OCR + hover)
    │   ├── todos.js              to-do's with priority + due dates
    │   ├── ai.js                 AI tutor chat
    │   ├── settings.js           preferences incl. AI provider, Stylus & pressure
    │   ├── cluster.js            admin: peer list, health probe, role mgmt
    │   ├── android_settings.js   Notification Listener + Foreground Service config
    │   └── login.js              admin login screen (12-char minimum password)
    └── widgets/
        ├── study_session.js              study/exam/review/cram modes
        ├── cloze_test.js                 open cloze with fuzzy match
        ├── command_palette.js            Cmd+K palette
        ├── file_attachments.js           image / pdf / .glb
        ├── ai_tutor.js                   FAB chat
        ├── graph_3d.js                   three.js force-directed
        ├── three_d_viewer.js             3D model viewer (GLB hotspots)
        ├── anatomy_generator.js          cell biology models (procedural)
        ├── syllabus_dashboard.js         syllabus tracker
        ├── ocr_toast.js                  OCR feedback transient
        ├── palm_rejection.js             capture-phase listener
        ├── conflict_merge_panel.js       CRDT merge UI
        ├── setup_wizard.js               8-slide first-run (generic chips)
        ├── hamburger_fab.js              bottom-left FAB + Material drawer
        └── …                             30+ widgets total
```

## Module index by feature

### Canvas / stylus (notes.js)

| Helper (v2.16+) | Description |
|---|---|
| `applyPressureCurve(rawP, curve, opts)` | linear / soft / firm / exponential |
| `tiltAlpha(tiltDeg, response)` | 0° → 1.0, 90° → 0.4 opacity |
| `getPressureConfig()` / `setPressureConfig()` | localStorage `mnexus.stylus.v1` |
| `installPalmRejection(canvas)` | capture-phase >1500 px² guard |
| `runOCR(stroke)` | debounced 800 ms, POST `/api/v1/handwriting/recognize` |
| `showOcrToast(text, conf, source)` | transient feedback |

### Subjects (subjects.js, v2.22.1+ → v2.23.x)

- Empty by default — no fake seed
- Drag & drop with **visual drop indicator** (animated blue line + halo on target row)
- Mobile long-press → drag-floating-clone with haptic vibration
- 8 career templates + bulk add + reset all + row menu (edit / up / down / color / delete)
- **Multi-device sync**: WS-receive `type=subject`, re-render in <1 s
- WCAG-AA color swatches with `--fg-on-subj-X` per-color token

### 3D models

- `three_d_viewer.js` loads three.js from CDN, dynamic-imports `GLTFLoader`
- `anatomy_generator.js` keeps `CELL_DATA` with hotspots (`animal_cell`, `plant_cell`,
  `bacterium`)
- Click hotspot → `location.hash = "#/notes?topic=..."` with anchor
- Real anatomical `.glb` files deferred to v2.24 (skipped per request — cells still procedural)

### Sync (dual pipeline)

- `crdt.js` (local LWW + tombstones) — bootstrap data before WS
- `sync_client.js` — WS connection to `ws://localhost:4100/ws/sync`, dispatches
  `sync:incoming`, `sync:merged`, and `cluster:peers`
- `yjs_client.js` — Yjs official WS to `/api/v1/crdt/ws/:notePath` for binary deltas

### Cluster peers (v2.23.3+)

- `connectSync()` accepts `/api/v1/cluster/peers` from server
- Reconnect to lowest-latency peer if current node dies
- Top-right pill: green = current, yellow = fallback, red = all down
- Admin can add/remove peers via `screens/cluster.js`

### AI

- Settings → AI Provider (Ollama URL, OpenRouter key, OpenAI base) → persists in
  `data/ai-config.json`
- aiTagger heuristic + LLM via bounded 200-token prompts, 3 s timeout
- Approve candidate → flashcard via `studyPlanner.ts decide()`

## Design philosophy

- **Tablet-first**, mobile-friendly (responsive 360×640 / 390×844 / 720×1024 /
  1440×900).
- **Crystal-clean** rounded corners (12 px border-radius).
- **Glass-style dock** at the bottom, adaptive per viewport; visible on every
  breakpoint since v2.6.0.
- **Subject bubbles** with strong color identity (8 colors, WCAG-AA tested).
- **Pencil drawer** with multiple pens (colors + sizes).
- **Pressure-sensitive** drawing configurable (curve, sensitivity, tilt response).
- **Palm rejection** for natural hand position on tablets.
- **Hover preview** for stylus pen (size + crosshair).
- **Auto-save** on every stroke.
- **Offline-first**: works without backend.
- **Spanish from Spain** primary, English code comments.

## Accessibility (WCAG 2.2 AA)

- 3 px focus-visible outline + 3 px offset (`:focus:not(:focus-visible)` reset on clicks)
- 44 px touch-targets on `pointer: coarse` via `--hit-target-min` token
- Safe-area aware (notch / camera cutout / curved edges) via `services/safe_areas.js`
- Bottom-left hamburger FAB (no longer collides with camera)
- Per-color `--fg-on-subj-X` (white-on-yellow is invisible; we flip it to black)
- Skip-to-content link on first Tab (added in v2.22.0)
- ARIA live regions on the OCR toast
- `prefers-reduced-motion` respected on conflict-merge animations

## Roadmap

✅ **Done (v1.0 → v2.23.x)**:

- **v2.23.3** — Docker Compose, systemd unit, SHA-256 verified installer,
  auto-upgrade cron, dynamic subjects templates, multi-device sync
- **v2.23.0** — Drag&drop visual feedback, multi-device subject sync,
  career templates
- **v2.22.0** — UX/a11y overhaul (hamburger FAB, safe areas, WCAG AA)
- **v2.21.1** — Notif filter, IDB failure queue, per-field undo/redo,
  conflict-merge animation
- **v2.21.0** — Notification listener service, foreground sync service,
  openExternalUrl/shareText/canOpenUrl natives
- **v2.20.0** — Clickable conflict-merge cards
- **v2.19.0** — Capacitor Android wrapper + device registration + offline
  queue
- **v2.18.0** — Capacitor CLI 8.5 + targetSdk 34
- **v2.17.0** — TS cleanup (32 errors → 0)
- **v2.16.0** — Conflict merge UI, Yjs, .glb upload, pressure curves
- **v2.15.0** — Cell .glb models (animal/plant/bacterium), CRDT vector clocks
- **v2.14.0** — OCR confidence (real TSV), tilt opacity, GLB infra
- **v2.13.0** — Pressure drawing, palm rejection, offline OCR
- **v2.12.0** — LLM auto-tagging (heuristic + Ollama/OpenRouter)
- **v2.10.0** — Approval → flashcard auto, occlusion persistence, GLB
  loader, deterministic FSRS
- **v2.6.0** — Production-ready admin auth, backups, AI providers, tunnel
- **v2.4–v2.5** — Adaptive UI per viewport
- **v1.5–v1.9** — Editor, icons, FSRS, palette, multi-vault
- **v1.0** — RESET (vanilla JS+CSS)

🔜 **Next candidates** (v2.24+):

- Real anatomical `.glb` models (still procedural)
- Drag-drop `.glb` upload UI in `notes.js`
- Yjs awareness cursors (see where other users are typing live)
- WebRTC fallback for sync when WebSocket is blocked
- iOS Info.plist mappings

## Contributing

- Vanilla JS only — no React / Vue / TS in `frontend/src`
- CSS variables for any theme-related changes (touch `tokens.css`)
- New screens: implement `async function renderName(root)`, exported
- Tests: vitest in `frontend/tests/`, keep them fast (≤300 ms each)
- i18n: add the new string to `services/i18n.js` in **all three locales**
