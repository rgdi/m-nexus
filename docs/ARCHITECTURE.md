# M-NEXUS Architecture (v2.1.4)

## High-level

```
┌──────────────────────────────────────────────────────────────────┐
│                          User devices                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐            │
│  │Browser  │ │Tableta  │ │Mobile   │ │WebView/Capacitor│         │
│  └────┬────┘ └────┬────┘ └────┬────┘ └──────┬───────┘            │
└───────┼───────────┼───────────┼──────────────┼────────────────────┘
        └───────────┴───────────┴──────────────┘
                          │ HTTPS
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Nginx reverse proxy                         │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Backend (Fastify + TS)                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│  │ HTTP /api/v1│  │ WS /ws/sync │  │ Static /    │                 │
│  │ REST routes │  │ CRDT sync  │  │ webview-bundle│               │
│  └────────────┘  └────────────┘  └────────────┘                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ Auth middleware (JWT, devices, audit)                  │       │
│  ├──────────────────────────────────────────────────────┤       │
│  │ 46 routes / 45 services / 11 utils                    │       │
│  ├──────────────────────────────────────────────────────┤       │
│  │ External: Ollama (LLM), Whisper (audio), Tesseract   │       │
│  └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│              Storage: JSON files in `backend/data/`            │
│  subjects.json, notes.json, events.json, tasks.json,            │
│  flashcards.json, recordings.json, cross_verify.json,            │
│  studynotes.json                                                │
└──────────────────────────────────────────────────────────────────┘
```

## Frontend architecture

```
frontend/src/
├── main.js                    router + bootstrap
│   - parseHash() → route
│   - render() → dispatch to screen
│   - mountThemeToggle() / mountLangSwitcher() / mountAITutor() / mountCmdTrigger() / mountVaultSwitcher()
│
├── styles/
│   ├── tokens.css            fluid typography, colors, spacing, hit-target sizes
│   ├── base.css              pointer/hover/DPI/touch adaptations
│   ├── layout.css            orientation + container queries + safe area
│   ├── components.css        dock, lang-switcher, theme-toggle, hamburger,
│   │                          cmd-trigger, vault-switcher, ai-menu, fc-panel,
│   │                          mini-audio, cv-panel, tags-bar, vault-menu
│   ├── calendar.css          day/week grid + drag-create
│   └── notebook.css          canvas, text-layer, pencil drawer, occlusion
│
├── services/
│   ├── api.js                 HTTP client (`/api/v1` prefix)
│   ├── store.js               localStorage wrapper + collection() helper
│   ├── demoSeed.js            sembrado offline
│   ├── dataSource.js          abstraction API/localStorage with `detectBackend()`
│   ├── device.js              runtime device tier detection
│   ├── i18n.js                130+ strings es/en/pt
│   ├── theme.js               light/dark/auto (localStorage)
│   ├── fsrs.js                FSRS-4.5 spaced repetition (17 params)
│   ├── exams.js               study/exam/review/cram sessions
│   ├── syllabus.js            deadline-aware syllabus tracker
│   ├── vault.js               4 vaults (default/school/personal/work)
│   ├── crdt.js                LWW + vector clocks + tombstones
│   └── sync_client.js         WebSocket sync client + REST fallback
│
├── widgets/                    (23 files)
│   ├── icons.js                30+ SF Symbols-style SVG paths
│   ├── lang_switcher.js        floating language button
│   ├── splash.js               "Education Service / always at hand"
│   ├── top_toolbar.js          undo/redo/bg-fill/hide-UI top-right
│   ├── three_d_viewer.js       3D viewer (.glb) with hotspots/billboard/callouts
│   ├── audio_recorder.js       MediaRecorder + auto subject
│   ├── pdf_export.js           minimal PDF builder (no jsPDF)
│   ├── study_session.js        Anki-style FSRS session with 3D flip
│   ├── cloze_test.js           open cloze deletion with fuzzy match
│   ├── command_palette.js      Cmd+K Spotlight-style
│   ├── cross_verify_panel.js   minute-precise + book-refs
│   ├── file_attachments.js     image/pdf/.glb + image occlusion
│   ├── ai_tutor.js             contextual chat FAB
│   ├── flashcard_slash.js      /flashcards slash command popup
│   ├── exam_runner.js          wizard + Anki session
│   ├── graph_3d.js             force-directed 3D knowledge graph
│   ├── tags_cloud.js           #tag sidebar
│   ├── syllabus_dashboard.js  per-subject countdown + tips
│   └── (others)
│
└── screens/                    (6 files)
    ├── overview.js              landing with events + subjects + stats
    ├── calendar.js              day/week + create event modal + drag-create
    ├── subjects.js              bubbles + detail with grades
    ├── notes.js                 notebook + text-layer + FSRS + cloze + AI + attachments
    ├── todos.js                 to-do list with priority + due dates + chips
    └── ai.js                    AI tutor chat
```

