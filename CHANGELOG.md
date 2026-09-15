# CHANGELOG — M-NEXUS

> Historial completo de versiones. Stack actual: **TypeScript backend (Fastify + SQLite) + Vanilla JS+CSS frontend**. Sin Flutter.

---

## v2.1.5 (2026-09-15) — One-line installer + setup wizard + security audit

### Nuevas features

- **`install/install.sh`** — instalación con una sola línea:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash
  ```
  Auto-detecta OS (Linux/macOS) + pkg manager (apt/dnf/yum/apk/brew), instala Node 22 si falta, descarga el último release, crea CLI helper `mnexus`, opcionalmente instala systemd unit.
  
  Opciones: `--port`, `--data`, `--no-systemd`, `--update`, `--help`.
  
- **`frontend/src/widgets/setup_wizard.js`** — onboarding slideshow de 6 slides:
  1. Welcome (hero + iconos)
  2. Pick vault (4 opciones: default / school / personal / work)
  3. Add first subject (chips + custom)
  4. Notebook tips (`{{c1::}}`, `[[]]`, `@book/ref`)
  5. Flashcards con FSRS (4 study modes)
  6. Done — open dashboard

  Auto-launch en first-run, "Re-run setup wizard" desde drawer del hamburger.

- **Documentation update completo**: README + API.md + ARCHITECTURE.md + ERROR_CODES.md + LOGGING.md + BACKEND_ONLY_FEATURES.md.

- **`AUDIT_REPORT.md`** — auditoría completa del código: 22 hallazgos, 19 fixes aplicados, 9 work items pendientes.

### Security fixes (audit)

- **`install/install.sh`**: genera `JWT_SECRET=$(openssl rand -hex 32)` automáticamente.
- **`scripts/start_backend.sh`**: lee `.env` o genera JWT_SECRET y persiste.
- **`docker-compose.yml`**: `${JWT_SECRET:?...}` (falla si no está seteada, en lugar de usar `change-me`).
- **`frontend/src/services/api.js`**: API_BASE usa `localhost`/`127.0.0.1` explícito, same-origin en prod.

### Verificación

- ✅ 796/796 backend tests verde (1 skipped)
- ✅ 8 wizard screenshots
- ✅ Wizard on first-run / persisted via localStorage
- ✅ install.sh syntax OK + --help funcional
- ✅ Bundle: 753 KB / 51 files

---

## v2.1.4 (2026-09-15) — CI overhaul + 796 backend tests green

**Problema:** CI corría tests legacy que fallaban silenciosamente. 6 archivos vitest rojos, 46 failures.

### Fixes

- **server.ts**: alias `buildApp = buildServer` para tests
- **server.ts**: registra todos los routes (aiRoutes, authRoutes, backupRoutes, updateRoutes, wsRoutes, audioRoutes, llmRoutes, ocrRoutes, dashboardRoutes, pdfRoutes)
- **server.ts**: registra `authMiddleware` como `preHandler` global
- **server.ts**: añade `addContentTypeParser` para `application/zip` y `octet-stream`
- **server.ts**: custom `setErrorHandler` que mapea AppError fields a `body.error`
- **middleware/auth.ts**: PUBLIC_PATHS cleanup (sin trailing slash duplicado)
- **routes/auth.ts**: registra `GET /api/v1/devices`
- **routes/flashcards.ts**: añade `POST /api/v1/flashcards/generate` (mock)
- **TypeScript module augmentation**: cast explícito `(req as any).auth = payload`

### CI workflow updates

- **ci.yml**: 4 jobs (test-backend, test-frontend, test-e2e-mobile, test-docker)
- **release.yml**: lee versión de `backend/package.json`, build webview bundle en lugar de Flutter APK
- Removed `debug-apk.yml` (no Flutter)
- `.gitignore`: añadido `*.db-shm`, `*.db-wal`, `*.db`

### Verificación

- ✅ **796 backend tests pass** (1 skipped, 0 fail)
- ✅ `tsc --noEmit` clean

---

## v2.1.3 (2026-09-15) — Mobile audit & optimization

- Audit de 7 pantallas × 3 viewports (360/390/720) = **24 screenshots**
- 9 issues encontrados, todos corregidos:
  - Títulos cortados detrás del top-bar fixed
  - Top-bar saturada (cmd-trigger y vault-switcher colapsan a icon-only)
  - AI tutor FAB solapaba el botón "Send" → ocultar FAB cuando `body.route-ai` o `ai-chat-open`
  - Subject cards demasiado altas en 2-col móvil (96px min)
  - Day/Week toggle compactado
  - Task chips overflow → movidos bajo el título con `flex-wrap`
  - Todo checkbox muy pequeño → 32×32 con 44px hit-target
  - Icon buttons encogidos por flex parent → `flex-shrink: 0`
  - Padding-top `.app` con media query movido al final del archivo (override del `@supports safe-area`)

**Verificación**: 0 issues en los 3 viewports × 7 vistas.

---

## v2.1.2 (2026-09-15) — E2E physical test suite

Script `app/test/e2e/e2e_physical.cjs` con 31 checks que simulan acciones de usuario físico (Playwright clicks/teclas):

- **TEST 1**: Desktop 1280×800 — crear nota con `{{c1::}}`, `[[]]`, `@book/ref` → AI menu → extract flashcards → AI tutor → syllabus dashboard → study wizard → rate cards → FSRS persiste
- **TEST 2**: Mobile 360×640 — hamburger drawer, no overflow
- **TEST 3**: Tablet 720×1024 — dashboard responsive
- **TEST 4**: Stress (50 notes + 200 flashcards) — Cmd+K palette, study wizard maneja el volumen
- **TEST 5**: UI polish — theme toggle bottom-right

**31/31 verde, 22 screenshots.**

---

## v2.1.1 (2026-09-15) — Syllabus Tracker (deadline-aware)

`services/syllabus.js` + `widgets/syllabus_dashboard.js`:

- Definir syllabus por subject (manual o auto-extraído de notas)
- Mastery tracking por topic (FSRS-based)
- `studyPlan(subjectId)` calcula:
  - Days left, topics left, reviews/day
  - Required pace vs current pace
  - **Projected coverage** al deadline
  - Status: `on-track` / `behind` / **critical**
  - Tips accionables

UI muestra countdown, progress bar, gap chips. Botón "📖 Estudiar gaps" abre session STUDY mode en el subject.

---

## v2.1.0 (2026-09-15) — Study mode sweeps entire syllabus

`services/exams.js` rediseñado para que el modo **Study** recorra todos los topics empezando por los no cubiertos (greedy set-cover). Wizard de 4 modos: `study` / `exam` / `review` / `cram`. Summary final muestra coverage y tips.

---

## v2.0.6 — E2E sync (WebSocket + REST)

- `backend/src/routes/sync_v2.ts`: WebSocket en `/ws/sync` + REST `/api/v1/sync/publish` + history replay
- `frontend/src/services/sync_client.js`: auto-reconnect 3s, dual-channel publish, listener registry

## v2.0.5 — Smart exams

`services/exams.js` + `widgets/exam_runner.js`: scoring `0.4*diff + 0.3*overdue + 0.3*(1-lapsedBoost)`, anti-repeat, wizard 2-step, Anki-style session.

## v2.0.4 — Manual image occlusion

## v2.0.3 — `/flashcards` slash command

## v2.0.2 — AI Tutor contextual (FAB)

## v2.0.1 — File attachments + image occlusion tool

## v2.0.0 — Webview bundle (single-file 612 KB)

`scripts/build_webview.sh` produce bundle autocontenido (HTML+CSS+JS) compatible con Capacitor/Cordova/WebView nativo. ServiceWorker offline.

---

## v1.9.3 — Multi-vault (default/school/personal/work)

`services/vault.js`: 4 vaults con `vaultPrefix()` namespace en localStorage. Switch → location.reload.

## v1.9.2 — Calendar drag-to-create events

## v1.9.1 — Tags cloud (#tag sidebar)

## v1.9.0 — Command palette (Cmd+K)

`widgets/command_palette.js`: Spotlight-style con 5 grupos (Subjects/Notes/Flashcards/Tasks/Events). Pre-fetch paralelo, ↑↓ navigate, ↵ open, Esc close.

---

## v1.8.3 — Small-screen regression tests (360/390/720)

## v1.8.2 — Cloze deletion test

`widgets/cloze_test.js`: Open cloze `{{c1::pregunta::respuesta}}`. Fuzzy match. Auto-advance 1.2s/2s.

## v1.8.1 — Bug fixes (setupAIMenu listener, FSRS)

## v1.8.0 — FSRS Anki-grade requeue

`services/fsrs.js` (4 estados new/learning/relearning/review). Learning steps (1min/10min) con REQUEUE_MAX=3. Hard on new returns state=learning; Again on review siempre decrementa stability.

---

## v1.7.3 — PDF export (minimal, no jsPDF)

`widgets/pdf_export.js`: A4, Helvetica, multi-page, strokes vectoriales como paths.

## v1.7.2 — Calendar event detail modal

## v1.7.1 — Dark mode manual toggle

## v1.7.0 — FSRS study mode (Anki-style)

`widgets/study_session.js`: 3D card flip (rotateY 180deg), 4 ratings Again/Hard/Good/Easy, keyboard shortcuts.

---

## v1.6.3 — Book refs multi-parte + highlight pulse

## v1.6.2 — Cross-verify minute-precise (Apple Music-style)

## v1.6.1 — AI submenu (sparkles) — extract flashcards, summarize, define, quiz

## v1.6.0 — SF Symbols-style SVG icons

30+ paths en `widgets/icons.js`, stroke 1.8, currentColor.

---

## v1.5.6 — Wikilinks + book-refs + cross-verify panel

`widgets/cross_verify_panel.js`: minute-precise (`mm:ss`) + `bookRef` + `jumpUrl` Apple Music-style. Mini-audio player en notebook.

## v1.5.5 — Wikilinks click → buscar nota por título

## v1.5.4 — Audio recorder (`MediaRecorder API`) + auto-transcribe stub

## v1.5.3 — 3D viewer (`widgets/three_d_viewer.js` con three.js CDN)

## v1.5.2 — Flashcards CRUD + extract from `{{c1::...::...}}`

## v1.5.1 — Samsung Notes editor (text-layer)

Markup: `==underline==`, `!!highlight!!`, `[[wikilink]]`, `@book/ref`, `{{c1::front::back}}`. Drawing sobre canvas encima del text-layer.

---

## v1.4.0 — Polish (splash + per-screen bg + top toolbar)

- `widgets/splash.js`: "Education Service / always at hand" con animated blobs (8s/10s ease-in-out)
- Per-screen colored backgrounds (overview light blue, notes lime `#f6f8aa`)
- `widgets/top_toolbar.js`: undo/redo/bg-fill/hide-UI top-right
- `body.hide-ui` oculta dock + lang-switcher + toolbar
- `body.no-bg` quita el background fill
- Hamburger drawer para mobile

