# M-NEXUS Logging Guide

> **v0.45+** — Sistema unificado de logging estructurado para frontend (Flutter) y backend (Node.js).

## Índice

1. [Visión general](#visión-general)
2. [Estructura del log](#estructura-del-log)
3. [Helpers disponibles](#helpers-disponibles)
4. [Ver logs en desarrollo](#ver-logs-en-desarrollo)
5. [Ver logs en Android (producción)](#ver-logs-en-android-producción)
6. [Ver logs del backend en producción](#ver-logs-del-backend-en-producción)
7. [Correlación frontend ↔ backend](#correlación-frontend--backend)
8. [Buenas prácticas](#buenas-prácticas)
9. [Debugging de problemas comunes](#debugging-de-problemas-comunes)

---

## Visión general

M-NEXUS usa **logging estructurado** en ambas plataformas:

- **Frontend (Flutter)**: `dart:developer` log + `print` (interceptable por `adb logcat`).
- **Backend (Node.js)**: `pino` (JSON estructurado, ideal para agregación).

Todos los logs comparten los **mismos campos clave**, lo que permite hacer queries consistentes:

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `level` | string | Nivel: `debug`, `info`, `warn`, `error` | `"info"` |
| `time` / `timestamp` | ISO-8601 | Momento del log | `"2026-09-07T14:23:11.456Z"` |
| `component` | string | Componente que emite (`vault`, `auth`, `llm`, ...) | `"vault"` |
| `code` | string | Código de error si aplica (`EC-XXX-NNN`) | `"EC-VAULT-003"` |
| `category` | string | Categoría del error | `"VAULT"` |
| `message` | string | Mensaje legible para humanos | `"No se pudo leer la nota"` |
| `context` | object | Metadata adicional | `{"path": "...", "size": 1234}` |
| `hint` | string | Sugerencia para resolver | `"Check storage permissions"` |
| `durationMs` | number | Duración de la operación (si aplica) | `1234` |
| `error` / `cause` | string | Mensaje de la causa original | `"FileSystemException: ..."` |
| `stack` | string | Stack trace (solo errores) | `"#0 ..."` |
| `requestId` | string | ID de correlación (solo backend) | `"req_1725716591456_x8k2p9"` |

## Estructura del log

### Frontend

```json
{
  "level": "ERROR",
  "time": "2026-09-07T14:23:11.456Z",
  "message": "[EC-VAULT-003] No se pudo leer la nota",
  "component": "vault",
  "code": "EC-VAULT-003",
  "category": "VAULT",
  "context": {
    "path": "/vault/notas/abc.md",
    "size": 1234
  },
  "hint": "Verifica permisos en Settings",
  "error": "FileSystemException: Cannot open file",
  "stack": "#0 _readNote (package:mnexus_app/services/vault_service.dart:42:7)\n..."
}
```

### Backend

```json
{
  "level": 50,
  "time": "2026-09-07T14:23:11.456Z",
  "msg": "[EC-LLM-005] Ollama API error",
  "component": "llm",
  "code": "EC-LLM-005",
  "category": "LLM",
  "message": "Ollama API error",
  "cause": "fetch failed",
  "context": {
    "status": 500,
    "durationMs": 1234,
    "model": "llama3"
  },
  "hint": "Check Ollama is running and model is available",
  "stack": "Error: fetch failed\n    at ...\n",
  "durationMs": 1234,
  "requestId": "req_1725716591456_x8k2p9"
}
```

## Helpers disponibles

### Frontend (Dart)

```dart
import 'package:mnexus_app/services/logger.dart';

// Log genérico
logger.info('app', 'started');
logger.warn('vault', 'low disk space');
logger.error('vault', 'failed', context: { 'path': path });

// Log de error estructurado (desde AppError)
logger.logAppError(appError);

// Log de platform channel
logger.logPlatform('calendar', 'getEvents', error: e);

// Log de lifecycle
logger.logLifecycle('vault', 'initialized', extra: { 'count': 100 });

// Log de operación
logger.logOp('vault', 'read', success: true, context: { 'path': path });
```

Ver `app/lib/services/logger.dart` para la API completa.

### Backend (TypeScript)

```typescript
import { logger, logOp, logError, logLifecycle, logNetwork, logPlatform } from '../utils/log.js';

// Log genérico
logger.info({ component: 'auth' }, 'user registered');
logger.warn({ component: 'vault' }, 'low disk space');
logger.error({ component: 'vault', code: 'EC-VAULT-003' }, 'failed');

// Log de error estructurado (con AppError)
logError('llm', appError); // appError es un AppError

// Log de operación
logOp('vault', 'read', true, { path: '/vault/notas/abc.md' });

// Log de red
logNetwork('POST', 'https://api.openrouter.ai/v1/chat', {
  statusCode: 200,
  durationMs: 1234,
});

// Log de lifecycle
logLifecycle('server', 'starting', { port: 3000 });

// Log de platform
logPlatform('fcm', 'sendNotification', true);
```

## Ver logs en desarrollo

### Frontend

```bash
# Opción 1: flutter run con output detallado
flutter run --verbose 2>&1 | grep -E "(component|code)"

# Opción 2: dart:developer log (necesita DevTools)
flutter run --start-paused
# Abrir DevTools > Logging tab
```

### Backend

```bash
# Pretty printing (necesita pino-pretty)
npm install -g pino-pretty
npm run dev | pino-pretty

# Raw JSON
npm run dev

# Filtrar por código
npm run dev 2>&1 | grep "EC-LLM"

# Filtrar por componente
npm run dev 2>&1 | grep '"component":"auth"'

# Filtrar solo errores
npm run dev 2>&1 | grep '"level":50'
```

## Ver logs en Android (producción)

### Con `adb logcat`

```bash
# Todos los logs de la app
adb logcat | grep "mnexus"

# Solo errores de la app
adb logcat *:E | grep "mnexus"

# Filtrar por código de error
adb logcat | grep "EC-VAULT"

# Filtrar por componente
adb logcat | grep "component.*vault"

# Con contexto (más verboso)
adb logcat -v threadtime | grep "mnexus"
```

### Sin dispositivo (con APK)

```bash
# Desde el dispositivo con Termux
adb shell
logcat -d -s flutter | tail -100  # últimos 100 logs de Flutter
```

### Logs persistentes en archivo

```dart
// En logger.dart, opcionalmente escribe a un archivo
final logFile = File('${(await getApplicationDocumentsDirectory()).path}/mnexus.log');
await logFile.writeAsString('$logEntry\n', mode: FileMode.append);
```

## Ver logs del backend en producción

### Docker

```bash
# Logs del contenedor
docker logs -f mnexus-backend

# Filtrar por código
docker logs mnexus-backend 2>&1 | grep "EC-LLM"

# Últimas N líneas
docker logs --tail 100 mnexus-backend
```

### systemd

```bash
journalctl -u mnexus-backend -f
journalctl -u mnexus-backend -n 100
journalctl -u mnexus-backend --since "1 hour ago"
```

### Agregación con Loki / Elasticsearch

Los logs son JSON estructurado, así que se pueden ingestar directamente:

```yaml
# docker-compose ejemplo con Loki
services:
  mnexus-backend:
    # ... tu config
  
  loki:
    image: grafana/loki:latest
    # ...
  
  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/log/mnexus:/var/log/mnexus
```

Consultas útiles en Grafana:

```logql
{app="mnexus"} | json | code=~"EC-LLM-.*"
{app="mnexus"} | json | level="error" | category="LLM"
{app="mnexus"} | json | requestId="req_1725716591456_x8k2p9"
```

## Correlación frontend ↔ backend

Cuando el frontend hace una request al backend, se loguea:

**Frontend (envía):**

```json
{
  "level": "DEBUG",
  "message": "→ POST /api/v1/llm/chat",
  "component": "backend_client",
  "context": { "url": "...", "bodyLen": 1234 }
}
```

**Backend (recibe):**

```json
{
  "level": 20,
  "msg": "→ POST /api/v1/llm/chat",
  "requestId": "req_1725716591456_x8k2p9"
}
```

**Backend (responde):**

```json
{
  "level": 30,
  "msg": "← POST /api/v1/llm/chat 200 (1234ms)",
  "requestId": "req_1725716591456_x8k2p9"
}
```

El frontend puede leer el `requestId` de la respuesta de error del backend y mostrarlo al usuario para que pueda reportarlo. Ejemplo:

```dart
try {
  final res = await backend.post('/api/v1/llm/chat', body: ...);
} on AppError catch (e) {
  // Mostrar: "Error EC-LLM-005 (requestId: req_1725716591456_x8k2p9)"
  showError('${e.code} (requestId: ${e.context["requestId"]})');
}
```

## Buenas prácticas

### ✓ DO

- **Incluir contexto útil**: `path`, `size`, `deviceId`, `requestId`, `durationMs`.
- **Usar `safeCall` / `safeCallAsync`** en lugar de try-catch manuales.
- **Llamar al constructor semántico correcto**: `E.llm()`, `AppError.vault()`, no `new AppError()` a mano.
- **Añadir un `hint`** cuando sepas cómo resolver el error.
- **Loguear operaciones exitosas con duración**: `logOp("vault", "read", true, { durationMs: 50 })`.
- **Sanitizar antes de loguear**: nunca loguees tokens, passwords o PII sin redactar.

### ✗ DON'T

- **No usar `print()` directo** — usa `logger.info()` / `logger.debug()`.
- **No loguees binarios**: paths, IDs, tamaños, pero no el contenido de archivos.
- **No atrapar errores sin loguearlos**: si haces `try-catch`, deja que `safeCall` lo loguee.
- **No inventar códigos**: añade a `ERROR_CODES.md` antes de usarlos.
- **No loguees secretos**: el backend ya redacta `*.password`, `*.token`, `*.apiKey` automáticamente.

## Debugging de problemas comunes

### "El log no aparece en logcat"

```bash
# Verifica que el tag es correcto
adb logcat -s flutter:V
# o
adb logcat -s "mnexus:V"
```

### "El log tiene campos undefined"

Probablemente usaste `print` en vez de `logger.*`. Cambia:

```dart
print('vault load failed');  // ✗
logger.error('vault', 'load failed', context: { 'path': path });  // ✓
```

### "El backend no loguea con formato bonito"

```bash
# Instala pino-pretty
npm install --save-dev pino-pretty
# Pipea la salida
node --import tsx src/server.ts | pino-pretty
```

### "Quiero buscar un error específico en producción"

```bash
# Frontend (logcat)
adb logcat | grep "EC-LLM-005"

# Backend (journalctl)
journalctl -u mnexus-backend | grep "EC-LLM-005"

# Backend (Docker)
docker logs mnexus-backend 2>&1 | grep "EC-LLM-005"
```

### "Quiero ver el requestId en el frontend"

El backend incluye `requestId` en TODAS las respuestas de error. Asegúrate de que tu `BackendClient` lo extrae:

```dart
final res = await backend.post('/api/v1/llm/chat', body: body);
if (res.statusCode >= 400) {
  final body = jsonDecode(res.body);
  throw AppError.fromResponse(body); // Incluye requestId en context
}
```

### "Necesito desactivar un log verboso"

Frontend:

```dart
// logger.dart
import 'package:flutter/foundation.dart';
final isVerbose = kDebugMode;
if (isVerbose) logger.debug('...');
```

Backend:

```bash
# Bajar nivel
LOG_LEVEL=warn npm run dev
```

---

**Próximas versiones:**

- [ ] v0.46: OpenTelemetry tracing (correlación automática frontend ↔ backend)
- [ ] v0.47: UI de "Reportar bug" que copia logs al portapapeles
- [ ] v0.48: Sampling adaptativo (logs menos verbosos en producción con tráfico alto)
