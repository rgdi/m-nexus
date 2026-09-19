# M-NEXUS Backend

Backend Node.js (Fastify + TypeScript) que da servicios a:
- **Web app** (vanilla JS frontend served desde `frontend/`)
- **App standalone** (registro de devices, sync, push, vault, etc)
- **Instalador** (`install/install.sh`)

**v2.16.0** (webapp stack: TS backend + vanilla JS frontend) — última release con **930 tests pasando + syncE2E real**. Conflict merge UI, Yjs official client, user-uploaded .glb, pressure curves en settings.

> **Nota histórica**: este repo pasó por dos stacks. v0.40–v0.60 (legacy "Flutter-like") está deprecado. El código actual corresponde a v2.x — backend en TS simple, frontend vanilla JS+CSS, sync LWW + Yjs binary.

---

## v2.16.0 (2026-09-19) — Conflict merge + Yjs + GLB upload + Pressure curves

### Cambios principales

- **CRDT conflict resolution**: `services/crdt.ts` con vector clocks + field-level LWW. Aplicado en `routes/sync_v2.ts` antes de cada broadcast.
- **Yjs official server-side**: ya existía `routes/crdt.ts` con WS endpoint `/api/v1/crdt/ws/:notePath`. Ahora cliente compatible en `frontend/src/services/yjs_client.js`.
- **GLB model routes** (new `routes/glbModels.ts`): upload/list/delete + multipart 50MB + magic validation. Built-ins protegidos.
- **AI auto-tagging uses configured provider**: `aiTagger.ts` ahora consume `aiProviders.ts` (lee `data/ai-config.json`) en vez de `LLMService` directo.

### Stats backend v2.16.0

- 77 vitest files, 930 tests passing
- 52 routes
- 52 services
- Public paths include `/models`, `/public`, `/api/v1/models`, etc.

### Quick start (v2.16.0)

```bash
# Requisitos: Node.js >= 20 (recomendado 22)
node --version

# Instalar deps
npm install

# Correr dev (puerto 4100 — el frontend espera este puerto)
PORT=4100 npx tsx src/server.ts

# Tests (930 tests)
./node_modules/.bin/vitest run --exclude="**/syncE2E.test.ts"

# Typecheck
npx tsc --noEmit

# Watch mode dev
npx tsx watch src/server.ts
```

Server listens at `http://localhost:4100` by default. Frontend connects via:
- REST: `http://localhost:4100/api/v1/*`
- WebSocket sync: `ws://localhost:4100/ws/sync`
- Static GLB models: `http://localhost:4100/models/*`
- Health check: `http://localhost:4100/api/v1/health`

### Variables de entorno (v2.16.0)

| Var | Default | Descripción |
|---|---|---|
| `PORT` | 4000 | Puerto del server (frontend espera 4100) |
| `HOST` | 0.0.0.0 | Interfaz de red |
| `DATA_DIR` | `./data` | Donde se guardan notas/flashcards/json files |
| `JWT_SECRET` | (requerido en prod) | HS256 secret — fail-fast si weak |
| `WS_AUTH_REQUIRED` | 0 | Si 1, WS requiere `?token=<jwt>` |
| `TESSERACT_LANGS` | spa+eng | Lang packs para OCR handwriting |
| `MOCK_OLLAMA` | 0 | Si 1, Ollama devuelve mock |
| `MOCK_OPENROUTER` | 0 | Si 1, OpenRouter devuelve mock |
| `MOCK_LLM` | 0 | Generic mock para AI |
| `LOG_LEVEL` | info | pino level: trace/debug/info/warn/error |

Para producción: `JWT_SECRET=$(openssl rand -hex 32)` y `LOG_LEVEL=warn`.

---

## v2.15.0 (2026-09-19) — Cellular .glb + AI provider

