# M-NEXUS — Education Service (v2.23.3)

> **Tablet-first** Education Service for medical students.
> Notebook (stylus + pressure), calendar, subjects, to-dos, AI tutor, **spaced repetition (FSRS-4.5)**, **syllabus tracker**, **3D knowledge graph + 3D anatomy (cell biology)**, **admin auth with 90-day sessions**, **auto-backup**, **Cloudflare Tunnel ready**, **Yjs CRDT sync**, **conflict merge UI**, **user-uploaded .glb models**, **pressure-curve settings**, **offline handwriting OCR**.
> Vanilla JS frontend + Fastify backend. Local-first or cloud-deployed.

---

## ¿Qué es M-NEXUS?

Una **plataforma de conocimiento académico** centrada en el estudiante de medicina. La promesa: **llegar al examen habiendo cubierto el 100% del temario**.

Combina:
- **Notebook stylus-first** — canvas con presión, tilt, palm rejection, OCR de handwriting, hover preview para pen
- **Capa de texto** (Samsung Notes style) — `[[wikilinks]]`, `{{c1::cloze::answer}}`, `@book/ref`
- **Flashcards con FSRS-4.5** + auto-tagging AI (heurístico + LLM opcional vía Ollama/OpenRouter)
- **Syllabus Tracker** deadline-aware: te dice si vas a llegar al 100% antes del examen
- **AI Tutor contextual** (RAG sobre tus propias notas)
- **Graph 3D** de conexiones entre notas
- **3D viewer de modelos anatómicos** — célula animal, célula vegetal, bacteria con orgánulos como hotspots
- **Sync E2E** vía WebSocket + REST — CRDT casero (vector clocks + field-level LWW) **Y** Yjs oficial
- **Conflict merge UI** — cuándo dos dispositivos editan el mismo recurso, ves exactamente qué campo ganó
- **Upload de modelos .glb** — trae tu propio modelo de anatomía (anatomía, célula, equipo, lo que sea)
- **Pressure curve customizable** — soft/firm/exp/linear con preview en vivo
- **Webview bundle** autocontenido (funciona en Capacitor/Cordova/WebView nativo)
- **Android APK** vía Capacitor (CI genera `app-debug.apk` automáticamente)

---

## Android (Capacitor, v2.18.0 + v2.19-v2.21)

M-NEXUS envuelve el webview bundle en una APK Android nativa usando Capacitor 8.5. La APK se genera automáticamente en CI y se sube como artifact de workflow.

**Capacidades nativas implementadas (v2.18.0–v2.21.0)**:
- **Battery optimization plugin** (v2.20.0): `NativeIntentPlugin.openIgnoreBatteryOptimizations()` despacha `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (con fallback OEM para Xiaomi/Huawei/Honor).
- **External URL helper** (v2.21.0): `openExternalUrl({url})` abre URLs http/https/mailto/tel/geo/etc en el handler del sistema. Schemes whitelisted en Java — file:// / content:// se rechazan.
- **Share sheet** (v2.21.0): `shareText({text, title, dialogTitle})` despacha `ACTION_SEND` con chooser.
- **Foreground sync service** (v2.21.0): `SyncForegroundService` con `foregroundServiceType="dataSync"` y `PARTIAL_WAKE_LOCK` (10min). Notification persistente en canal "mnexus-sync" IMPORTANCE_LOW. Arrancable/parable desde JS.
- **Notification listener** (v2.21.0): `NotificationCaptureService` lee metadatos (app, título, categoría) — NUNCA contenido personal — de cada notificación publicada. JS drena la cola cada 30s y POSTea a `/api/v1/notifications/ingest`. Requiere opt-in manual del usuario vía Settings → Notifications.
- **Device registry + heartbeat** (v2.19.0): persistente en `data/devices.json`, reportado cada 60s.
- **Offline queue + sync replay** (v2.19.0): IndexedDB-backed, replay CRDT-coherente via `/api/v1/sync/replay`.
- **Granular permissions** (v2.19.0): READ_MEDIA_*, RECORD_AUDIO, CAMERA, ACCESS_FINE_LOCATION, POST_NOTIFICATIONS, FOREGROUND_SERVICE_DATA_SYNC, SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, BIND_NOTIFICATION_LISTENER_SERVICE (v2.21.0).

**Build local**:
```bash
# Prerrequisitos: JDK 17 + Android SDK 34+ instalado
export ANDROID_HOME=/path/to/android-sdk
bash scripts/build_android.sh         # debug APK
bash scripts/build_android.sh release # release APK (sin firma)
```

**Conectar al backend desde Android**:
- Emulador: `http://10.0.2.2:4100` (loopback del host)
- Device físico en LAN: `window.MNEXUS_BACKEND_URL = "http://192.168.1.X:4100"` (configurar antes de compilar el bundle)
- Override runtime: `localStorage.setItem("mnexus.backendUrl", "http://...")` en devtools

