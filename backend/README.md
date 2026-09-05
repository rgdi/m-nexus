# M-NEXUS Backend

Backend Node.js (Fastify 5 + TypeScript) que da servicios a:
- **Obsidian plugin** (sincronización, propuestas IA, transcripción)
- **Companion app** (registro de devices, vault detection, push notifications)
- **Instalador** (`install/install.sh`)

## v0.35.0

## Quick start

```bash
# Requisitos: Node.js >= 22
node --version

# Instalar deps
npm install

# Build
npm run build

# Tests (245 tests)
npm test

# Correr (en dev)
npm run dev

# Correr (en prod, puerto 8787)
MNEXUS_PORT=8787 node dist/index.js
```

## Estructura

```
backend/
├── src/
│   ├── server.ts            # Fastify app + plugins + routes registration
│   ├── cli.ts               # CLI entry point
│   ├── config.ts            # Config (env vars, defaults)
│   ├── version.ts           # Versión del backend
│   ├── auth/                # JWT, auth middleware
│   ├── middleware/          # Custom middlewares (auth, rate limit, etc)
│   ├── routes/              # REST API endpoints (40+)
│   ├── services/            # Lógica de negocio
│   │   ├── secretManager.ts     # AES-256-GCM
│   │   ├── conflictResolver.ts  # Vector clocks per-field
│   │   ├── structuredNotes.ts   # Notion-style databases
│   │   ├── llm.ts               # DeepSeek/OpenAI/Ollama
│   │   ├── whisper.ts           # Audio transcription
│   │   ├── deepseekOcrV2.ts     # OCR
│   │   ├── embeddings.ts        # Vector embeddings
│   │   ├── adaptiveQuiz.ts      # Quiz adaptativo
│   │   ├── proposals.ts         # Flashcard proposals
│   │   ├── crossRelevance.ts    # Cross-note relevance
│   │   ├── pushNotifications.ts # Push to devices
│   │   └── ... (más)
│   ├── workers/             # Async workers (FSRS queue, etc)
│   ├── types/               # TypeScript types
│   └── utils/               # Helpers (logger, metrics, hash, etc)
└── tests/                   # 245 tests (vitest)
    ├── secretManager.test.ts
    ├── conflictResolver.test.ts
    ├── structuredNotes.test.ts
    ├── upload.test.ts
    ├── rollback.test.ts
    ├── fsrsQueue.test.ts
    └── ... (más)
```

## Configuración (env vars)

| Variable | Default | Descripción |
|---|---|---|
| `MNEXUS_PORT` | `8787` | Puerto HTTP |
| `MNEXUS_HOST` | `0.0.0.0` | Host |
| `MNEXUS_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `MNEXUS_DATA_DIR` | `/var/lib/mnexus` | Datos persistentes (SQLite, uploads, backups) |
| `MNEXUS_UPLOAD_DIR` | `/var/lib/mnexus/uploads` | Chunks de upload |
| `MNEXUS_BACKUP_DIR` | `/var/lib/mnexus/backups` | Backups |
| `MNEXUS_BACKUP_REGISTRY` | `/var/lib/mnexus/backups/backups.json` | Registry |
| `MNEXUS_REGISTRY_PATH` | (idem) | Override del registry path |
| `MNEXUS_SECRET_MASTER_KEY` | (auto) | Master key 64 hex chars (AES-256) |
| `MNEXUS_OPENAI_API_KEY` | (none) | OpenAI key (alternativa a SecretManager) |
| `MNEXUS_DEEPSEEK_API_KEY` | (none) | DeepSeek key |
| `MNEXUS_OLLAMA_URL` | `http://localhost:11434` | Ollama URL |
| `MNEXUS_LLM_DEFAULT` | `deepseek` | LLM por defecto |
| `MNEXUS_DISABLE_AUTH` | `false` | Deshabilitar auth (solo dev) |
| `MNEXUS_CORS_ORIGIN` | `*` | CORS origin |

## Servicios clave (v0.33-v0.35)

### SecretManager (`src/services/secretManager.ts`)
AES-256-GCM, 96-bit IV, 16-byte salt, 32-byte key. Cifrado de API keys (OpenAI, DeepSeek, etc).

```ts
import { getSecretManager } from './services/secretManager';
const sm = getSecretManager();
await sm.set('openai_api_key', 'sk-...');
const value = await sm.get('openai_api_key');
```

### ConflictResolver (`src/services/conflictResolver.ts`)
Vector clocks per-field, LWW con tie-break por ts+deviceId.

```ts
import { resolveNote } from './services/conflictResolver';
const { resolved, report } = resolveNote(localNote, remoteNote);
```