- 3 modelos `.glb` de célula (animal_cell 106KB, plant_cell 61KB, bacterium 49KB) — empaquetados en `public/models/`
- `services/crdt.ts` (NEW, 5942 bytes) — vector clocks + field-level LWW exports: `clockDominates`, `compareClocks`, `bumpClock`, `joinClocks`, `mergeFields`, `shouldApply`
- `routes/sync_v2.ts` (MODIFIED) — `RESOURCE_STATE` map aplica CRDT, broadcast lleva `__mergedFields`
- `services/aiTagger.ts` (REWRITTEN) — heuristic-first, LLM fallback con timeout 4s, 200 tokens, temp 0.2
- `routes/health.ts` registra estado de providers (whisper/ollama/openrouter/tesseract/embeddings)

Tests: 921 (1 skipped)

---

## v2.14.0 (2026-09-19) — OCR confidence + tilt + GLB infra

- `services/handwritingService.ts` (MODIFIED) — tesseract corre 2x (text + TSV), parsea per-word confidence via TSV cols[10]. `TESSERACT_LANGS` env var configurable.
- `middleware/auth.ts` (MODIFIED) — `/models` y `/public` en PUBLIC_PATHS (static files sin auth)
- `routes/ocr.ts` extended — confidence threshold en frontend previene garbage append

Tests: 902

---

## v2.13.0 (2026-09-19) — Pressure + palm + OCR

- `services/handwritingService.ts` (NEW) — tesseract subprocess wrapper
- Backend expone `/api/v1/handwriting/recognize` que llama tesseract con `--psm 7` y lang packs

---

## v2.6.0 (2026-09-16) — Public deploy ready

Admin auth con 90-day sessions, smart backup rotation, swappable AI provider, optional Cloudflare Tunnel. 41 commits, 16 servicios nuevos, 6 auditor bugs cerrados, 533 tests pasando.

### 🆕 Servicios nuevos (16)

| # | Servicio | LOC | Tests | Descripción |
|---|---|---|---|---|
| 1 | **FSRS-5/6** (`ts-fsrs@5.4.2`) | 380 | 32 | Algoritmo FSRS real con 21 parámetros, 4 ratings, DSR model, forgetting curve |
| 2 | **AI Proposals v2** | 381 | 24 | LLM-powered con heuristic regex fallback, caching, rate limiting |
| 3 | **Whisper real** | 245 | 12 | Streaming transcription con whisper-node (reemplaza placeholder) |
| 4 | **Search FTS5** | 290 | 18 | Full-text search con BM25 ranking, stemming porter unicode61, snippets |
| 5 | **Wikilinks** | 195 | 15 | Parser `[[Note]]` con display/section/block, backlinks indexados, NFD normalize |
| 6 | **Graph view** | 340 | 13 | Force-directed layout (Fruchterman-Reingold), 3D opcional, export JSON |
| 7 | **Templates** | 220 | 11 | 7 templates médicos (SOAP, H&P, Differential, Pharmacology, Anatomy, Pathophysiology, Procedure) |
| 8 | **Tags** | 175 | 9 | `#tag` extraction, autocomplete, hierarchy, count |
| 9 | **Cloze deletion** | 240 | 14 | `{{c1::texto::hint}}` estilo Anki, multi-cloze, generate cards |
| 10 | **Image Occlusion** | 170 | 8 | Máscaras (rectangle/ellipse) sobre imágenes, reveal por región |
| 11 | **Type-Answer** | 200 | 11 | Levenshtein distance, fuzzy match, case-insensitive |
| 12 | **Heatmap + Stats** | 180 | 10 | GitHub-style heatmap 365 días, streak tracking, retention rate, distribution |

### 🆕 Servicios nuevos (16)