---

## v1.3.1 — Definition popup

Long-press 600ms en canvas → popup flotante con Word + IPA + syllable + frequency + pronunciation.

## v1.3.0 — i18n es/en/pt

`services/i18n.js` 240 líneas, 130+ strings. `widgets/lang_switcher.js` floating button + menu. Auto-detect via `navigator.language`.

## v1.2.0 — Responsive + adaptive

7 breakpoints, `clamp()` typography, container queries, safe area, touch targets 44-48px / mouse 32-38px.

## v1.1.0 — Backend connected

`/subjects`, `/notes`, `/events`, `/tasks` con persistencia JSON. `dataSource.js` abstraction API/localStorage.

## v1.0.0 — RESET

- Flutter borrado (153 archivos Dart)
- 72 tags históricos eliminados
- Frontend nuevo (vanilla HTML/CSS/JS, 21 archivos, ~3000 LOC)
- Education Service style (subject bubbles + glass dock bottom)
- Tablet-first responsive
- Stylus canvas (PointerEvents + pressure + tilt)
- Multiple pencils + insert toolbar
- Intelligent overview modal
- Offline-first (localStorage fallback)

---

## Métricas acumuladas

| Source | Total |
|---|---|
| Backend vitest tests | **796** (65 files) |
| Frontend validation assertions | **315+** (12 files) |
| E2E physical checks | **31** |
| Mobile screenshots | **24** (3 viewports × 7 vistas) |
| Playwright screenshots | **56+** |
| Git tags | **15** (v1.0.0 → v2.1.5) |
| Backend LOC (TS) | **~21,000** |
| Frontend LOC (JS) | **~9,000** |
| Audit findings | **22** (2 critical, 6 high, 10 medium, 4 low) |
| Audit fixes applied | **19** |
| Audit work items | **9** (deferred to v2.2.x / v3.0) |
| Tests / Production ratio | **~1:1** |

**Total verifications: ~1,180 verde.**

---

## Documentación

| Archivo | Propósito |
|---|---|
| `README.md` | Quick start, install (curl \| bash), dev setup, features |
| `CHANGELOG.md` | Este archivo — historial completo |
| `AUDIT_REPORT.md` | Auditoría completa (security + quality + perf) |
| `docs/API.md` | 46 rutas REST con ejemplos |
| `docs/ARCHITECTURE.md` | Data flows + capas (Fastify → SQLite + vanilla JS frontend) |
| `docs/ERROR_CODES.md` | 26 categorías (EC-AUTH-*, EC-VAL-*, EC-CRDT-*, ...) |
| `docs/LOGGING.md` | Pino + console helpers |
| `docs/BACKEND_ONLY_FEATURES.md` | Features solo-API (no necesitan frontend) |
| `app/test/validations/validate_v*.cjs` | Smoke tests sin red (~315 assertions) |
| `app/test/e2e/*.cjs` | Playwright E2E + mobile audit |