**Detección automática**: `frontend/src/services/api_base.js` (v2.20.0, centralizado) detecta `window.Capacitor` y usa `10.0.2.2:4100` en emulador. La `network_security_config.xml` permite HTTP cleartext a `10.0.2.2`, `localhost`, `127.0.0.1` para dev.

**Output**:
```
android/app/build/outputs/apk/debug/app-debug.apk    # ~10-15 MB
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Quick start

### Install with one command (v2.23.1+)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install.sh | bash
```

That single command downloads the latest release and offers three modes
for whatever you need:

| Mode | What you get |
|---|---|
| `app` *(default)* | Android APK in `~/.mnexus/apk/`. Then `adb install -r ./mnexus-v2.23.x-debug.apk` |
| `server` | Backend running on `:4100`. `--full` también descarga el bundle para servirlo |
| `deploy` | Bundle estático en `/var/www/html` o sirviendo vía `python3 -m http.server` |

Examples:
```bash
# Solo el APK debug
curl -fsSL .../install.sh | bash

# Backend corriendo en tu VPS
curl -fsSL .../install.sh | bash -s -- server

# Solo frontend desplegado (Apache / Nginx o python http server)
curl -fsSL .../install.sh | bash -s -- deploy --port 8080

# Versión específica
curl -fsSL .../install.sh | bash -s -- --version v2.23.2

# Carpeta personalizada + dominio
curl -fsSL .../install.sh | bash -s -- server \
    INSTALL_DIR=/opt/mnexus INSTALL_DOMAIN=mysite.com
```

After install (server mode):
```bash
~/.mnexus/run-server.sh                            # start
kill $(cat ~/.mnexus/server.pid 2>/dev/null)       # stop
tail -f ~/.mnexus/logs/server.log                  # logs
```

The installer is fully idempotent — re-running it detects the existing
install and upgrades in place.

### Develop locally

```bash
# Backend
cd backend
npm ci
npm run dev          # http://localhost:4100
npm test             # 930 tests (vitest)

# Frontend (vanilla JS, sin build step)
cd frontend
python3 -m http.server 8080
# Open http://localhost:8080

# Webview bundle (single-file, ~1.2 MB)
bash scripts/build_webview.sh /tmp/mnexus-bundle
```

On first open, the **setup wizard** walks you through 8 slides:
1. Welcome (value prop + hero)
2. Pick your vault (default / school / personal / work)
3. Add your first subject
4. Notebook tips (`{{c1::}}`, `[[]]`, `@book/ref`)
5. Flashcards with FSRS (4 study modes)
6. AI provider (Ollama local / OpenRouter / OpenAI / mock)
7. Admin account + auto-backup config
8. Done — open dashboard

Re-run anytime via the hamburger menu → "Re-run setup wizard".

---

## Estructura del repo