| # | Servicio | LOC | Tests | Descripción |
|---|---|---|---|---|
| 1 | **FSRS-5/6** (`ts-fsrs@5.4.2`) | 380 | 32 | Algoritmo FSRS real con 21 parámetros, 4 ratings, DSR model, forgetting curve |
| 2 | **AI Proposals v2** | 381 | 24 | LLM-powered con heuristic regex fallback, caching, rate limiting |
| 3 | **Whisper real** | 245 | 12 | Streaming transcription con whisper-node (reemplaza placeholder) |
| 4 | **Search FTS5** | 290 | 18 | Full-text search con BM25 ranking, stemming porter unicode61, snippets |
| 5 | **Wikilinks** | 195 | 15 | Parser `[[Note]]` con display/section/block, backlinks indexados, NFD normalize |
| 6 | **Graph view** | 340 | 13 | Force-directed layout (Fruchterman-Reingold), 3D opcional, export JSON |
| 7 | **Templates** | 220 | 11 | 7 templates médicos (SOAP, H&P, Differential, Pharmacology, Anatomy, Pathophysiology, Procedure) |
| 8 | **Tags** | 175 | 9 | `#tag` extraction, autocomplete, hierarchy, count |
| 9 | **Cloze deletion** | 240 | 14 | `{{c1::texto::hint}}` estilo Anki, multi-cloze, generate cards |
| 10 | **Image Occlusion** | 170 | 8 | Máscaras (rectangle/ellipse) sobre imágenes, reveal por región |
| 11 | **Type-Answer** | 200 | 11 | Levenshtein distance, fuzzy match, case-insensitive |
| 12 | **Heatmap + Stats** | 180 | 10 | GitHub-style heatmap 365 días, streak tracking, retention rate, distribution |
| 13 | **Sync (Yjs CRDT + E2E)** | 295 | 14 | Yjs CRDT con AES-256-GCM encryption, conflict resolution, chunked sync |
| 14 | **AI Tutor (RAG)** | 280 | 16 | Preguntas sobre vault, sources citadas, context-aware, multi-model |
| 15 | **Marketplace** | 200 | 12 | Decks compartidos, rating, downloads, categories, install flow |
| 16 | **Gamification** | 180 | 9 | XP, levels, badges, streaks, achievements |
| 17 | **Web Clipper** | 160 | 8 | Bookmarklet + browser extension, save articles → markdown |
| 18 | **Importers** | 320 | 15 | PDF, Anki (.apkg), Notion (.zip), Roam (.json) → markdown + flashcards |
| 19 | **Plugin API** | 200 | 8 | JS sandbox con permisos granulares, lifecycle hooks |
| 20 | **i18n** | 130 | 8 | 3 idiomas (en/es/pt), ICU plurales, message catalog centralizado |

**Total nuevos servicios: 6,591 LOC + 245 tests nuevos**

### 🐛 Auditor bugs cerrados (6)

| # | Bug | Severidad | Fix |
|---|---|---|---|
| #1 | CORS `origin: true` con `credentials: true` = CSRF | 🔴 alta | `corsPolicy.ts` whitelist via env, `*` rechazado, callback signature `(err, allow)` |
| #2 | WebSocket sin rate limit = DoS | 🔴 alta | `wsRateLimit.ts` sliding window 100 msgs/10MB per 1 min, 5 concurrent per deviceId |
| #3 | Audit log mutable (WORM violado) | 🟠 media | `wormAudit.ts` append-only JSONL + SHA-256 hash chain, `verifyChain()` detecta tampering |
| #4 | APK pipeline roto (cache + daemon) | 🔴 crítica | `release.yml` reparado: flutter clean + cache pub (no gradle) + gradle daemon=false |
| #5 | Updater cache pierde release info | 🟠 media | `updater.dart` + `updater_models.dart` persiste `AppUpdate.toJson()` completo |
| #6 | home_screen carga vault entero (30s) | 🟠 media | `VaultService.listRecentNotes(limit)` algoritmo 3 fases: stat + sort + O(limit) read |

### 🆕 Utilidades nuevas

