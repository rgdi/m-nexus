# M-NEXUS — Education Service (v2.1.4)

> **Tablet-first** Education Service for medical students.
> Notebook (stylus), calendar, subjects, to-do's, AI tutor, **spaced repetition (FSRS-4.5)**, **syllabus tracker**, **3D knowledge graph**.
> Vanilla JS frontend + Fastify backend. Local-first.

---

## ¿Qué es M-NEXUS?

Una **plataforma de conocimiento académico** centrada en el estudiante de medicina. La promesa: **llegar al examen habiendo cubierto el 100% del temario**.

Combina:
- **Notebook stylus-first** con capa de texto (Samsung Notes style) — `[[wikilinks]]`, `{{c1::cloze::answer}}`, `@book/ref`
- **Flashcards con FSRS-4.5** (4 estados: new / learning / relearning / review)
- **Syllabus Tracker** deadline-aware: te dice si vas a llegar al 100% antes del examen
- **AI Tutor contextual** (RAG sobre tus propias notas)
- **Graph 3D** de conexiones entre notas
- **Sync E2E** vía WebSocket + REST (CRDT LWW + tombstones)
- **Webview bundle** 687 KB autocontenido (funciona en Capacitor/Cordova/WebView nativo)

---

## Quick start

```bash
# Backend
cd backend
npm ci
npm run dev          # http://localhost:4100
npm test             # 796 tests (vitest)

# Frontend (vanilla JS, sin build step)
cd frontend/public
python3 -m http.server 8080
# Open http://localhost:8080

# Webview bundle (single-file, 687 KB)
bash scripts/build_webview.sh /tmp/mnexus-bundle
```

Si el backend no responde, el frontend funciona **offline** con `localStorage` y datos demo.

---

## Estructura del repo