```
m-nexus/
├── frontend/                          ← Vanilla HTML/CSS/JS (~70 archivos, ~25 KB LOC)
│   ├── public/
│   │   ├── index.html                 entry point + dock bottom
│   │   ├── manifest.json              PWA manifest
│   │   └── favicon.svg
│   ├── src/
│   │   ├── main.js                    router, bootstrap, theme, cmd-palette, sync, panel installs
│   │   ├── styles/                    tokens, base, layout, components, calendar, notebook
│   │   ├── screens/                   overview, calendar, subjects, notes, todos, ai, settings, login
│   │   ├── services/                  api, store, dataSource, i18n, fsrs, exams,
│   │   │                              syllabus, crdt, sync_client, theme, vault, device,
│   │   │                              stylus (pressure curves), yjs_client (CDN)
│   │   └── widgets/                   27 widgets (study_session, cloze_test,
│   │                                  command_palette, file_attachments, ai_tutor,
│   │                                  graph_3d, three_d_viewer, anatomy_generator,
│   │                                  syllabus_dashboard, ocr_toast, palm_rejection,
│   │                                  conflict_merge_panel, …)
│   ├── public/models/                 animal_cell.glb + plant_cell.glb + bacterium.glb + user/
│   └── tests/                         21 vitest files, 255 tests
│
├── backend/                           ← Node.js + Fastify + SQLite (~80 routes, ~35 KB LOC)
│   ├── src/
│   │   ├── server.ts                  buildServer() + register all routes + middleware
│   │   ├── routes/                    52 routes (subjects, notes, flashcards, ai,
│   │   │                              auth, backup, ocr, pdf, sync_v2, crdt, ws,
│   │   │                              update, glbModels, …)
│   │   ├── services/                  52 services (FSRS, LLM, RAG, search, devices,
│   │   │                              crdt (vector clocks + field LWW), aiTagger,
│   │   │                              aiProviders, …)
│   │   ├── middleware/                auth (with PUBLIC_PATHS), csp, rate limit
│   │   ├── auth/                      JWT, devices, audit
│   │   └── utils/                     log (pino), errorCodes (AppError), safeCall
│   ├── public/models/                 3 built-in cell models (106K+61K+49K)
│   ├── tests/                         77 vitest files, 930 tests
│   └── data/                          JSON persistence (notes, flashcards, ai-config…)
│
├── scripts/
│   ├── start_backend.sh                dev runner (port 4100)
│   ├── start_frontend.sh               dev runner (port 8080)
│   └── build_webview.sh                single-file bundle (~1.2 MB)
│
├── app/test/
│   ├── validations/                   12 validate_*.cjs (315+ assertions)
│   └── e2e/                           Playwright + 60+ screenshots
│
├── docs/                              API.md, ERROR_CODES.md, LOGGING.md, …
├── .github/workflows/                 ci.yml (4 jobs), release.yml
├── Dockerfile + docker-compose.yml    container build
└── nginx.conf                         reverse proxy
```

---

## What's new

### v2.16.0 (Conflict merge UI + Yjs official + GLB upload + Pressure curves)

- **Conflict merge UI** — el server de sync emite `__mergedFields` cuando CRDT resuelve ediciones concurrentes; nuevo widget `conflict_merge_panel.js` muestra panel lateral con hasta 5 cards: type+ID, origin+time, diff por campo (pre-merge rojo, nuevo verde), dismiss, auto-fade 30s
- **Yjs official client** — `services/yjs_client.js` carga Yjs vía CDN, conecta a `/api/v1/crdt/ws/:notePath` (endpoint Yjs ya existente del v0.60), usa binary deltas en vez de JSON broadcast. Más eficiente para documentos con muchas ediciones concurrentes.
- **User-uploaded .glb models** — `routes/glbModels.ts` con `POST /api/v1/models/upload` (multipart 50 MB, valida magic `glTF`), `GET /api/v1/models` (built-ins + user), `DELETE` (protege built-ins con 403). `@fastify/multipart` registrado. User uploads en `public/models/user/`.
- **Pressure curve UI** — sección nueva en Settings: selector de curva (linear, soft=sqrt, firm=p², exponential), sliders (minPressure floor, tiltResponse), checkbox hover preview, **canvas en vivo** que dibuja la forma de la curva al cambiar parámetros. Persiste en `localStorage[mnexus.stylus.v1]`. `notes.js` ahora usa estas curvas configurables.

### v2.15.0 (Cellular .glb + CRDT sync + AI provider config + tilt Y + hover)