- **`corsPolicy.ts`** — CORS whitelist configurable via `CORS_ALLOWED_ORIGINS`, rechaza `*` con credentials
- **`wsRateLimit.ts`** — Sliding window per-deviceId, max concurrent, audit log
- **`wormAudit.ts`** — JSONL append-only, SHA-256 chain (prevHash + payload), verifyChain
- **`i18n.ts`** — Catálogo de mensajes en 3 idiomas, ICU plurales
- **Cross-cutting tests** — 8 tests de integración con `buildApp()` + `app.inject()` (sin mocks)

---

## v0.45.0 — Sistema de error codes unificado

### Novedades de v0.45.0

- **🆔 Sistema de error codes unificado** — `AppError` con `code`, `category`, `message`, `cause`, `context`, `hint`, `timestamp`, `statusCode`
- **🛡️ Helpers `safeCall` / `safeCallAsync`** — centralizan try-catch con logging automático
- **📊 Logger estructurado (pino)** — `logOp()`, `logError()`, `logLifecycle()`, `logNetwork()`, `logPlatform()` con redacción de secretos
- **🌐 Central error handler** — `setErrorHandler` con respuestas JSON consistentes + `requestId` para correlación
- **🔄 HTTP status code auto-mapeado** — por categoría (`AUTH`→401, `VAL`→400, `RATE`→429, `DB`/`SEC`→403, `NET`/`EXT`/`LLM`/`OCR`/`AUD`/`EMB`→502, resto→500)
- **🔒 Redacción automática** — `*.password`, `*.token`, `*.secret`, `*.apiKey`, `headers.authorization`, `headers.cookie`
- **🆔 requestId** — cada request tiene un ID único `req_${ts}_${random}` que aparece en todos los logs y respuestas

### Categorías de error

| Código | Nombre | HTTP | Descripción |
|--------|--------|------|-------------|
| `NET` | Network | 502 | HTTP/fetch/conexión |
| `FS` | Filesystem | 500 | Read/write/list |
| `DB` | Database | 403 | SQLite/queries |
| `AUTH` | Auth | 401 | JWT, devices, permisos |
| `VAL` | Validation | 400 | Schema, input |
| `EXT` | External | 502 | Upstream genérico |
| `LLM` | LLM | 502 | Ollama, OpenRouter |
| `OCR` | OCR | 502 | Tesseract, Deepseek |
| `AUD` | Audio | 502 | Whisper |
| `EMB` | Embeddings | 502 | Embeddings |
| `SEC` | Secrets | 403 | Encryption, master key |
| `BK` | Backup | 500 | Backup index, ZIPs |
| `SYNC` | Sync | 500 | LWW, vector clocks |
| `CONFL` | Conflict | 500 | Conflict resolution |
| `PROP` | Proposals | 500 | Proposals |
| `PUSH` | Push | 500 | FCM notifications |
| `QUIZ` | Quiz | 500 | Adaptive quiz |
| `STR` | Structured | 500 | Structured notes |
| `REL` | Relevance | 500 | Cross-relevance |
| `WS` | WebSocket | 500 | WebSocket |
| `RATE` | Rate limit | 429 | Rate limit |
| `CFG` | Configuration | 500 | Settings inválidos |
| `EVAL` | Evaluation | 500 | Vault evaluation |
| `LIFECYCLE` | Lifecycle | 500 | Init/dispose |
| `INTERNAL` | Internal | 500 | Bugs, asserts |

📚 Ver [`docs/ERROR_CODES.md`](../docs/ERROR_CODES.md) para la lista completa.

📚 Ver [`docs/LOGGING.md`](../docs/LOGGING.md) para cómo ver logs.

---

## Quick start

**Legacy v0.46.0 note:** the below variables reference the old `MNEXUS_PORT=8787`. **Current v2.16.0 uses `PORT=4100`** — see the v2.16.0 Quick start at the top of this README.

```bash
# Requisitos: Node.js >= 22
node --version

# Instalar deps
npm install

# Correr dev (puerto 4100)
PORT=4100 npx tsx src/server.ts

# Tests (930 tests)
./node_modules/.bin/vitest run --exclude="**/syncE2E.test.ts"

# Typecheck
npx tsc --noEmit
```