```
m-nexus/
├── frontend/                          ← Vanilla HTML/CSS/JS (44 archivos, 8.5 KB LOC)
│   ├── public/
│   │   ├── index.html                 entry point + dock bottom
│   │   ├── manifest.json              PWA manifest
│   │   └── favicon.svg
│   └── src/
│       ├── main.js                    router, bootstrap, theme, cmd-palette, sync
│       ├── styles/                    tokens, base, layout, components, calendar, notebook
│       ├── screens/                   overview, calendar, subjects, notes, todos, ai
│       ├── services/                  api, store, dataSource, i18n, fsrs, exams,
│       │                              syllabus, crdt, sync_client, theme, vault, device
│       └── widgets/                   23 widgets (study_session, cloze_test,
│                                      command_palette, file_attachments, ai_tutor,
│                                      graph_3d, syllabus_dashboard, etc.)
│
├── backend/                           ← Node.js + Fastify + SQLite (45 routes, 19 KB LOC)
│   ├── src/
│   │   ├── server.ts                  buildServer() + register all routes + middleware
│   │   ├── routes/                    46 routes (subjects, notes, flashcards, ai,
│   │   │                              auth, backup, ocr, pdf, sync_v2, ws, update…)
│   │   ├── services/                  45 services (FSRS, LLM, RAG, search, devices…)
│   │   ├── middleware/                auth, csp, rate limit
│   │   ├── auth/                      JWT, devices, audit
│   │   └── utils/                     log (pino), errorCodes (AppError), safeCall
│   ├── tests/                         67 files, 796 tests
│   └── data/                          JSON persistence
│
├── scripts/
│   ├── start_backend.sh                dev runner (port 4100)
│   ├── start_frontend.sh               dev runner (port 8080)
│   └── build_webview.sh                single-file bundle (687 KB)
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

## Features (v2.1.4)

### Notebook (stylus + Samsung Notes layer)

- Canvas con PointerEvents (pressure + tilt) — pencil, highlighter, eraser, ruler, select
- **Capa de texto** con markup: `==underline==`, `!!highlight!!`, `[[wikilink]]`, `@book/ref`, `{{c1::front::back}}`
- Multi-page, intelligent overview modal, attachments (image/pdf/.glb)
- Image occlusion tool (5×5 / 6×6 grid, manual tags, **quiz mode con auto-reveal**)
- Audio recorder con auto-asignación de subject
- Wikilinks clickables → navega a la nota por título
- PDF export (texto + strokes vectoriales + flashcards embebidas)

### Spaced repetition (FSRS-4.5)

- 4 estados: new / learning / relearning / review
- Learning steps (1min, 10min) con **requeue** hasta graduarse
- `Hard` en `new` retorna `learning` (no new)
- `Again` decrementa stability con cap `min(raw, s*0.9, max(0.5, s-0.5))`
- 17 parámetros FSRS, retention target 0.9

### Study sessions (modos)

| Modo | Algoritmo | Uso |
|---|---|---|
| **Study** | Greedy set-cover. Para cada topic añade al menos 1 card no cubierta hasta 100% coverage | Antes del examen |
| **Exam** | Igual que Study pero requiere 100% coverage previo | Práctica de examen |
| **Review** | Spaced repetition (difficulty × overdue × lapsed) | Repaso diario |
| **Cram** | Random shuffle del scope | Last-minute |

### Syllabus Tracker (deadline-aware)

- Definir syllabus por subject (manual o auto-extraído de notas)
- Tracking de mastery por topic (FSRS-based)
- Status: `on-track` / `behind` / **critical** (≤3 días al examen)
- Tips accionables: "Necesitas 3.0 rev/día; vas a 0.0"
- Proyección: dado tu ritmo actual, ¿qué % cubrirás antes del examen?

### AI Tutor (RAG contextual)

- FAB flotante que abre chat
- Contexto: nota actual + subject + notas relevantes (search)
- 4 quick actions: Ask / Generate 3 cards / Quiz / Summarize
- Ollama local (default `llama3.2:3b`, configurable)
- Fallback extractivo si Ollama no responde

### Graph 3D (knowledge graph)

- three.js force-directed 3D
- Nodos: notes / book refs / tags
- Edges: wikilinks (azul), book refs (naranja), tags (verde)
- Cámara orbital animada

### Sync E2E (WebSocket + CRDT)

- WebSocket en `/ws/sync` (low-latency broadcasts)
- REST en `/api/v1/sync/publish` (resilience)
- **CRDT LWW** (Last-Writer-Wins) por recurso con vector clocks
- Tombstones para deletes (GC 7 días)
- History replay para late joiners (cap 200 msgs)

### Multi-vault

- 4 vaults: default / school / personal / work
- Switch con location.reload (namespace en localStorage)
- Backend tags notes con vaultId

### Other features

- **i18n**: es / en / pt (130+ strings)
- **Theme**: light / dark / auto
- **Vault switcher** + **Cmd+K palette** (5 grupos: subjects/notes/flashcards/tasks/events)
- **Tags cloud** (sidebar + inline injection)
- **Drag-to-create** calendar events
- **Calendar event detail modal** (single click) + edit (double click)
- **Cross-verify** notas vs grabaciones (minute-precise + book-refs multi-parte)
- **Slash commands**: `/flashcards` (popup en text-layer)
- **Attachments**: image (preview) / pdf (preview) / .glb (3D)
- **Cloze test**: open cloze deletion con fuzzy match
- **AI submenu**: extract flashcards / summarize / define / quiz
- **Mobile-first responsive**: 360×640 / 390×844 / 720×1024 (24 screenshots, 0 issues)

---

## Stack decisions

| Capa | Tech | Por qué |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Cero build step, stylus-first, PWA-installable |
| Backend | Fastify + TypeScript | Performance + ecosystem (websocket plugins) |
| Persistence | JSON files (`backend/data/`) | Simple, debuggeable, no DB schema migrations |
| FSRS | Custom impl 17 params | State of the art spaced repetition |
| AI | Ollama local | Sin API keys, privado |
| Build | esbuild → single bundle 687 KB | Webview-ready, Capacitor/Cordova compatible |
| Tests | Vitest (backend) + Node scripts (frontend) + Playwright (E2E) | Fast feedback, no Flutter |

---

## Tests / Verification

| Source | Count | Status |
|---|---|---|
| Backend vitest | **796 tests** (67 files) | ✅ all pass |
| Frontend validation scripts | **315+ assertions** (12 files: v12–v211) | ✅ all pass |
| E2E physical (Playwright) | **31 checks** (5 user scenarios) | ✅ all pass |
| Mobile audit (Playwright) | **24 screenshots** at 360/390/720 | ✅ 0 layout issues |
| **Total** | **~1,170 verifications** | ✅ all green |

Run locally:
```bash
cd backend && npm test                    # 796 backend
node app/test/validations/validate_v211.cjs
node app/test/validations/validate_v21.cjs
node app/test/e2e/capture_all_mobile.cjs   # needs frontend + backend running
node app/test/e2e/e2e_physical.cjs         # needs frontend + backend running
```

---

## CI/CD

4 jobs in `.github/workflows/ci.yml`:
1. `test-backend` — `tsc --noEmit` + `vitest run`
2. `test-frontend` — runs all 12 `validate_*.cjs`
3. `test-e2e-mobile` — Playwright capture_all_mobile at 360/390/720 viewports
4. `test-docker` — smoke test (continue-on-error)

Release (`release.yml`):
- Detects version from `backend/package.json`
- Builds backend ZIP + webview bundle
- Creates GitHub Release with both artifacts

---

## Roadmap

✅ **Done (v1.0 → v2.1)**:
- Stylus notebook + Samsung Notes text layer
- FSRS spaced repetition (4 states)
- Syllabus tracker (deadline-aware)
- 3D knowledge graph
- CRDT sync (LWW + tombstones)
- Webview bundle (Capacitor/Cordova-ready)
- Mobile audit + responsive layout fixes
- 796 backend tests green

🔜 **Next**:
- Real JWT auth (Bearer in frontend api.js) → un-protect legacy routes
- OCR frontend integration (already in backend)
- LLM multi-model (Anthropic, OpenAI, OpenRouter)
- PDF diff (visual side-by-side)
- Multi-language docs

---

## License

Privada — © 2026 M-NEXUS
