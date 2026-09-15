# M-NEXUS Error Codes

> **v2.1.4** — Sistema unificado de códigos `EC-{CATEGORÍA}-{NNN}` para backend (Node.js + Fastify + TypeScript).
> El frontend vanilla JS maneja `body.error`, `body.code`, `body.category`, `body.hint` directamente.

---

## ¿Qué es un error code?

Un **código de error** es un identificador único, estable y estructurado que el sistema asigna a cada error. Permite:

- **Búsqueda rápida**: `grep EC-NET-001` en logs / código / issues
- **Trazabilidad**: un cliente puede reportar "vi EC-VAULT-003" y el desarrollador sabe exactamente qué pasó
- **Monitoreo**: contar ocurrencias por código en logs
- **i18n**: mapear códigos a mensajes traducidos

---

## Convenciones de formato

```
EC-{CATEGORÍA}-{NNN}

CATEGORÍA: 3-7 letras mayúsculas (NET, AUTH, VAL, …)
NNN: 3 dígitos zero-padded (001, 042, …)
```

Ejemplos:
- `EC-AUTH-001` — Missing Authorization header
- `EC-VAL-013` — deviceId requerido
- `EC-LLM-001` — Ollama unavailable

---

## Categorías

| Code | Categoría | HTTP default | Descripción |
|---|---|---|---|
| `NET` | Network/HTTP | 502 | fetch, http calls fallando |
| `AUTH` | Auth/permissions | 401 | JWT, devices, middleware |
| `VAL` | Validation (input) | 400 | input schema inválido |
| `EVAL` | Vault eval | 500 | semantic search / eval |
| `INTERNAL` | Internal bugs | 500 | asserts / null deref |
| `LIFECYCLE` | Server lifecycle | 500 | startup, shutdown |
| `FS` | Filesystem | 500 | read, write, delete |
| `DB` | Database | 500 | sqlite, queries |
| `CFG` | Config | 500 | env vars, secrets |
| `CARD` | Flashcard | 400 | FSRS, create, delete |
| `EXT` | External service | 502 | upstream calls |
| `LLM` | LLM | 502 | Ollama, OpenRouter, Anthropic |
| `OCR` | OCR | 502 | Tesseract, Deepseek |
| `AUD` | Audio | 502 | Whisper |
| `EMB` | Embeddings | 502 | vectors |
| `SEC` | Secrets | 403 | AES-256-GCM |
| `BK` | Backup | 500 | ZIP, restore |
| `UP` | Update | 500 | GitHub Releases |
| `PROP` | Proposals | 400 | flashcard proposals |
| `QUIZ` | Quiz | 400 | adaptive quiz |
| `REL` | Relevance | 400 | cross-relevance |
| `CONFL` | Conflict | 409 | CRDT conflicts |
| `PUSH` | Push notifications | 500 | FCM, APNs |
| `STR` | Streaming | 500 | WS audio |
| `SYNC` | Sync | 409 | LWW, tombstones |
| `RATE` | Rate limit | 429 | per-user limits |

---

## Mapeo a HTTP status

Custom `setErrorHandler` en `server.ts` mapea `AppError.statusCode` → HTTP status. Defaults por categoría:

```
AUTH    → 401 (header faltante) / 403 (no permission) / 500 (internal)
VAL     → 400
NET     → 502 (upstream)
LLM     → 502
EMB     → 502
OCR     → 502
AUD     → 502
SEC     → 403
RATE    → 429
*       → 500
```

---

## Estructura del error

```ts
class AppError extends Error {
  readonly code: string;          // EC-XXX-NNN
  readonly category: ErrorCategory;
  readonly cause?: Error;
  readonly context: Record<string, unknown>;
  readonly timestamp: Date;
  readonly hint?: string;
  readonly statusCode: number;
}
```

El custom error handler en `server.ts` lo serializa así:

```json
{
  "error": "human-readable message",
  "code": "EC-AUTH-001",
  "category": "AUTH",
  "context": { "url": "/api/v1/...", "requestId": "req-1" },
  "hint": "Send 'Authorization: Bearer <token>'"
}
```

---

## Tabla de códigos frecuentes (backend)

### AUTH (v0.45+)