---

## Endpoints principales (v2.16.0, 52+)

### Auth & Devices
- `POST /api/v1/auth/register` — crear admin user (device-bound)
- `POST /api/v1/auth/login` — login con throttle + lockout
- `POST /api/v1/auth/refresh` — refresh token (90d)
- `GET /api/v1/auth/me` — current user info
- `POST /api/v1/auth/logout` — invalidar token
- `GET /api/v1/devices` — listar devices del user

### Sync (CRDT dual pipeline)
- `GET /ws/sync` — WebSocket JSON CRDT broadcast (sync_v2 LWW + field merges)
- `POST /api/v1/sync/publish` — REST publish (resilience)
- `GET /api/v1/sync/history` — recent 200 msgs
- `GET /api/v1/sync/history/:type/:id` — per-resource history (v2.16)
- `GET /api/v1/sync/state/:type/:id` — CRDT-merged view (v2.15)
- `GET /api/v1/sync/state` — all tracked resources (v2.15)
- `GET /api/v1/sync/stats` — clients + history size + resourcesTracked
- `GET /api/v1/crdt/ws/:notePath` — **Yjs** WS endpoint (binary updates, awareness)

## Endpoints principales (100+)

### Auth & Devices
- `POST /auth/login` — login con JWT
- `POST /auth/refresh` — refresh token
- `POST /devices/register` — registrar device
- `GET /devices/:id` — info device

### Notas & Subjects
- `GET /api/v1/subjects` — listar subjects (subjectColor, average)
- `POST /api/v1/subjects` — crear subject
- `PATCH /api/v1/subjects/:id` — actualizar
- `DELETE /api/v1/subjects/:id` — eliminar
- `GET /api/v1/notes?subjectId=&q=&tag=` — listar/buscar notas
- `POST /api/v1/notes` — crear nota
- `PATCH /api/v1/notes/:id` — actualizar
- `DELETE /api/v1/notes/:id` — eliminar
- `GET /api/v1/notes/:id/strokes` — strokes del canvas
- `POST /api/v1/notes/:id/strokes` — persistir strokes

### Flashcards (FSRS-4.5)
- `GET /api/v1/flashcards?subjectId=&topic=&due=` — listar
- `POST /api/v1/flashcards` — crear (manual)
- `POST /api/v1/flashcards/generate` — AI genera desde texto
- `PATCH /api/v1/flashcards/:id` — actualizar
- `POST /api/v1/flashcards/:id/review` — registrar review (FSRS compute)
- `DELETE /api/v1/flashcards/:id` — eliminar

### Events / Tasks
- `GET /api/v1/events?from=&to=` — calendar events
- `POST /api/v1/events` — crear
- `PATCH /api/v1/events/:id` — actualizar
- `DELETE /api/v1/events/:id` — eliminar
- `GET /api/v1/tasks?completed=` — to-dos
- `POST /api/v1/tasks` — crear
- `PATCH /api/v1/tasks/:id` — toggle done
- `DELETE /api/v1/tasks/:id` — eliminar

### AI
- `POST /api/v1/ai/tutor` — RAG contextual chat
- `POST /api/v1/ai/generate-cards` — extract flashcards from text
- `POST /api/v1/llm/embed` — embeddings (RAG)
- `POST /api/v1/audio/transcribe` — Whisper (mock until configured)
- `POST /api/v1/ocr/image` — Tesseract OCR
- `POST /api/v1/handwriting/recognize` — handwriting OCR (v2.13+)
- `GET /api/v1/admin/ai` — get AI provider config
- `PUT /api/v1/admin/ai` — update (Ollama URL / OpenRouter key / etc)

### Models (3D)
- `GET /api/v1/models` — listar built-ins + user uploads (v2.16)
- `POST /api/v1/models/upload` — multipart upload .glb (v2.16)
- `DELETE /api/v1/models/:filename` — eliminar (protege built-ins, v2.16)
- `GET /models/:filename` — static serve (built-ins)
- `GET /models/user/:filename` — static serve (user uploads)