## Backend architecture

```
backend/src/
├── server.ts                  buildServer() + register all routes + middleware
│                              + custom setErrorHandler (AppError → body)
│                              + addContentTypeParser (zip, octet-stream)
│                              + addHook("preHandler", authMiddleware)
│
├── routes/                     (46 files)
│   ├── auth.ts                  /register, /auth/refresh, /auth/revoke, /audit
│   ├── subjects.ts              CRUD subjects
│   ├── notes.ts                 CRUD notes + extract-flashcards
│   ├── events.ts                CRUD events
│   ├── tasks.ts                 CRUD tasks + toggle
│   ├── recordings.ts            CRUD recordings
│   ├── flashcards.ts            CRUD flashcards + generate (mock)
│   ├── ai.ts                    /ai/* (vault eval, quiz, proposals, knowledge)
│   ├── ai_v2.ts                 /ai/chat, /ai/embeddings, /ai/rag-search
│   ├── llm.ts                   /llm/chat, /llm/embed (multi-provider)
│   ├── ocr.ts                   /ocr/image
│   ├── audio.ts                 /audio/transcribe + /audio/transcribe/stream
│   ├── transcriptionStream.ts   WebSocket audio transcription
│   ├── pdf.ts                   /pdf/diff
│   ├── handwriting.ts           handwriting/recognize
│   ├── cross_verify.ts          coverage between notes and recordings
│   ├── fsrsQueue.ts             FSRS queue (async spaced repetition)
│   ├── sync.ts                  legacy sync
│   ├── sync_v2.ts               WebSocket /ws/sync + REST /sync/*
│   ├── ws.ts                    WebSocket routes
│   ├── push.ts                  push notifications
│   ├── backup.ts                /backup/* (ZIP)
│   ├── update.ts                /update (GitHub Releases)
│   ├── secrets.ts               /secrets (AES-256-GCM)
│   ├── themes.ts                /themes (CSS themes)
│   ├── dashboard.ts             /stats + /devices
│   ├── import.ts                /import/* (HTML/MD/Notion)
│   ├── search.ts                /search (FTS5)
│   ├── stemmer.ts               /stemmer (ES/EN)
│   ├── structured.ts            structuredDatabases
│   ├── structuredDatabases.ts   /databases
│   ├── structuredRows.ts        /structured/rows
│   ├── structuredViews.ts       /structured/views
│   ├── marketplaceSqlite.ts     marketplace
│   ├── marketplaceReal.ts       marketplace real
│   ├── keyExchange.ts           E2E key exchange
│   ├── clip.ts                  web clipper
│   ├── ocr.ts                   OCR
│   ├── metrics.ts               Prometheus
│   ├── health.ts                /health
│   └── (others)
│
├── services/                   (45 files)
│   ├── fsrs.ts                  FSRS algorithm
│   ├── llm.ts                   LLM providers (Ollama/OpenRouter/etc.)
│   ├── embeddings.ts            embeddings
│   ├── rag.ts                   RAG over notes
│   ├── ocr.ts                   OCR service
│   ├── whisper.ts               Whisper transcription
│   ├── searchService.ts         FTS5 search
│   ├── devices.ts               device registry
│   ├── jwt.ts                   JWT signing/verification
│   ├── audit.ts                 audit log
│   ├── updateChecker.ts         check for updates
│   ├── updateApply.ts           apply updates
│   └── (others)
│
├── middleware/
│   ├── auth.ts                  JWT validation (PUBLIC_PATHS)
│   ├── cspHeaders.ts            Content-Security-Policy
│   └── perUserRateLimit.ts      rate limit
│
├── auth/
│   ├── jwt.ts                   JWT utils
│   ├── devices.ts               device registry (Map)
│   └── audit.ts                 audit log
│
├── utils/                      (11 files)
│   ├── log.ts                   pino logger + logOp/logError/logLifecycle
│   ├── errorCodes.ts            E.{auth,val,llm,...} helpers + AppError
│   ├── safeCall.ts              safeCall + safeCallAsync wrappers
│   ├── corsPolicy.ts            CORS allowed origins
│   ├── pathValidation.ts        path traversal protection
│   ├── updateChecker.ts         GitHub releases check
│   ├── updateApply.ts           apply update flow
│   ├── wormAudit.ts             worm-style audit
│   ├── metrics.ts               metrics helpers
│   ├── i18n.ts                  i18n backend
│   └── wormAudit.ts
│
├── cli.ts                       CLI entry
├── config.ts                    config (env vars)
├── version.ts                   VERSION constant
└── server.ts                    entrypoint
```

