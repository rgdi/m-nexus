# M-NEXUS Logging Guide

> **v2.1.4** — Sistema unificado de logging estructurado.
> Backend: **pino** (JSON). Frontend: `console.*` + listeners opcionales.

---

## Visión general

M-NEXUS usa logging estructurado para poder buscar, agregar y alertar sobre eventos.

- **Backend (Node.js)**: `pino` — JSON estructurado, ideal para agregación
- **Frontend (vanilla JS)**: `console.debug/info/warn/error` + listeners opcionales vía `document.dispatchEvent`

---

## Estructura del log

### Backend (pino)

```json
{
  "level": 30,                    // 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
  "time": 1789487863833,         // unix ms
  "pid": 87123,
  "hostname": "cloud-compute-5d4px",
  "component": "auth",           // subsystem
  "code": "EC-AUTH-001",         // optional, for errors
  "message": "Missing Authorization header",
  "context": {...},              // optional
  "hint": "...",                 // optional, for errors
  "stack": "AppError: ...",      // only errors
  "durationMs": 2                // for op logs
}
```

### Frontend (console)

```js
console.debug("[sync_client] connected to ws://localhost:4100/ws/sync");
console.warn("[ai_tutor] Ollama unavailable, using fallback");
console.error("[file_attachments] failed to parse image:", e);
```

Convención: `[<component>] <message>`.

---

## Helpers disponibles

### Backend (`utils/log.ts`)

```ts
import { logger, logOp, logError, logLifecycle, logHttp } from "./utils/log.js";

// Child logger con contexto fijo
const log = logger.child({ component: "my-feature" });
log.info("starting");

// Operation log (debug)
logOp("auth", "user registered", true, { deviceId, name });

// Error log
logError("auth", {
  code: "EC-AUTH-001",
  category: "AUTH",
  message: "Missing Authorization header",
  context: { url, requestId },
  hint: "Send 'Authorization: Bearer <token>'",
});

// Lifecycle event (info)
logLifecycle("server", "started", { port: 4100 });

// HTTP request log (auto by fastify + pino)
```

### Backend error helpers (`utils/errorCodes.ts`)

```ts
import { E } from "./utils/errorCodes.js";

throw E.val("EC-VAL-042", "userId debe ser string", { context: {...}, hint: "..." });
throw E.auth("EC-AUTH-001", "Missing Authorization header", { ... });
throw E.llm("EC-LLM-001", "Ollama unavailable", { context: { url } });
throw E.card("EC-CARD-005", "FSRS state invalid", { context: { cardId } });
```

Categorías: `net`, `auth`, `val`, `eval`, `internal`, `lifecycle`, `fs`, `db`, `cfg`, `card`, `ext`, `llm`, `ocr`, `aud`, `emb`, `sec`, `bk`, `up`, `prop`, `quiz`, `rel`, `confl`, `push`, `str`, `sync`, `rate`.

### Frontend

```js
// Simple
console.debug("[component] message", { key: "value" });

// Custom event (for listeners)
document.dispatchEvent(new CustomEvent("app:error", {
  detail: { code: "EC-NET-001", message: "...", component: "api" }
}));
```

---

## Ver logs en desarrollo

### Backend

```bash
cd backend
LOG_LEVEL=debug npm run dev

# Filter by component
LOG_LEVEL=debug npm run dev | grep '"component":"auth"'

# Pretty-print JSON
LOG_LEVEL=info npm run dev | npx pino-pretty
```

### Frontend

```bash
# Browser DevTools console (F12)
# Filters:
#   - level:debug   (verbose)
#   - "[sync]"      (by component)

# Custom listener:
document.addEventListener("app:error", (e) => {
  console.warn("Caught app error:", e.detail);
});
```

---

## Ver logs en producción

### Backend (Docker)

```bash
# Live tail
docker logs -f mnexus-backend

# With pino-pretty
docker logs mnexus-backend | npx pino-pretty

# Filter
docker logs mnexus-backend 2>&1 | grep '"level":50' | npx pino-pretty
```

### Backend (systemd)

```bash
journalctl -u mnexus-backend -f
journalctl -u mnexus-backend --since "1 hour ago"
```

---

## Correlación frontend ↔ backend

Cada request HTTP tiene un `X-Request-Id` header. Backend lo loguea en cada línea relacionada.

Para correlacionar:
1. Frontend captura el `X-Request-Id` de la response
2. Logs backend tienen `requestId: "req-N"`
3. Match por ese ID

```js
// Frontend (api.js)
async function req(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", "X-Request-Id": crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  console.debug("[api]", method, path, res.status, "rid=", res.headers.get("X-Request-Id"));
  // ...
}
```

---

## Buenas prácticas

1. **Incluir contexto útil** — `deviceId`, `cardId`, `subjectId`, `requestId`, `url`
2. **Niveles correctos**:
   - `debug`: detalles de operación (entrada/salida)
   - `info`: eventos de lifecycle (start, stop, register)
   - `warn`: situaciones recuperables (retry, fallback)
   - `error`: errores que afectan al usuario
3. **No loguear secretos** — `password`, `token`, `refreshToken`, `accessToken` nunca
4. **Usar `hint` en errores** — guía accionable para el usuario
5. **No concatenar mensajes** — usar campos estructurados
6. **Latency budget** — loguear con `logOp` mide `durationMs` automáticamente

---

## Debugging de problemas comunes

### Backend no responde

```bash
# Check health
curl -fs http://localhost:4100/api/v1/health

# Check logs for startup errors
docker logs mnexus-backend 2>&1 | grep -E "level.:50|EC-"
```

### Frontend no detecta backend

```js
// DevTools console
import("/src/services/dataSource.js").then(m => m.detectBackend()).then(console.log);
// → false = backend offline (probablemente CORS o puerto)
// → true = backend OK
```

### LLM no responde

```bash
docker logs mnexus-backend 2>&1 | grep "EC-LLM"
# EC-LLM-001 = ollama unavailable
# → Check OLLAMA_BASE_URL, ollama serve
```

### Auth fails

```bash
docker logs mnexus-backend 2>&1 | grep "EC-AUTH"
# EC-AUTH-001 = Missing Authorization header
# EC-AUTH-003 = JWT verification failed → check JWT_SECRET
```

---

## Resumen de cambios v2.1.4

- Backend logging: `pino` con `logOp` + `logError` + `logLifecycle` + `logHttp` (auto)
- Frontend logging: `console.*` con convención `[component] message`
- Error format: `{error, code, category, context, hint}` mapeado por custom `setErrorHandler`
- Correlación: `X-Request-Id` header + `requestId` en cada log line