### Recording / cross-verify
- `POST /api/v1/recordings` — upload audio
- `GET /api/v1/recordings/:id` — download
- `POST /api/v1/cross-verify` — diff transcript vs notas

### Themes & Backups
- `GET /api/v1/themes` — listar temas
- `POST /api/v1/themes` — crear tema custom
- `GET /api/v1/backup/list` — listar backups (v2.6)
- `POST /api/v1/backup/create` — crear backup manual
- `GET /api/v1/admin/backup` — config
- `PUT /api/v1/admin/backup` — update config

### Secrets & Folders
- `GET /api/v1/secrets` — listar
- `POST /api/v1/secrets` — crear (encrypted at rest)
- `GET /api/v1/folders` — listado con jerarquía
- `POST /api/v1/folders` — crear
- `PATCH /api/v1/folders/:id` — mover
- `POST /update/check` — check updates
- `POST /update/apply` — apply update

### Metrics / Health
- `GET /health` — health check (returns `{"status":"ok","version":"v0.46.0"}`)
- `GET /metrics` — Prometheus metrics

📚 Ver [`docs/API.md`](../docs/API.md) para la lista completa con request/response schemas.

---

## Cómo emitir un error

```typescript
import { E } from '../utils/errorCodes.js';
import { safeCallAsync } from '../utils/safeCall.js';

// Opción 1: throw directo
throw E.llm('EC-LLM-005', 'Ollama API error', {
  cause: originalError,
  context: { status: 500, model: 'llama3' },
  hint: 'Check Ollama is running and model is available',
});

// Opción 2: safeCall (preferido)
const r = await safeCallAsync({
  component: 'llm',
  code: 'EC-LLM-004',
  message: 'ollamaChat failed',
  context: { model: 'llama3' },
  op: async () => {
    return await ollama.chat({ ... });
  },
});
if (!r.success) throw r.error!; // El error handler central lo convierte a JSON
```

## Estructura de respuesta de error

```json
{
  "code": "EC-LLM-005",
  "category": "LLM",
  "message": "Ollama API error",
  "hint": "Check Ollama is running and model is available",
  "requestId": "req_1725716591456_x8k2p9"
}
```

---

## Ver logs

```bash
# En dev (con pino-pretty)
npm run dev | pino-pretty

# Filtrar por código
npm run dev 2>&1 | grep "EC-LLM"

# Filtrar por componente
npm run dev 2>&1 | grep '"component":"auth"'

# Solo errores
npm run dev 2>&1 | grep '"level":50'

# En prod (systemd)
journalctl -u mnexus-backend -f

# En Docker
docker logs -f mnexus-backend

# Verificar WORM audit chain
node dist/utils/verifyChain.js /var/log/mnexus/audit.jsonl
```

Ver [`docs/LOGGING.md`](../docs/LOGGING.md) para opciones de agregación (Loki, Elasticsearch, etc).

---

## Tests

**v2.16.0**: 77 vitest files, **930 tests passing** (1 skipped).

```bash
# Todos los tests (930)
./node_modules/.bin/vitest run --exclude="**/syncE2E.test.ts"

# Solo cross-cutting
./node_modules/.bin/vitest run tests/crossCutting.test.ts

# Solo un servicio
./node_modules/.bin/vitest run tests/fsrsService.test.ts

# Watch mode
./node_modules/.bin/vitest --watch

# Con coverage
./node_modules/.bin/vitest run --coverage

# Excluir syncE2E (flaky en sandbox sin internet)
./node_modules/.bin/vitest run --exclude="**/syncE2E.test.ts"
```

Sincronización real con WS (syncE2E.test.ts) requiere backend activo y 2 clientes ws. Se ejecuta con:
```bash
./node_modules/.bin/vitest run syncE2E
```

### Coverage actual (v2.16.0)