## Data flow: user creates note

```
User clicks "+" in notes list
   │
   ▼
dataSource.notes.create(input)
   │
   ├─→ detectBackend() → true (localhost origin)
   │
   ▼
api.notes.create(input) → POST /api/v1/notes
   │
   ▼
Backend notesRoutes POST /notes handler
   │
   ├─→ authMiddleware (PUBLIC because /notes is legacy)
   │
   ▼
notes.create(note)
   │
   ├─→ Save to data/notes.json
   │
   ▼
Return { id, ...note }
   │
   ▼
dataSource: col.create() mirrors locally
   │
   ▼
Frontend: location.hash = `#/notes?id=${id}`
   │
   ▼
renderNotes → renderNotebook
   │
   ├─→ fetch note body
   ├─→ renderTextLayer (clozes, wikilinks, bookrefs)
   ├─→ canvas for drawing
   │
   ▼
AI menu: extract flashcards → POST /notes/:id/extract-flashcards
   │
   ▼
Backend parses {{c1::...}} → flashcards
   │
   ▼
Frontend shows flashcard popup
```

## Sync flow (CRDT)

```
Device A makes change
   │
   ▼
publishChange(type, op, resourceId, data)
   │
   ├─→ crdt.lwwWrite() persists locally with vector clock
   │
   ├─→ ws.send() over WebSocket
   └─→ fetch POST /api/v1/sync/publish (REST)
   │
   ▼
Backend syncV2Routes
   │
   ├─→ Stores in history (cap 200)
   └─→ Broadcasts to all connected WS clients
   │
   ▼
Device B receives WS message
   │
   ▼
sync_client.applyRemoteChange(msg)
   │
   ├─→ crdt.lwwMerge(key, entry) — newer timestamp wins
   └─→ or crdt.tombstone(key) for deletes
   │
   ▼
Frontend dispatches "sync:incoming" event
   │
   ▼
Screens re-render with updated data
```

## Stylus input flow

```
PointerEvent on canvas
   │
   ▼
Notebook handler
   │
   ├─→ currentTool: "pen" | "highlighter" | "eraser"
   │
   ├─→ if pen: ctx.beginPath(); ctx.strokeStyle; ctx.lineWidth = size * pressure
   ├─→ if highlighter: ctx.globalAlpha = 0.4
   ├─→ if eraser: ctx.clearRect / composite
   │
   ▼
Points pushed to page.strokes[]
   │
   ▼
PDF export: strokes → vector paths in PDF stream
```