- **3 modelos .glb reales de célula** (NO huesos como pediste) — `animal_cell.glb` (106KB, 3116 verts: membrana + núcleo + nucléolo + 3 mitocondrias + RE + Golgi + citoplasma), `plant_cell.glb` (61KB, 1808 verts: pared + núcleo + vacuola + 3 cloroplastos), `bacterium.glb` (49KB, 1474 verts: cápsula + nucleoide + 5 ribosomas + plásmido). Generados con Python script propio (esfera + cilindro + torus).
- **CRDT conflict resolution** — `services/crdt.ts` con vector clocks (`compareClocks`, `clockDominates`, `bumpClock`, `joinClocks`) + field-level LWW (`mergeFields`, `shouldApply`). `sync_v2.ts` aplica CRDT en cada mensaje entrante; broadcasts llevan `__mergedFields` para que clientes vean exactamente qué ganó.
- **AI auto-tagging usa config del admin** — `aiTagger.ts` ahora usa `generateCompletion()` de `aiProviders.ts` que lee `data/ai-config.json`. Si Ollama local configurado en Settings → AI Provider, las flashcards se auto-tagean con la LLM real, sin env vars.
- **Tilt Y combinado** — `onMove()` ahora usa `Math.sqrt(tiltX² + tiltY²)/90` (vector magnitude). Stylus en diagonal reduce alpha proporcionalmente.
- **Hover preview para pen** — dibuja círculo + crosshair en el tip cuando stylus hover (no button pressed), throttled con rAF. Mouse/touch no disparan hover.

### v2.14.0 (OCR confidence + tilt opacity + OCR toast + GLB infra)

- **OCR confidence threshold** — backend corre tesseract dos veces (texto + TSV), parsea per-word confidence, frontend solo append si >= 0.3. `TESSERACT_LANGS` env var configurable (default `spa+eng`).
- **Tilt-based opacity** para pen (tilt 0..90° → alpha 1..0.5), inking shading effect natural.
- **OCR toast widget** — feedback transient 3.5s con `OCR · {source} · conf {pct}%`.
- **GLB infra** — `/models` y `/public` en PUBLIC_PATHS, headers `Content-Type: model/gltf-binary`. Bones placeholder viejos.

### v2.13.0 (Pressure-sensitive drawing + palm rejection + offline OCR)

- **Pressure-sensitive line width** — `PointerEvent.pressure × (0.5..1.5)` del base size.
- **Palm rejection** — captura-phase listener, threshold 1500 px² (iPad reports ~200 px² fingertip, ~3000 palm).
- **Offline handwriting OCR** — debounced 800ms, threshold >8 puntos, POST a `/api/v1/handwriting/recognize` (tesseract --psm 7 + lang packs). Append-only a texto capa.

### v2.12.0 (LLM auto-tagging + mobile canvas drawing + sync E2E tests)

- **LLM-powered auto-tagging** — si heurística da < 2 tags, llama `LLMService.chat()` con prompt bounded (200 tokens, 0.2 temp, JSON output). Heurística primero para ahorrar API calls.
- **Mobile canvas drawing** — narrow layout monta canvas + bottom toolbar con botones específicos (AI, PDF, New card, Search, Overview).
- **Sync E2E tests reales** — WebSocket two-client broadcast con origin exclusion, buffered receive elimina race conditions.

### v2.11.0 (AI tagger + Cloudflare Access cache + splitter hint + mobile toolbar drawer)

- **AI auto-tagging heurístico** — `services/autoTagger.ts` con diccionario Spanish/Latin anatomical + topic keywords.
- **Cloudflare Access JWT cache middleware** — `services/cloudflareAccess.ts` con cert auto-discovery, cache 5min < token lifetime 15min, RSA-SHA256 verify.
- **Splitter first-use hint** — `setTimeout` 4s + localStorage flag + CSS `.hint-pulse` 1.2s ×3 anim.
- **Mobile canvas toolbar drawer** — `transform: translateY(calc(100% + 20px))` colapsado, FAB ✏️ ↔ ✕ toggle.