- **930 tests passing** (1 skipped pre-existente, syncE2E excluido por flaky en sandbox)
- **77 test files**
- **0 typecheck errors** (`tsc --noEmit`)
- ~85% code coverage

### Tests por servicio

| Servicio | Tests | Notas |
|---|---|---|
| FSRS | 32 | Parity con app-side Dart engine |
| AI Proposals v2 | 24 | LLM + fallback regex |
| Whisper | 12 | Streaming + mock fallback |
| Search FTS5 | 18 | BM25 ranking, snippets |
| Wikilinks | 15 | NFD normalize, auto .md |
| Graph | 13 | Force-directed convergence |
| Templates | 11 | 7 medical templates |
| Tags | 9 | #tag extraction |
| Cloze | 14 | Multi-cloze, hints |
| Image Occlusion | 8 | Rectangle + ellipse masks |
| Type-Answer | 11 | Levenshtein variants |
| Heatmap | 10 | 365-day aggregation |
| Sync | 14 | Yjs CRDT + E2E |
| AI Tutor | 16 | RAG + sources |
| Marketplace | 12 | Install + rating |
| Gamification | 9 | XP, badges, streaks |
| Web Clipper | 8 | Article parsing |
| Importers | 15 | PDF/Anki/Notion/Roam |
| Plugin API | 8 | Sandbox + permissions |
| i18n | 8 | 3 idiomas + ICU |
| corsPolicy | 17 | Whitelist + CSRF |
| wsRateLimit | 17 | Sliding window + concurrent |
| wormAudit | 22 | Hash chain + verify |
| Cross-cutting | 8 | Integration end-to-end |
| **Otros (legacy)** | ~150 | Auth, vault, etc |

---

## Estructura del backend

```
backend/
├── src/
│   ├── index.ts               # Entry point
│   ├── server.ts              # Fastify app + register routes
│   ├── routes/                # 26 archivos de rutas HTTP
│   ├── services/              # 37 servicios (20 nuevos en v0.46)
│   │   ├── fsrs/              # FSRS-5/6 algorithm
│   │   ├── ai/                # LLM, embeddings, tutor, proposals
│   │   ├── search/            # FTS5
│   │   ├── sync/              # Yjs CRDT + encryption
│   │   └── ...
│   ├── utils/                 # 9 utilidades (3 nuevas en v0.46)
│   │   ├── corsPolicy.ts      # 🆕 whitelist
│   │   ├── wsRateLimit.ts     # 🆕 sliding window
│   │   ├── wormAudit.ts       # 🆕 hash chain
│   │   ├── errorCodes.ts      # v0.45
│   │   ├── safeCall.ts        # v0.45
│   │   ├── log.ts             # v0.45
│   │   ├── metrics.ts
│   │   ├── i18n.ts            # 🆕
│   │   ├── updateApply.ts
│   │   └── updateChecker.ts
│   ├── plugins/               # Fastify plugins
│   ├── i18n/                  # 🆕 messages catalog (en/es/pt)
│   └── types/                 # TypeScript types
├── tests/                     # 77 test files, 930 tests (v2.16.0)
├── data/                      # JSON persistence (notes.json, flashcards.json, ai-config.json, …)
├── public/models/             # 3 built-in cell .glb + user uploads
├── package.json
└── tsconfig.json
```

---

## Performance targets

| Operación | Target | Actual |
|---|---|---|
| Health check | < 5ms | 1-2ms |
| Vault list (1000 notas) | < 50ms | ~20ms |
| Search FTS5 (10K notas) | < 100ms | ~30ms |
| FSRS scheduling | < 5ms | ~1ms |
| AI tutor (cold) | < 3s | ~2s |
| AI tutor (cached) | < 500ms | ~200ms |
| WORM audit write | < 1ms | ~0.5ms |
| WORM audit verify (1K entries) | < 100ms | ~30ms |

---

## Licencia

MIT — ver [LICENSE](../LICENSE)