### StructuredNotes (`src/services/structuredNotes.ts`)
Notion-style databases con typed properties, fórmulas, views, conflict detection.

```ts
import { DatabaseSchema, validatePropertyValue } from './services/structuredNotes';
```

### FSRS Queue (`src/workers/fsrsQueue.ts`)
Async worker queue para FSRS evaluations. Backoff exponencial, status polling.

```ts
import { fsrsQueue } from './workers/fsrsQueue';
const jobId = fsrsQueue.enqueue({ userId, cardIds });
const result = await fsrsQueue.waitFor(jobId);
```

## Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific file
npx vitest run tests/secretManager.test.ts
```

**Total: 245 tests** cubriendo:
- 11 secretManager
- 17 conflictResolver
- 24 structuredNotes
- 11 upload
- 6 rollback
- 8 fsrsQueue
- 21 auth
- 21 api
- 19 updateChecker
- 18 v25Features
- 11 backupRoutes
- 13 cache
- 11 aiRoutes
- 5 streamingTranscription
- 13 pushNotifications
- 5 integration
- 4 ws
- y más...

## API

Ver [docs/API.md](../docs/API.md) para la documentación completa de los 73+ endpoints.

## Deploy

### Docker (recomendado)

```bash
docker run -d \
  --name mnexus \
  -p 8787:8787 \
  -v /var/lib/mnexus:/data \
  -e MNEXUS_SECRET_MASTER_KEY=$(openssl rand -hex 32) \
  ghcr.io/rgdi/m-nexus-backend:v0.35.0
```

### Manual (systemd)

```bash
# Copiar
sudo mkdir -p /opt/mnexus
sudo cp -r dist package.json /opt/mnexus/
cd /opt/mnexus
sudo npm install --production

# Crear servicio
sudo tee /etc/systemd/system/mnexus.service << EOF
[Unit]
Description=M-NEXUS Backend
After=network.target

[Service]
Type=simple
User=mnexus
WorkingDirectory=/opt/mnexus
Environment="MNEXUS_PORT=8787"
Environment="MNEXUS_DATA_DIR=/var/lib/mnexus"
Environment="MNEXUS_SECRET_MASTER_KEY=$(openssl rand -hex 32)"
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mnexus
sudo systemctl status mnexus
```

### Via install.sh (más fácil)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --component=backend --tag=stable
```

## Backups

Los backups automáticos se guardan en `/var/lib/mnexus/backups/` antes de updates.

Para crear un backup manual:
```bash
curl -X POST http://localhost:8787/api/v1/rollback/create
```

Para restaurar:
```bash
curl -X POST http://localhost:8787/api/v1/rollback/restore \
  -H "Content-Type: application/json" \
  -d '{"backupId":"backup-1693838400","confirm":true}'
```

## Logs

```bash
# systemd
journalctl -u mnexus -f

# Docker
docker logs -f mnexus

# Standalone
tail -f /var/log/mnexus.log
```

Niveles: `debug` (verbose), `info` (default), `warn`, `error`.

## Métricas

```bash
# Prometheus
curl http://localhost:8787/metrics
```

Incluye:
- `mnexus_http_requests_total` — counter de requests
- `mnexus_http_request_duration_seconds` — histograma de latencia
- `mnexus_fsrs_jobs_*` — jobs queued/running/done/failed
- `mnexus_secret_*` — operaciones de secret manager
- `mnexus_upload_*` — uploads en progreso
- `mnexus_llm_tokens_total` — tokens consumidos por LLM

## Troubleshooting

| Problema | Solución |
|---|---|
| Puerto ocupado | `lsof -i:8787` o `MNEXUS_PORT=8888` |
| Auth falla | `MNEXUS_DISABLE_AUTH=true` para dev |
| Disco lleno | Limpiar `/var/lib/mnexus/uploads/final/` |
| Secret descifrado falla | `MNEXUS_SECRET_MASTER_KEY` cambió. Restaurar de backup o rotar. |
| SQLite locked | `rm /var/lib/mnexus/*.db-wal /var/lib/mnexus/*.db-shm` (con servicio apagado) |
| LLM timeout | Aumentar `MNEXUS_LLM_TIMEOUT_MS` |

## Security

- JWT para auth (HS256, secret en `MNEXUS_AUTH_SECRET`)
- Rate limiting (10 req/s default) via `@fastify/rate-limit`
- CORS configurable
- Secret Manager AES-256-GCM para API keys
- Audit log en `/api/v1/audit`
- HTTPS recomendado en producción (reverse proxy: nginx, caddy)

## License

MIT
