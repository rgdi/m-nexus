# M-NEXUS Backend (v2.23.3)

Backend Node.js (Fastify + TypeScript) that serves:

- **Web app** (vanilla JS frontend served from `frontend/`)
- **Standalone Android/iOS app** (device registration, sync, push, vault)
- **Installer** (`install.sh`)
- **Multi-server clusters** — peers discover each other via Redis (see
  [docs/SCALING.md](../docs/SCALING.md))

Latest release: **v2.23.3** — SHA-256 verified installs, systemd / Docker / auto-upgrade
in the installer, **multi-device subjects sync**, **subject templates** (ESO /
Bachiller / Medicina / Enfermería / Ingeniería / Derecho / ADE / Veterinaria / custom),
**dynamic subjects CRUD** (no fake seed), 977 backend tests passing.

---

## Stack

- **Node.js ≥ 20** (recommended 22)
- **Fastify 5** + TypeScript strict
- **CRDT** (custom vector clocks + field-level LWW, plus Yjs protocol over WS)
- **Storage**: JSON files (default) or Postgres / Mongo (multi-server)
- **Auth**: JWT (HS256) — 12-char minimum password, refresh-token rotation
- **Real-time**: WebSocket at `/ws/sync` + Yjs WS at `/api/v1/crdt/ws/:notePath`
- **External adapters**: Ollama, OpenRouter, OpenAI, Tesseract OCR, Whisper STT

## Quick start

```bash
node --version   # v20+ recommended v22

# First-time install
npm ci

# Dev server (port 4100 — the frontend expects this)
PORT=4100 npx tsx src/server.ts

# Tests (977 vitest tests)
./node_modules/.bin/vitest run --exclude="**/syncE2E.test.ts"

# Typecheck (strict, 0 errors)
npx tsc --noEmit

# Watch mode dev
npx tsx watch src/server.ts
```

Server listens at `http://localhost:4100`. Frontend connects via:

- REST: `http://localhost:4100/api/v1/*`
- WebSocket sync: `ws://localhost:4100/ws/sync`
- Cluster peers: `http://localhost:4100/api/v1/cluster/peers`
- Static assets (GLB models, webview bundle when served by backend):
  `http://localhost:4100/models/*`, `http://localhost:4100/*`
- Health check: `http://localhost:4100/api/v1/health`

## Environment variables

| Var | Default | Description |
|---|---|---|
| `PORT` | 4000 | Listen port (frontend expects 4100) |
| `HOST` | 0.0.0.0 | Network interface |
| `DATA_DIR` | `./data` | Where notes / flashcards / etc live |
| `JWT_SECRET` | (required in prod) | HS256 secret — fail-fast on weak values |
| `WS_AUTH_REQUIRED` | 0 | If `1`, WS requires `?token=<jwt>` |
| `TESSERACT_LANGS` | `spa+eng` | Lang packs for OCR handwriting |
| `MOCK_OLLAMA` / `MOCK_OPENROUTER` / `MOCK_LLM` | 0 | Use mock for tests |
| `LOG_LEVEL` | info | pino level: trace / debug / info / warn / error |
| `MNEXUS_NOTIFICATIONS_FILE` | `data/notifications.json` | Override path for Android notification capture |
| `INSTANCE_ID` | hostname | Stable per-node ID for clustering |
| `NODE_ROLE` | `auto` | `auto` / `leader` / `worker` |
| `NODE_REGION` | `local` | Used by the client UI server badge |
| `CLUSTER_REDIS` | 0 | `0` = single node, `1` = use Redis for peer registry |
| `REDIS_URL` | — | `redis://10.0.0.1:6379` (when `CLUSTER_REDIS=1`) |
| `PEER_TTL` | 60 | Seconds before a peer is considered dead |
| `PEER_TICK` | 15 | Heartbeat interval (s) |
| `DATABASE_URL` | — | Postgres / Mongo URL (replaces JSON files when set) |
| `STORAGE_BACKEND` | json | `json` / `postgres` / `mongo` |
| `PUBLIC_URL` | `http://localhost:4100` | What peers register as their public address |
| `LEADER_ONLY_MIGRATIONS` | 1 | Only the elected leader runs schema migrations |
| `DISTRIBUTED_OCR` | 0 | If 1, OCR jobs are scheduled across workers, not just leader |

Production baseline:
```bash
JWT_SECRET=$(openssl rand -hex 32) \
LOG_LEVEL=warn \
CLUSTER_REDIS=1 REDIS_URL=redis://redis.internal:6379 \
INSTANCE_ID=$(hostname) \
PORT=4100 node dist/server.js
```

## Architecture (one node)

```
HTTP /api/v1/* ─┐
WS    /ws/sync  ├─► Fastify ─► middleware/auth ─► routes/* ─► services/*
WS    /crdt/ws  ┘                                       ├─► JSON file store
                                                        ├─► Redis (peer registry, leader lock)
                                                        ├─► external: ollama / openai / tesseract / whisper
                                                        └─► logger (pino)
```