### v2.10.0 (Approval→flashcard auto + occlusion persistence + GLB loader + deterministic FSRS)

- **Approve→flashcard auto-conversion** — aprobar candidato de AI lo convierte en flashcard real via `studyPlanner.ts` decide(). Fallback a file write si `createFlashcard()` no exportado.
- **Image occlusion persistence file-backed** — load on first access, debounced save 200ms. `_nextId` rehydrate via regex `occ-\d+-(\w+)`.
- **3D .glb loader** — dynamic CDN import jsdelivr/three GLTFLoader, auto-fit via Box3 → scale 2.5/maxDim.
- **FSRS day-by-day simulator deterministic** — mulberry32 PRNG cuando seed dado.

### v2.9.0 (Image occlusion UI + FSRS simulator + approval persistence)

- **Image occlusion UI** — drag-to-draw masks (5×5 / 6×6 grid + manual tags) en `occlusion_screen`.
- **FSRS day-by-day simulator REAL** — `services/fsrsSimulator.ts` con `ts-fsrs` real, no estimates.
- **Approval queue persistence** — `generationApprovals.json` con status pending/approved/rejected, atomic writes.
- **Deterministic OCR processor** — ordering estable para tests reproducibles.

### v2.8.0 (Knowledge diagnostic + exam scheduler + AI approvals + anatomy generator)

- **Knowledge diagnostic** — `knowledgeDiagnostic.computeProfile` heurística FSRS-based.
- **Exam scheduler** — `examScheduler.planStudy` greedy set-cover + horizonte deadline-aware.
- **AI approvals** — `generationApprovals` queue con review manual, no auto-commit.
- **3D anatomy generator** — 3 huesos con 14+ landmarks hotspots cada uno.

### v2.7.0 (Command palette verified + swipe nav + vault export + FSRS sim + occlusion backend)

- **Command palette verificado** — Ctrl+K ya existía desde v1.9.0, testeado con 12 actions en 5 grupos.
- **Swipe nav mobile** — edge swipe left/right cambia tab en dock.
- **Vault export** — JSON + MD per-vault, imports cross-vault.
- **Offline pill** — indicador de conexión real.
- **FSRS day-by-day simulator** — preview N días con retention graph.
- **Image occlusion CRUD backend** — masks con topic/tags + quiz mode auto-reveal.

### v2.6.0 (Production-ready + Admin auth + AI providers + Backup + Tunnel)

- **Admin auth con 90-day sessions** — bcrypt + JWT (1h access) + refresh token (90d) + auto-refresh.
- **Defense in depth** — login throttle (5/15min/IP) + lockout (10 fails → 1h) + LAN bypass.
- **Configurable AI provider** — Ollama / OpenRouter / OpenAI-compatible / mock.
- **Smart backup rotation** — daily + monthly caps + optional rclone/rsync push.
- **Cloudflare Tunnel one-command setup** — DDoS + bot filtering upstream + Access 2FA at the edge.
- **Install wizard 8 slides** (AI provider + admin + backup).
- **1000+ tests** — 834 backend + 168 frontend vitest.

### Earlier

- **v2.0–v2.5**: webview bundle, sync, exams, attachments, AI tutor, syllabus tracker, FSRS, palette, multi-vault, notes folders, security hardening, install wizard.
- **v1.0–v1.9**: vanilla JS+CSS rewrite, stylus notebook + Samsung Notes text layer, FSRS spaced repetition, 3D graph, CRDT sync, mobile audit.

---

## Features detail

### Notebook (stylus-first)

- **Canvas con PointerEvents** — pressure (lineWidth × 0.5..1.5), tiltX/Y combined magnitude (alpha 1..0.4), hover preview circle para pen
- **Palm rejection** — capture-phase listener, area > 1500 px² ignored (configurable threshold)
- **Pressure curves** — 4 perfiles (linear / soft=sqrt / firm=p² / exponential), configurables en Settings → Stylus
- **Min pressure floor** — drop presiones < umbral (sensitivity tuning)
- **Tilt response** — 0..1 slider, controla cuánto reduce alpha el tilt del stylus
- **Capa de texto** con markup: `==underline==`, `!!highlight!!`, `[[wikilink]]`, `@book/ref`, `{{c1::front::back}}`
- **Multi-page**, attachments (image/pdf/.glb)
- **Image occlusion tool** (5×5 / 6×6 grid, manual tags, quiz mode auto-reveal)
- **Audio recorder** con auto-asignación de subject
- **Wikilinks** clickables → navega a la nota por título
- **OCR handwriting** — debounced 800ms, threshold >8 puntos, tesseract PSM 7, confidence >= 0.3