| Code | Mensaje | Hint |
|---|---|---|
| EC-AUTH-001 | Missing Authorization header | Send 'Authorization: Bearer <token>' |
| EC-AUTH-002 | Invalid Authorization header format | Format must be 'Bearer <token>' |
| EC-AUTH-003 | JWT verification failed | Refresh token via POST /api/v1/auth/refresh |
| EC-AUTH-004 | Device check failed | — |
| EC-AUTH-005 | Device not registered | Call POST /api/v1/auth/register first |
| EC-AUTH-007 | Token expired | Refresh token |
| EC-AUTH-008 | Token invalid | Refresh token |
| EC-AUTH-009 | signAccessToken failed | — |
| EC-AUTH-013 | Invalid deviceId | deviceId must be at least 3 characters |
| EC-AUTH-021 | deviceId requerido | Send { deviceId, deviceName, platform, … } |
| EC-AUTH-025 | Autenticación requerida | Send Authorization header |
| EC-AUTH-027 | Autenticación requerida | Send Authorization header |

### VAL

| Code | Mensaje |
|---|---|
| EC-VAL-013 | Invalid deviceId |
| EC-VAL-021 | deviceId requerido |
| EC-AUTH-021 | (legacy) deviceId requerido |

### LLM

| Code | Mensaje | Hint |
|---|---|---|
| EC-LLM-001 | ollamaAvailable check failed | Configure OLLAMA_BASE_URL |
| EC-LLM-003 | No LLM provider available | Configure OLLAMA_BASE_URL, OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY env vars |

### UP (Update)

| Code | Mensaje | Hint |
|---|---|---|
| EC-UP-013 | no update available | Already on the latest version |

---

## Cómo emitir un error

Usar los helpers en `utils/errorCodes.ts`:

```ts
import { E } from "../utils/errorCodes.js";

// Validation
throw E.val("EC-VAL-042", "userId debe ser string no vacío", {
  context: { received: typeof userId },
  hint: "Pass a non-empty string",
});

// Auth
throw E.auth("EC-AUTH-099", "Permiso insuficiente", {
  context: { userId, scope: req.auth?.scope },
  hint: "Contact admin to upgrade your scope",
});

// LLM
throw E.llm("EC-LLM-001", "Ollama unavailable", {
  context: { url: process.env.OLLAMA_BASE_URL },
  hint: "Start ollama with: ollama serve",
});
```

Categorías disponibles en `E`: `net`, `auth`, `val`, `eval`, `internal`, `lifecycle`, `fs`, `db`, `cfg`, `card`, `ext`, `llm`, `ocr`, `aud`, `emb`, `sec`, `bk`, `up`, `prop`, `quiz`, `rel`, `confl`, `push`, `str`, `sync`, `rate`.

---

## Cómo se loguean

El middleware de logging (`utils/log.ts`) usa **pino** (JSON estructurado). Cada error loguea:

```json
{
  "level": 50,
  "component": "auth",
  "code": "EC-AUTH-001",
  "category": "AUTH",
  "message": "Missing Authorization header",
  "context": { "url": "/api/v1/..." },
  "hint": "Send 'Authorization: Bearer <token>'",
  "stack": "AppError: ...",
  "durationMs": 2,
  "timestamp": "2026-09-15T..."
}
```

---

## Cómo extender

1. Decide la categoría (ver tabla arriba)
2. Crea un nuevo código `EC-{CAT}-{NNN}` (siguiente número libre en esa categoría)
3. Usa el helper `E.cat("EC-CAT-NNN", "msg", { hint, context })` o `throw new AppError(...)`
4. Documéntalo aquí en la tabla
5. Añade test si aplica

---

## Frontend handling

El frontend vanilla JS trata los errores así (`services/api.js`):

```js
try {
  const res = await fetch(...);
  if (!res.ok) {
    const err = await res.json();
    // err.code, err.category, err.hint disponibles
    throw new ApiError(err.error, err.code, res.status);
  }
} catch (e) {
  console.error(`[${e.code}] ${e.message}`);
}
```

Para mostrar al usuario: traducir `e.code` a mensaje i18n usando el helper `i18n.error(code)`.