For multi-server details, see [docs/SCALING.md](../docs/SCALING.md) and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Routes (v2.23.3 — 80 files, 987 tests, 0 TS errors)

| Group | Examples |
|---|---|
| `/api/v1/auth/*` | `POST /register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/setup`, `GET /auth/me` |
| `/api/v1/subjects/*` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `PATCH /reorder`, `POST /bulk`, `DELETE /` (nuke all) |
| `/api/v1/notes/*` | `GET /`, `POST /`, `PATCH /:id` (CRDT vector-clocked) |
| `/api/v1/flashcards/*` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /generate`, `POST /answer` (FSRS-4.5) |
| `/api/v1/calendar/*` | `GET /events`, `POST /events`, `PATCH /events/:id`, `DELETE /events/:id` |
| `/api/v1/tasks/*` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` |
| `/api/v1/llm/*` | `POST /chat`, `POST /embed`, `POST /transcribe`, `POST /ocr/image`, `POST /handwriting/recognize` |
| `/api/v1/glb-models/*` | `GET /`, `POST /upload` (multipart, 50 MB), `DELETE /:name` |
| `/api/v1/cluster/*` | `GET /peers`, `POST /heartbeat`, `POST /promote`, `POST /demote` (multi-server) |
| `/api/v1/notifications/*` | `POST /ingest`, `GET /`, `DELETE /:id` (Android Notification Listener) |
| `/api/v1/sync/*` | `POST /replay`, `GET /metrics` |
| `/ws/sync` | WS broadcast + per-device CRDT sync |

Full reference: [docs/API.md](../docs/API.md). Error codes: [docs/ERROR_CODES.md](../docs/ERROR_CODES.md).

## Storage

Default: JSON files in `DATA_DIR/` (subjects.json, notes.json, etc).

When `CLUSTER_REDIS=1` AND `DATABASE_URL` is set, the backend uses Postgres (or Mongo
when `STORAGE_BACKEND=mongo`) and Redis for peer registry + leader lock. Both paths
are 100% backwards compatible — a single-node JSON install does not need Redis or a DB.

Schema migrations live in `migrations/` and run on startup (or only on the leader if
`LEADER_ONLY_MIGRATIONS=1`).

## Public paths (no auth, accessed by the Android app + WebView)

```
/api/v1/devices/register          POST   (web or Android app)
/api/v1/sync/replay               POST   (v2.19.0)
/api/v1/sync/metrics              GET    (admin dashboard)
/api/v1/notifications/ingest      POST   (v2.21.0, Android Listener)
/api/v1/flashcards/generate       POST
/api/v1/audio/transcribe          POST
/api/v1/ocr/image                 POST
/api/v1/llm/embed                 POST
/api/v1/upload/init|chunk|complete POST  (file uploads)
/ws/sync                          WS
```

See [`middleware/auth.ts`](src/middleware/auth.ts) for the canonical list.

## Multi-server (v2.23.3+)

When `CLUSTER_REDIS=1`, on startup the node:

1. Picks an `INSTANCE_ID` (env or hostname).
2. Sends a heartbeat to `mnexus:peers:${INSTANCE_ID}` every `PEER_TICK` seconds.
3. Exposes `GET /api/v1/cluster/peers`.
4. Tries to acquire the leader lock at `mnexus:leader`. If it gets it, runs
   leader-only scheduled jobs (OCR queue, backup, notifications drain).

The client receives peer updates via WS broadcast `cluster:peers`. Failover
between peers is automatic; the client UI badge shows the current node and lets
the user force-pick.

See [docs/SCALING.md](../docs/SCALING.md) for k8s manifests, Helm chart, advanced
load-balancing configurations.

## Testing

```bash
./node_modules/.bin/vitest run        # 977 tests, all in <30 s on CI
npx tsc --noEmit                       # 0 errors
```

E2E against the Capacitor APK + real Chrome (needs an Android emulator):
```bash
./node_modules/.bin/vitest run tests/syncE2E.test.ts --exclude="**/syncE2E.test.ts" --run
```

Performance load test (k6): `tests/k6/scaling.js` — verifies throughput up to
4 000 concurrent users on a 5-node cluster.

## Linting / formatting

- TypeScript strict, no `any` unless commented with reason
- ESLint with `@typescript-eslint/recommended`
- Prettier (2-space indent, single quotes, semi)
- Tests must be real (not mock stubs) — see CONTRIBUTING for details

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) (TBD in v2.24.0). In the meantime:

- Add new routes under `src/routes/` + tests under `tests/`
- Add new services under `src/services/`
- Keep middleware dependency-light (zero business logic)
- New env vars documented in `docs/API.md` and this README
- Run `npx tsc --noEmit` and `vitest run` before pushing

## License

MIT — see [LICENSE](../LICENSE).