### Spaced repetition (FSRS-4.5)

- 4 estados: new / learning / relearning / review
- 17 parámetros FSRS, retention target 0.9
- Learning steps (1min, 10min) con requeue hasta graduarse
- AI auto-tagging: heurístico primero, LLM (Ollama/OpenRouter) si provider configurado, max 200 tokens, JSON parse
- Day-by-day simulator: `ts-fsrs` real, deterministic con mulberry32 PRNG si seed dado

### Study sessions (modos)

| Modo | Algoritmo | Uso |
|---|---|---|
| **Study** | Greedy set-cover, 1 card/topic hasta 100% coverage | Antes del examen |
| **Exam** | Igual que Study pero requiere coverage previo | Práctica de examen |
| **Review** | FSRS spaced (difficulty × overdue × lapsed) | Repaso diario |
| **Cram** | Random shuffle del scope | Last-minute |

### Syllabus Tracker (deadline-aware)

- Definir syllabus por subject (manual o auto-extraído)
- Tracking de mastery por topic (FSRS-based)
- Status: `on-track` / `behind` / **critical** (≤3 días)
- Tips accionables: "Necesitas 3.0 rev/día; vas a 0.0"
- Proyección: dado ritmo actual, qué % cubrirás antes del examen

### AI Tutor (RAG contextual)

- FAB flotante que abre chat
- Contexto: nota actual + subject + notas relevantes (search)
- 4 quick actions: Ask / Generate 3 cards / Quiz / Summarize
- Ollama local (default `llama3.2:3b`, configurable via Settings → AI Provider)
- Fallback extractivo si Ollama no responde

### 3D Models (cell biology, anatomy, custom)

- **Built-ins**: animal_cell (106KB, 3116 verts), plant_cell (61KB), bacterium (49KB) — generadas con Python (cylinder+sphere+torus), PBR materials
- **User uploads**: drag & drop o POST `/api/v1/models/upload` — multipart 50MB, valida magic `glTF`
- **Viewer**: three.js (CDN), GLTFLoader dynamic import, auto-fit Box3, hover pin hotspots, click → navigate note anchor
- **Hotspots**: cada modelo tiene 9-14 landmarks (`Membrana plasmática`, `Mitocondria 1/2/3`, `Nucléolo`, `Reticulo endoplasmatico`, `Aparato de Golgi`, etc.)

### Graph 3D (knowledge graph)

- three.js force-directed 3D
- Nodos: notes / book refs / tags
- Edges: wikilinks (azul), book refs (naranja), tags (verde)
- Cámara orbital animada

### Sync E2E (WebSocket + CRDT — dual pipeline)

- **WebSocket** en `/ws/sync` — low-latency CRDT JSON broadcasts
- **REST** `/api/v1/sync/publish` — resilience + offline sync
- **CRDT casero** en `services/crdt.ts`: vector clocks (`{clientId: seq}`) + field-level LWW
  - Reglas: `clock dominantes` → accept, `clock dominado` → ignore, `concurrent` → merge per-field (newer fieldTs wins)
  - Server estampa `__mergedFields` en el broadcast cuando hay merge conflictivo
- **Yjs official** en `/api/v1/crdt/ws/:notePath` (binary deltas, awareness, persistence)
  - Cliente `services/yjs_client.js` carga Yjs via CDN, habla mismo protocolo binary
- **Tombstones** para deletes (GC 7 días)
- **History replay** (cap 200 msgs) + per-resource `/sync/history/:type/:id`

### Conflict merge UI (v2.16.0)

