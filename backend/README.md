# M-NEXUS Backend

Backend Node.js (Fastify 5 + TypeScript) que da servicios a:
- **App standalone** (registro de devices, sync, push, vault, etc)
- **Instalador** (`install/install.sh`)

**v0.45.0** — Sistema de error codes unificado con el frontend.

## v0.45.0

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

# Correr (en dev, puerto 3000)
npm run dev | pino-pretty

# Correr (en prod)
MNEXUS_PORT=3000 node dist/index.js
```

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
```

Ver [`docs/LOGGING.md`](../docs/LOGGING.md) para opciones de agregación (Loki, Elasticsearch, etc).

## Tests

```bash
npm test              # 245 tests
npm test -- --watch   # watch mode
```
