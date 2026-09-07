# M-NEXUS Backend

Backend Node.js (Fastify 5 + TypeScript) que da servicios a:
- **App standalone** (registro de devices, sync, push, vault, etc)
- **Instalador** (`install/install.sh`)

**v0.46.0** — Major audit-driven release: 16 servicios nuevos + sistema de error codes unificado (v0.45).

---

## v0.46.0 — Audit-driven major release

Esta versión cierra el **audit Expectativa vs Realidad** iniciado en 2026-09-07. 41 commits, 16 servicios nuevos, 6 auditor bugs cerrados, 533 tests pasando.

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

```bash
# Requisitos: Node.js >= 22
node --version

# Instalar deps
npm install

# Build
npm run build

# Tests (533 tests)
npx vitest run --exclude '**/integration.test.ts'

# Typecheck
npx tsc --noEmit

# Correr (en dev, puerto 8787)
npm run dev | pino-pretty

# Correr (en prod)
MNEXUS_PORT=8787 node dist/index.js
```

### Variables de entorno (v0.46.0)

| Variable | Default | Descripción |
|---|---|---|
| `MNEXUS_PORT` | `8787` | Puerto HTTP |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:8080` | CSV de origins permitidos (`*` rechazado si credentials=true) |
| `WS_RATE_LIMIT_MESSAGES` | `100` | Max mensajes WS por ventana por deviceId |
| `WS_RATE_LIMIT_BYTES` | `10485760` | Max bytes WS por ventana (10MB) |
| `WS_RATE_LIMIT_WINDOW_MS` | `60000` | Tamaño de ventana (1 min) |
| `WS_MAX_CONCURRENT` | `5` | Max conexiones concurrentes por deviceId |
| `AUDIT_LOG_PATH` | `/var/log/mnexus/audit.jsonl` (prod) / tmpdir (dev) | Path del WORM audit log |
| `MOCK_WHISPER` | `0` | Set a `1` para usar mock de Whisper en dev |
| `MOCK_LLM` | `0` | Set a `1` para usar mock de LLM en dev |
| `MOCK_EMBEDDINGS` | `0` | Set a `1` para usar mock de embeddings en dev |

---

## Endpoints principales (100+)

### Auth & Devices
- `POST /auth/login` — login con JWT
- `POST /auth/refresh` — refresh token
- `POST /devices/register` — registrar device
- `GET /devices/:id` — info device

### Vault
- `GET /vault/notes` — listar notas
- `GET /vault/notes/:path` — leer nota
- `POST /vault/notes` — crear/actualizar
- `DELETE /vault/notes/:path` — eliminar
- `POST /vault/upload` — chunked upload

### Search (FTS5)
- `GET /search?q=&limit=&offset=` — full-text search con BM25
- `GET /search/suggest?q=` — autocomplete
- `GET /search/snippet?path=&q=` — snippet con highlighting

### FSRS
- `POST /fsrs/review` — registrar review
- `GET /fsrs/card/:id` — estado actual del card
- `GET /fsrs/due?limit=` — cards due
- `POST /fsrs/bulk-review` — bulk operations

### AI
- `POST /ai/tutor` — pregunta al tutor
- `POST /ai/proposals` — generar propuestas de flashcards
- `POST /ai/embeddings` — embeddings para RAG
- `POST /ai/whisper` — transcribir audio

### Sync
- `WS /sync` — WebSocket para Yjs CRDT sync
- `POST /sync/snapshot` — subir snapshot
- `GET /sync/snapshot/:id` — descargar snapshot

### Marketplace
- `GET /marketplace/decks?category=&sort=&search=` — listar decks
- `GET /marketplace/decks/:id` — detalle
- `POST /marketplace/decks/:id/install` — instalar

### Gamification
- `GET /gamification/profile` — XP, level, badges
- `GET /gamification/leaderboard` — leaderboard

### Plugins
- `GET /plugins` — listar plugins instalados
- `POST /plugins/install` — instalar plugin
- `POST /plugins/:id/execute` — ejecutar con sandbox

### Importers
- `POST /import/pdf` — importar PDF
- `POST /import/anki` — importar Anki (.apkg)
- `POST /import/notion` — importar Notion (.zip)
- `POST /import/roam` — importar Roam (.json)

### Web Clipper
- `POST /clipper/save` — guardar article desde clipper

### Wikilinks
- `GET /wikilinks/extract?path=` — extraer wikilinks
- `GET /wikilinks/backlinks?path=` — backlinks de un path
- `GET /wikilinks/graph` — grafo de notas

### Templates
- `GET /templates` — listar templates
- `POST /templates/apply` — aplicar template

### Tags
- `GET /tags?prefix=` — autocomplete
- `GET /tags/:name` — info tag
- `POST /tags/extract` — extraer tags de un texto

### Cloze
- `POST /cloze/parse` — parsear cloze syntax
- `POST /cloze/cards` — generar cards

### Image Occlusion
- `POST /occlusion/mask` — agregar mask
- `POST /occlusion/reveal` — revelar region

### Type-Answer
- `POST /type-answer/check` — verificar respuesta con Levenshtein

### Heatmap / Stats
- `GET /stats/heatmap?start=&end=` — heatmap data
- `GET /stats/streak` — streak actual
- `GET /stats/retention` — retention rate

### Backup / Update
- `POST /backup/create` — crear backup
- `GET /backup/list` — listar backups
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

```bash
# Todos los tests (533)
npx vitest run --exclude '**/integration.test.ts'

# Solo cross-cutting (8 tests, ~5s)
npx vitest run tests/crossCutting.test.ts

# Solo un servicio
npx vitest run tests/fsrsService.test.ts

# Watch mode
npx vitest --watch

# Con coverage
npx vitest run --coverage
```

### Coverage actual

- **533 tests passing** (1 skipped pre-existente)
- **38 test files**
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
├── tests/                     # 38 test files, 533 tests
├── data/                      # SQLite DB
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