Cuando dos dispositivos editan el mismo recurso concurrentemente:
- Server aplica field-level LWW, marca campos merged con `__mergedFields`
- Cliente `sync_client.js` dispatch `sync:merged` event
- Widget `conflict_merge_panel.js` muestra panel lateral top-right con cards:
  - Type badge (note/flashcard/...) + resource ID truncado
  - Origin client (8 chars) + relative time
  - Per-field diff: prev value en rojo → new value en verde, con badge `← merged`
  - Dismiss ✕ + auto-fade 30s + Clear all
- Mobile: panel va al bottom, full-width

### Multi-vault

- 4 vaults: default / school / personal / work
- Switch con location.reload (namespace en localStorage)
- Backend tags notes con vaultId

### Other features

- **i18n**: es / en / pt (130+ strings)
- **Theme**: light / dark / auto
- **Cmd+K palette** (5 grupos: subjects/notes/flashcards/tasks/events)
- **Tags cloud** (sidebar + inline injection)
- **Drag-to-create** calendar events
- **Cross-verify** notas vs grabaciones
- **Slash commands** (`/flashcards`, `/quiz`, etc.)
- **Attachments**: image / pdf / .glb
- **Cloze test** con fuzzy match
- **Mobile-first responsive**: 360×640 / 390×844 / 720×1024

---

## Stack decisions

| Capa | Tech | Por qué |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Cero build step, stylus-first, PWA-installable |
| Backend | Fastify + TypeScript | Performance + ecosystem (websocket, multipart, static) |
| Persistence | JSON files (`backend/data/`) | Simple, debuggeable, no DB schema migrations |
| FSRS | Custom impl 17 params | State of the art spaced repetition |
| OCR | Tesseract 5 (local binary) | Offline handwriting, configurable langs |
| CRDT | Dual pipeline: casero + Yjs | JSON sync para UI events, Yjs binary para docs grandes |
| 3D | three.js (CDN) + glTFLoader | Standard Web3D, GLB binary format |
| AI | Ollama local | Sin API keys, privado |
| Build | esbuild → single bundle ~1.2 MB | Webview-ready, Capacitor/Cordova compatible |
| Tests | Vitest (backend) + vitest (frontend) + Playwright (E2E) | Fast feedback |

---

## Tests / Verification

| Source | Count | Status |
|---|---|---|
| Backend vitest | **930 tests** (77 files) | ✅ all pass |
| Frontend vitest | **255 tests** (21 files) | ✅ all pass |
| **Total automated** | **1185 tests** | ✅ all green |
| Frontend validation scripts | 315+ assertions (12 files: v12–v211) | ✅ all pass |
| E2E physical (Playwright) | 31 checks (5 user scenarios) | ✅ all pass |
| Mobile audit (Playwright) | 24 screenshots at 360/390/720 | ✅ 0 layout issues |
| **Grand total** | **~1,500 verifications** | ✅ all green |

Run locally:
```bash
cd backend && npm test                    # 930 backend
cd frontend && npm test                   # 255 frontend
node app/test/validations/validate_v211.cjs
node app/test/e2e/capture_all_mobile.cjs   # needs frontend + backend running
node app/test/e2e/e2e_physical.cjs         # needs frontend + backend running
```

---

## CI/CD

4 jobs in `.github/workflows/ci.yml`:
1. `test-backend` — `tsc --noEmit` + `vitest run`
2. `test-frontend` — runs all 21 `*.test.js` files
3. `test-e2e-mobile` — Playwright capture_all_mobile at 360/390/720 viewports
4. `test-docker` — smoke test (continue-on-error)

Release (`release.yml`):
- Detects version from `backend/package.json`
- Builds backend ZIP + webview bundle
- Creates GitHub Release with both artifacts

---

## Versions shipped

