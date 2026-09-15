# M-NEXUS Backend API (v2.1.4)

REST API del backend Node.js (Fastify 5 + TypeScript + SQLite).

**Base URL:** `http://localhost:4100/api/v1` · **Versión:** v1

**Auth (v2.1.4):** JWT Bearer tokens en `Authorization: Bearer <token>`.
Para desarrollo / tests, `AUTH_REQUIRED=false` desactiva el middleware (modo legacy).
Sin auth, las rutas legacy (`/flashcards`, `/notes`, `/subjects`, etc.) son públicas.

**Header recomendado:** `X-Device-Id` identifica el device companion.

---

## 📋 Índice

- [Health & Metrics](#health--metrics)
- [Auth](#auth)
- [Devices & Stats](#devices--stats)
- [Subjects / Notes / Events / Tasks / Recordings](#crud)
- [Flashcards](#flashcards)
- [AI Routes (vault eval, quiz, proposals, knowledge)](#ai-routes)
- [AI v2 (chat, embeddings, RAG)](#ai-v2)
- [LLM (multi-provider)](#llm)
- [OCR / PDF / Audio / Transcription](#ocr-pdf-audio)
- [Cross-verify](#cross-verify)
- [FSRS (spaced repetition)](#fsrs)
- [Sync (WebSocket + REST)](#sync)
- [Push Notifications](#push)
- [Backup / Update / Secrets](#backup-update-secrets)
- [Themes](#themes)
- [Stemmer](#stemmer)
- [Search](#search)
- [Import](#import)
- [Databases (linked)](#databases)
- [Structured views / rows](#structured)

---

## Health & Metrics

```
GET  /health                              # basic OK
GET  /api/v1/health                       # full status + version + providers
GET  /metrics                             # Prometheus format
GET  /api/v1/ai/cache-stats               # AI cache stats
GET  /api/v1/llm/embed/cache              # LLM embed cache stats
POST /api/v1/llm/embed/cache/clear        # clear embed cache
GET  /api/v1/stats                        # version, uptime, memory
```

## Auth

```
POST /api/v1/register                     # register device, returns access + refresh
POST /api/v1/auth/refresh                 # rotate refresh token
POST /api/v1/auth/revoke                  # revoke all tokens for device
GET  /api/v1/audit                        # audit log for current device
```

## Devices & Stats

```
GET  /api/v1/devices                      # list registered devices (public, count + sanitized list)
```

## CRUD: Subjects / Notes / Events / Tasks / Recordings

```
GET    /subjects
POST   /subjects
GET    /subjects/:id
PATCH  /subjects/:id
DELETE /subjects/:id

GET    /notes
POST   /notes
GET    /notes/:id
PATCH  /notes/:id                  # body, subject, etc.
DELETE /notes/:id
GET    /notes/sync/status
POST   /notes/:id/extract-flashcards  # parse {{c1::...::...}} → flashcards

GET    /events
POST   /events
PATCH  /events/:id
DELETE /events/:id

GET    /tasks
POST   /tasks
PATCH  /tasks/:id
DELETE /tasks/:id
POST   /tasks/:id/toggle            # toggle done

GET    /recordings
POST   /recordings
GET    /recordings/filter
DELETE /recordings/:id
```

## Flashcards

```
POST /api/v1/flashcards                     # create
GET  /api/v1/flashcards                     # list all
GET  /api/v1/flashcards/filter?subject=X    # filter
GET  /api/v1/flashcards/:id
PATCH /api/v1/flashcards/:id                # update front/back
DELETE /api/v1/flashcards/:id
POST /api/v1/flashcards/generate            # mock: extract from note text
```

## AI Routes

```
POST /api/v1/ai/vault/eval                  # evaluate vault health
POST /api/v1/ai/proposals/generate          # generate flashcard proposals
POST /api/v1/ai/proposals/cache/clear       # clear proposals cache
GET  /api/v1/ai/knowledge/:userId           # knowledge graph
GET  /api/v1/ai/knowledge/:userId/gaps      # weak topics
POST /api/v1/ai/quiz/:userId/session        # start adaptive quiz
GET  /api/v1/ai/quiz/:userId/next           # next question
POST /api/v1/ai/quiz/:userId/result         # submit answer
POST /api/v1/ai/cross-relevance/analyze     # find related notes
POST /api/v1/ai/tutor                       # RAG tutor (uses Ollama)
```

## AI v2

```
POST /api/v1/ai/chat                        # conversational
POST /api/v1/ai/embeddings                  # vector embeddings
POST /api/v1/ai/rag-search                  # RAG over notes
```

## LLM (multi-provider)

```
POST /api/v1/llm/chat                       # Ollama / OpenRouter / Anthropic / OpenAI
POST /api/v1/llm/embed                      # embeddings
```

## OCR / PDF / Audio / Transcription

```
POST /api/v1/ocr/image                      # OCR image → text
POST /api/v1/pdf/diff                       # compare two PDFs
POST /api/v1/audio/transcribe               # one-shot Whisper
WS   /api/v1/audio/transcribe/stream        # streaming Whisper
POST /api/v1/handwriting/recognize          # (alias of OCR)
GET  /api/v1/transcription/stream           # (alias)
POST /api/v1/upload                         # generic upload
```

## Cross-verify

```
GET  /api/v1/cross-verify                   # coverage between notes and recordings
```

Returns coverage % + gap topics (topics in notes with no recording).

## FSRS (spaced repetition)

```
GET  /api/v1/fsrs/list                      # all FSRS state per card
GET  /api/v1/fsrs/stats                     # aggregate stats
```

## Sync (WebSocket + REST)

```
WS   /ws/sync                                # WebSocket relay (low-latency broadcasts)
POST /api/v1/sync/publish                    # publish a change (dual-channel)
GET  /api/v1/sync/history                    # recent messages (for late joiners)
GET  /api/v1/sync/stats                      # connected count + history size
```

CRDT semantics applied on receive (LWW + tombstones).

## Push Notifications

```
POST /api/v1/push/register
POST /api/v1/push/token/:deviceId
GET  /api/v1/push/tokens
POST /api/v1/push/send
POST /api/v1/push/broadcast
GET  /api/v1/push/stats
```

## Backup / Update / Secrets

```
POST   /api/v1/backup/upload                 # upload ZIP (X-Backup-Metadata header)
GET    /api/v1/backup/list
GET    /api/v1/backup/download/:id
DELETE /api/v1/backup/:id
GET    /api/v1/backup/dump

GET    /api/v1/update                         # current vs latest version
POST   /api/v1/update/check                   # force re-check
POST   /api/v1/update/apply                   # apply update

GET    /api/v1/secrets
PUT    /api/v1/secrets/:name
GET    /api/v1/secrets/test/:name             # check if a secret works
```

## Themes

```
GET    /themes
POST   /themes
GET    /themes/:id
PATCH  /themes/:id
DELETE /themes/:id
GET    /themes/:id/css                       # CSS for the theme
GET    /themes/export
GET    /themes/active/:id
```

## Stemmer (Spanish/English)

```
POST /api/v1/stemmer/stem
POST /api/v1/stemmer/normalize
POST /api/v1/stemmer/tokenize
POST /api/v1/stemmer/query
POST /api/v1/stemmer/detect
GET  /api/v1/search/stats
```

## Search

```
POST /api/v1/search                         # FTS5 full-text + stemmer
```

## Import

```
POST /api/v1/import/analyze                  # detect format (HTML/MD/Notion/etc.)
POST /api/v1/import/execute                  # convert to native format
GET  /api/v1/import/formats
```

## Databases (linked)

```
GET    /api/v1/databases
POST   /api/v1/databases
GET    /api/v1/databases/:id
PATCH  /api/v1/databases/:id
DELETE /api/v1/databases/:id
GET    /api/v1/databases/:id/views
```

## Structured views / rows

```
GET    /api/v1/structured/views             # list views in a database
POST   /api/v1/structured/views
GET    /api/v1/structured/views/:id
PATCH  /api/v1/structured/views/:id
DELETE /api/v1/structured/views/:id

GET    /api/v1/structured/rows
POST   /api/v1/structured/rows
PATCH  /api/v1/structured/rows/:id
DELETE /api/v1/structured/rows/:id
```

---

## Auth (v2.1.4 mode)

Default `AUTH_REQUIRED=true`. Endpoints PUBLIC in `middleware/auth.ts`:

| Path | Reason |
|---|---|
| `/health`, `/metrics` | health checks |
| `/api/v1/health`, `/api/v1/stats` | status |
| `/api/v1/register`, `/api/v1/auth/refresh` | bootstrap |
| `/api/v1/devices` | public list |
| `/api/v1/ai/embed`, `/api/v1/ai/tutor`, `/api/v1/ai` | AI public |
| `/api/v1/audio/transcribe`, `/api/v1/ocr/image`, `/api/v1/llm/embed` | ML inference |
| `/api/v1/flashcards/generate`, `/api/v1/pdf/diff` | utilities |
| `/api/v1/backup`, `/api/v1/secrets/test`, `/api/v1/update` | admin utilities |
| **Legacy routes** (public until frontend ships Bearer token): `/api/v1/flashcards`, `/api/v1/notes`, `/api/v1/subjects`, `/api/v1/events`, `/api/v1/tasks`, `/api/v1/cross-verify`, `/api/v1/recordings`, `/api/v1/sync`, `/api/v1/themes` |

`/api/v1/auth/revoke` is **NOT public** — it requires JWT to know which device to revoke.

---

## Error format

```json
{
  "error": "human-readable message",
  "code": "EC-AUTH-001",
  "category": "AUTH",
  "context": {...},
  "hint": "..."
}
```

Custom error handler in `server.ts` maps `AppError` fields directly to body.