| Tag | Date | Highlights | Tests |
|---|---|---|---|
| **v2.21.1** | 2026-09-19 | Notif filter + IDB failure queue + undo/redo + conflict-merge animation | 1345 |
| **v2.21.0** | 2026-09-19 | Notif listener + external URL + share + FG service + auto-drain + sync metrics | 1306 |
| **v2.20.0** | 2026-09-19 | Clickable conflict-merge cards + native battery intent + api_base | 1266 |
| **v2.19.0** | 2026-09-19 | Device registry + Android perms + offline queue + sync replay | 1246 |
| **v2.18.0** | 2026-09-19 | Capacitor Android APK wrapper + native WebView | 1219 |
| **v2.17.0** | 2026-09-19 | Type-cleanup (32 errors → 0) | 1185 |
| **v2.16.0** | 2026-09-19 | Conflict merge UI, Yjs official, .glb upload, Pressure curves | 1185 |
| **v2.15.0** | 2026-09-19 | Cellular .glb models, CRDT sync, AI provider config, tilt Y | 1157 |
| **v2.14.0** | 2026-09-19 | OCR confidence, tilt opacity, OCR toast, GLB infra | 1132 |
| **v2.13.0** | 2026-09-19 | Pressure drawing, palm rejection, offline OCR | 1110 |
| **v2.12.0** | 2026-09-19 | LLM auto-tagging, mobile canvas, sync E2E | 1080 |
| **v2.11.0** | 2026-09-19 | AI tagger, CF Access cache, splitter hint, mobile toolbar | 1060 |
| **v2.10.0** | 2026-09-19 | Approval→flashcard, occlusion persistence, GLB loader, FSRS det. | 1030 |
| **v2.9.1** | 2026-09-19 | 36 screenshots showcase, 3D viewer modal fix | 990 |
| **v2.9.0** | 2026-09-19 | Image occlusion UI, FSRS simulator, approval persistence | 990 |
| **v2.8.0** | 2026-09-19 | Knowledge diagnostic, exam scheduler, AI approvals, anatomy | 970 |
| **v2.7.0** | 2026-09-19 | Cmd-K verified, swipe nav, vault export, FSRS sim, occlusion backend | 940 |
| **v2.6.0** | 2026-09-19 | Production-ready, admin auth, AI providers, backup, tunnel | 1000+ |
| **v2.5.0** | 2026 | UI decluttering, notes folders | ~900 |
| **v2.4.0** | 2026 | Adaptive UI per viewport | ~850 |
| **v2.3.0** | 2026 | UI decluttering, Notes folders hierarchical tree | ~796 |

---

## Roadmap

✅ **Done (v1.0 → v2.16)**: see versions table above.

🔜 **Next (v2.17 candidates)**:
- Clickable merge cards (navigate to merged resource from panel)
- Drag & drop .glb upload UI (frontend, not curl)
- Yjs awareness cursors (see where other users are typing in notes)
- Per-field undo/redo using the CRDT state

---

## Documentation

- **[CHANGELOG.md](CHANGELOG.md)** — Full release history (v1.0.0 → v2.16.0)
- **[AUDIT_REPORT.md](AUDIT_REPORT.md)** — Complete code audit
- **[CHECKLIST.md](CHECKLIST.md)** — Audit checklist with deferred items
- **[VISUAL_AUDIT.md](VISUAL_AUDIT.md)** — Mobile/tablet responsive audit
- **[docs/API.md](docs/API.md)** — 52 REST endpoints
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Data flows + layers
- **[docs/ERROR_CODES.md](docs/ERROR_CODES.md)** — 26 error categories
- **[docs/LOGGING.md](docs/LOGGING.md)** — Pino + console helpers
- **[docs/BACKEND_ONLY_FEATURES.md](docs/BACKEND_ONLY_FEATURES.md)** — API-only features
- **[docs/AUTH.md](docs/AUTH.md)** — Authentication, JWT, device management
- **[docs/BACKUP.md](docs/BACKUP.md)** — Auto-backup with rotation
- **[docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md)** — Ollama / OpenRouter / OpenAI / mock
- **[docs/CLOUDFLARE_TUNNEL.md](docs/CLOUDFLARE_TUNNEL.md)** — One-command tunnel
- **[docs/SECURITY.md](docs/SECURITY.md)** — Security posture

## License

Privada — © 2026 M-NEXUS
