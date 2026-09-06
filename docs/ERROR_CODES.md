# M-NEXUS Error Codes

> **v0.45+** — Sistema unificado de códigos de error `EC-{CATEGORÍA}-{NNN}` para frontend (Flutter) y backend (Node.js).

## Índice

1. [¿Qué es un error code?](#qué-es-un-error-code)
2. [Convenciones de formato](#convenciones-de-formato)
3. [Categorías](#categorías)
4. [Mapeo a HTTP status](#mapeo-a-http-status)
5. [Estructura del error](#estructura-del-error)
6. [Tabla completa de códigos (frontend)](#tabla-completa-de-códigos-frontend)
7. [Tabla completa de códigos (backend)](#tabla-completa-de-códigos-backend)
8. [Cómo emitir un error](#cómo-emitir-un-error)
9. [Cómo se loguean](#cómo-se-loguean)
10. [Cómo extender](#cómo-extender)

---

## ¿Qué es un error code?

Un **código de error** es un identificador único, estable y estructurado que el sistema asigna a cada error que puede ocurrir. Permite:

- **Búsqueda rápida**: `grep EC-NET-001` en logs / código / issues
- **Trazabilidad**: un cliente puede reportar "vi EC-VAULT-003" y el desarrollador sabe exactamente qué pasó
- **Internacionalización**: el código es inmutable; el mensaje traducible va aparte
- **Aggregación**: contar `EC-LLM-005` en producción para detectar una regresión

## Convenciones de formato

```
EC-{CATEGORÍA}-{NNN}
│    │           │
│    │           └─ Número de secuencia (001-999, dentro de la categoría)
│    └───────────── Código de 3 letras de la categoría (mayúsculas)
└────────────────── Prefijo fijo "EC" (Error Code)
```

**Reglas:**

- Siempre en **mayúsculas**.
- Categoría de **3 letras** (NET, FS, AUTH, ...).
- Número con **3 dígitos** zero-padded.
- Sin espacios ni caracteres especiales.
- **Inmutable**: un código, una vez publicado, NUNCA cambia de significado.
  - Si un código ya no aplica → se **depreca** (marcado en tabla) y se crea uno nuevo.
- **No reutilizar** números de códigos deprecados.

## Categorías

### Compartidas (frontend + backend)

| Código | Nombre | Descripción | Frontend | Backend |
|--------|--------|-------------|----------|---------|
| `NET` | Network | Errores HTTP/fetch, conexión rechazada, timeout | ✓ | ✓ |
| `FS` | Filesystem | Errores de lectura/escritura/listado de archivos | ✓ | ✓ |
| `DB` | Database | Errores de SQLite/queries, conexiones | ✓ | ✓ |
| `AUTH` | Auth | JWT, device registration, permisos | ✓ | ✓ |
| `CFG` | Configuration | Settings inválidos, env vars faltantes | ✓ | ✓ |
| `LIFECYCLE` | Lifecycle | Init/dispose de servicios, startup/shutdown | ✓ | ✓ |
| `INTERNAL` | Internal | Bugs, asserts, "esto no debería pasar" | — | ✓ |

### Solo frontend (Flutter)

| Código | Nombre | Descripción |
|--------|--------|-------------|
| `CAL` | Calendar | Errores del calendario de Android (Add-on) |
| `PLAT` | Platform | Platform channels de Android (vibración, info, etc) |
| `VAULT` | Vault | Operaciones de vault (lectura, listado, búsqueda) |
| `CARD` | Flashcard | Operaciones de flashcards (crear, borrar, FSRS) |
| `NOTE` | Note | Operaciones de notas (vista, edición, guardado) |
| `UP` | Update | Auto-update, descarga de APK, instalación |
| `UI` | UI | Errores de renderizado / montado de widgets |

### Solo backend (Node.js)

| Código | Nombre | Descripción |
|--------|--------|-------------|
| `VAL` | Validation | Errores de validación de input (schema, tipos) |
| `EXT` | External | Upstream genérico (cualquier servicio externo) |
| `LLM` | LLM | LLM específicos (Ollama, OpenRouter) |
| `OCR` | OCR | OCR específicos (Tesseract, Deepseek) |
| `AUD` | Audio | Whisper / audio / transcripción |
| `EMB` | Embeddings | Generación de embeddings |
| `SEC` | Secrets | Secret manager, encryption, master key |
| `BK` | Backup | Backup index, restore, ZIPs |
| `SYNC` | Sync | Sync LWW, vector clocks |
| `CONFL` | Conflict | Resolución de conflictos |
| `PROP` | Proposals | Generador de propuestas |
| `PUSH` | Push | Push notifications (FCM) |
| `QUIZ` | Quiz | Adaptive quiz |
| `STR` | Structured | Structured notes (Notion-style) |
| `REL` | Relevance | Cross-relevance analyzer |
| `WS` | WebSocket | WebSocket errors |
| `RATE` | Rate limit | Rate limit exceeded |
| `EVAL` | Evaluation | Vault evaluation (search) |

## Mapeo a HTTP status

El backend mapea automáticamente cada `ErrorCategory` a un código HTTP:

| Categoría | HTTP status | Razón |
|-----------|-------------|-------|
| `VAL` | 400 | Bad request, input inválido |
| `AUTH` | 401 | No autorizado / token inválido |
| `DB`, `SEC` | 403 | Prohibido / error de acceso |
| `RATE` | 429 | Demasiadas requests |
| `NET`, `EXT`, `LLM`, `OCR`, `AUD`, `EMB` | 502 | Bad gateway / upstream falló |
| (resto) | 500 | Internal server error |

Override manual: se puede pasar `statusCode` explícito en el constructor de `AppError`.

## Estructura del error

### Frontend (Dart)

```dart
class AppError implements Exception {
  final String code;           // "EC-VAULT-003"
  final ErrorCategory category; // ErrorCategory.vault
  final String message;        // "No se pudo leer la nota"
  final Object? cause;         // excepción original
  final Map<String, dynamic> context; // { path: "...", size: 1234 }
  final String? hint;          // "Verifica permisos en Settings"
  final DateTime timestamp;
}
```

### Backend (TypeScript)

```typescript
class AppError extends Error {
  readonly code: string;        // "EC-LLM-005"
  readonly category: ErrorCategory; // ErrorCategory.LLM
  readonly message: string;     // "Ollama API error"
  readonly cause?: Error;
  readonly context: Record<string, unknown>;
  readonly hint?: string;       // "Check Ollama is running..."
  readonly timestamp: Date;
  readonly statusCode: number;  // 502 (auto-mapeado)
}
```

## Tabla completa de códigos (frontend)

### `EC-NET-*` — Network

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-NET-001` | backend_client | Fetch failed | Check network connectivity and backend URL |
| `EC-NET-002` | backend_client | Request timeout | Increase timeout or check backend health |
| `EC-NET-003` | backend_client | Invalid response | Backend returned malformed JSON |

### `EC-FS-*` — Filesystem

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-FS-005` | updater_io | APK write failed | Check storage space and permissions |

### `EC-AUTH-*` — Auth

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-AUTH-001` | permissions | Permission denied | Grant permission in Android settings |
| `EC-AUTH-002` | permissions | Permission permanently denied | Open app settings and grant manually |

### `EC-CAL-*` — Calendar

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-CAL-001` | calendar_service | Calendar permission denied | Grant READ_CALENDAR |
| `EC-CAL-002` | calendar_service | No calendars available | Create a calendar in Android |
| `EC-CAL-003` | calendar_service | Calendar not found | Refresh calendars list |
| `EC-CAL-004` | calendar_service | Event creation failed | Check event fields |
| `EC-CAL-005` | calendar_service | Event update failed | Event may have been deleted |
| `EC-CAL-006` | calendar_service | Event deletion failed | Event may already be deleted |
| `EC-CAL-007` | calendar_service | Calendar query failed | Check calendar provider |
| `EC-CAL-009` | calendar_service | Invalid event date | Use ISO-8601 format |

### `EC-CARD-*` — Flashcard

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-CARD-001` | flashcard_service | Card not found | Card may have been deleted |
| `EC-CARD-002` | flashcard_service | Card save failed | Check storage space |
| `EC-CARD-003` | flashcard_service | Card delete failed | Card may already be deleted |
| `EC-CARD-004` | flashcard_service | FSRS update failed | Reset FSRS state |
| `EC-CARD-005` | flashcard_service | Card metadata invalid | Run metadata migration |

### `EC-CFG-*` — Configuration

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-CFG-001` | device_id | Settings load failed | Restore from defaults |
| `EC-CFG-002` | device_id | Settings save failed | Check storage |
| `EC-CFG-010` | settings_screen | Theme apply failed | Restart app |
| `EC-CFG-011` | settings_screen | Settings reset failed | Reinstall app |

### `EC-LIFECYCLE-*` — Lifecycle

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-LIFECYCLE-001` | device_id | Device ID init failed | Reinstall app |
| `EC-LIFECYCLE-002` | main | App startup failed | Check logcat |
| `EC-LIFECYCLE-003` | device_info | Device info read failed | Some features may be limited |

### `EC-NOTE-*` — Note

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-NOTE-001` | note_view | Note load failed | Note may be corrupted |
| `EC-NOTE-002` | note_editor | Note save failed | Check storage |
| `EC-NOTE-003` | note_editor | Note create failed | Check vault path |

### `EC-PLAT-*` — Platform

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-PLAT-001` | device_id | Channel init failed | Restart app |
| `EC-PLAT-002` | device_id | Platform method not implemented | Update app |
| `EC-PLAT-003` | device_id | Platform call timeout | Check Android integration |

### `EC-UI-*` — UI

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-UI-001` | home_screen | Home render failed | Restart app |
| `EC-UI-002` | vault_browser | Vault list render failed | Refresh vault |
| `EC-UI-003` | flashcards_list | Cards list render failed | Restart app |

### `EC-UP-*` — Update

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-UP-001` | updater | Update check failed | Check network |
| `EC-UP-002` | updater_io | Download failed | Check network and storage |
| `EC-UP-003` | updater_io | APK verify failed | Retry download |
| `EC-UP-004` | updater_io | Install failed | Enable "Install from unknown sources" |
| `EC-UP-005` | updater_io | APK parse failed | Update may be corrupted |
| `EC-UP-006` | updater_io | Version check failed | Retry later |

### `EC-VAULT-*` — Vault

| Código | Componente | Mensaje | Hint |
|--------|-----------|---------|------|
| `EC-VAULT-001` | vault_service | Vault not found | Check vault path in Settings |
| `EC-VAULT-002` | vault_service | Tree load failed | Vault may be corrupted |
| `EC-VAULT-003` | vault_service | Note read failed | Note may be corrupted |
| `EC-VAULT-004` | vault_service | Note write failed | Check storage |
| `EC-VAULT-005` | vault_service | Note create failed | Check vault path |
| `EC-VAULT-006` | vault_service | Search failed | Index may be corrupted |
| `EC-VAULT-007` | vault_service | Count failed | Vault may be empty |
| `EC-VAULT-008` | vault_service | File skipped in search | Binary file or too large |

## Tabla completa de códigos (backend)

### `EC-AUTH-*` — Auth

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-AUTH-001` | middleware/auth | Missing Authorization header | 401 | Send `Authorization: Bearer <token>` |
| `EC-AUTH-002` | middleware/auth | Bad Authorization format | 401 | Format must be `Bearer <token>` |
| `EC-AUTH-003` | middleware/auth | JWT verify failed | 401 | Token expired or tampered |
| `EC-AUTH-004` | middleware/auth | Device not in token | 401 | Re-register device |
| `EC-AUTH-005` | middleware/auth | Device not registered | 401 | POST /api/v1/register first |
| `EC-AUTH-006` | auth/jwt | verifyAccessToken failed | 401 | Token signature invalid |
| `EC-AUTH-007` | auth/jwt | Token expired | 401 | Use refresh token |
| `EC-AUTH-008` | auth/jwt | JWT malformed | 401 | Token format invalid |
| `EC-AUTH-009` | auth/jwt | signAccessToken failed | 500 | Check JWT_SECRET |
| `EC-AUTH-010` | auth/jwt | issueRefreshToken failed | 500 | Check storage |
| `EC-AUTH-011` | auth/jwt | validateRefreshToken failed | 401 | Refresh token invalid or revoked |
| `EC-AUTH-012` | auth/devices | registerDevice failed | 500 | Check devices.db |
| `EC-AUTH-013` | auth/devices | Invalid deviceId (< 8 chars) | 400 | Use UUID |
| `EC-AUTH-014` | auth/devices | isDeviceRegistered failed | 500 | DB query error |
| `EC-AUTH-015` | auth/devices | getDevice failed | 500 | DB query error |
| `EC-AUTH-016` | auth/devices | getRegisteredDevices failed | 500 | DB query error |
| `EC-AUTH-017` | auth/devices | blockDevice failed | 500 | DB write error |
| `EC-AUTH-018` | auth/devices | updateDeviceToken failed | 500 | DB write error |
| `EC-AUTH-020` | routes/auth | register endpoint failed | 500 | Server error |
| `EC-AUTH-021` | routes/auth | deviceId required | 400 | Send `deviceId` in body |
| `EC-AUTH-022` | routes/auth | refresh endpoint failed | 500 | Server error |
| `EC-AUTH-023` | routes/auth | refreshToken required | 400 | Send `refreshToken` in body |
| `EC-AUTH-024` | routes/auth | Invalid refresh token | 401 | Re-register |
| `EC-AUTH-025` | routes/auth | Auth required (revoke) | 401 | Send Authorization header |
| `EC-AUTH-026` | routes/auth | revoke endpoint failed | 500 | Server error |
| `EC-AUTH-027` | routes/auth | Auth required (audit) | 401 | Send Authorization header |
| `EC-AUTH-028` | routes/auth | audit endpoint failed | 500 | Server error |

### `EC-LLM-*` — LLM

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-LLM-001` | services/llm | ollamaAvailable check failed | 502 | Ollama unreachable |
| `EC-LLM-002` | services/llm | chat failed | 502 | Check provider config |
| `EC-LLM-003` | services/llm | No LLM provider available | 502 | Set OLLAMA_BASE_URL or OPENROUTER_API_KEY |
| `EC-LLM-004` | services/llm | ollamaChat failed | 502 | Check Ollama |
| `EC-LLM-005` | services/llm | Ollama API error | 502 | Check Ollama status / model |
| `EC-LLM-006` | services/llm | openrouterChat failed | 502 | Check OpenRouter |
| `EC-LLM-007` | services/llm | OpenRouter API error | 502 | Check API key / model / rate limit |

### `EC-OCR-*` — OCR

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-OCR-001` | routes/ocr | ocr.image failed | 502 | Check request |
| `EC-OCR-002` | routes/ocr | imageBase64 required | 400 | Send `imageBase64` |
| `EC-OCR-003` | routes/ocr | Tesseract not available | 503 | Install tesseract-ocr |
| `EC-OCR-010` | services/ocr | isAvailable check failed | 502 | Tesseract issue |
| `EC-OCR-011` | services/ocr | recognize failed | 502 | Check image and language |
| `EC-OCR-012` | services/ocr | Tesseract execution failed | 502 | Check tesseract / image / language pack |
| `EC-OCR-013` | services/ocr | Tesseract timeout | 502 | Increase timeout |
| `EC-OCR-014` | services/ocr | Tesseract spawn error | 502 | Check tesseract install |
| `EC-OCR-015` | services/ocr | Tesseract non-zero exit | 502 | Check stderr |

### `EC-AUD-*` — Audio/Whisper

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-AUD-001` | routes/audio | audio.transcribe failed | 502 | Check request |
| `EC-AUD-002` | routes/audio | audioBase64 required | 400 | Send `audioBase64` |
| `EC-AUD-003` | routes/audio | Whisper binary not available | 503 | Set WHISPER_BINARY or install whisper.cpp |
| `EC-AUD-010` | services/whisper | isAvailable check failed | 502 | Check whisper binary |
| `EC-AUD-011` | services/whisper | transcribe failed | 502 | Check audio / model |

### `EC-EMB-*` — Embeddings

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-EMB-001` | services/embeddings | isAvailable check failed | 502 | Ollama unreachable |
| `EC-EMB-002` | services/embeddings | embed failed | 502 | Check Ollama / model |
| `EC-EMB-003` | services/embeddings | realEmbed failed | 502 | Check Ollama |
| `EC-EMB-004` | services/embeddings | Ollama embeddings error | 502 | Check Ollama / model |
| `EC-EMB-005` | services/embeddings | Embeddings empty response | 502 | Check input text |

### `EC-SEC-*` — Secrets

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-SEC-001` | services/secretManager | SecretNotFoundError | 404 | Secret doesn't exist |
| `EC-SEC-002` | services/secretManager | SecretAccessDeniedError | 403 | Permission denied |
| `EC-SEC-003` | services/secretManager | initialize failed | 500 | Check master key file |
| `EC-SEC-004` | services/secretManager | Bad master key length | 500 | Generate new master key |
| `EC-SEC-005` | services/secretManager | load failed | 500 | Check secrets.enc |
| `EC-SEC-006` | services/secretManager | save failed | 500 | Check disk space |
| `EC-SEC-007` | services/secretManager | list failed | 500 | Check storage |
| `EC-SEC-008` | services/secretManager | Not initialized (get/set) | 500 | Call initialize first |
| `EC-SEC-009` | services/secretManager | Invalid secret name pattern | 400 | Use alphanumeric + _ - |
| `EC-SEC-010` | services/secretManager | set failed | 500 | Check encryption |
| `EC-SEC-011` | services/secretManager | get not initialized | 500 | Call initialize first |
| `EC-SEC-012` | services/secretManager | get failed | 500 | Check encryption |
| `EC-SEC-013` | services/secretManager | delete failed | 500 | Check storage |
| `EC-SEC-014` | services/secretManager | has failed | 500 | Check storage |
| `EC-SEC-015` | services/secretManager | generateMasterKey failed | 500 | Check crypto module |
| `EC-SEC-016` | services/secretManager | rotateMasterKey not init | 500 | Call initialize first |
| `EC-SEC-017` | services/secretManager | rotateMasterKey bad length | 500 | Bad new key length |
| `EC-SEC-018` | services/secretManager | rotateMasterKey failed | 500 | Check encryption |

### `EC-BK-*` — Backup

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-BK-001` | services/backupIndex | node:sqlite not available | 500 | Use Node 22+ |
| `EC-BK-002` | services/backupIndex | insert failed | 500 | Check backup DB |
| `EC-BK-003` | services/backupIndex | get failed | 500 | Check backup DB |
| `EC-BK-004` | services/backupIndex | listForDevice failed | 500 | Check backup DB |
| `EC-BK-005` | services/backupIndex | delete failed | 500 | Check backup DB |

### `EC-CARD-*` — Flashcard (backend)

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-CARD-010` | routes/flashcards | generate failed | 502 | Check LLM config |
| `EC-CARD-011` | routes/flashcards | noteContent required | 400 | Send `noteContent` |

### `EC-VAL-*` — Validation

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-VAL-001` | server | Fastify validation error | 400 | Check request body schema |

### `EC-RATE-*` — Rate limit

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-RATE-001` | server | Rate limit error response | 429 | Slow down |
| `EC-RATE-002` | server | Rate limit exceeded (handler) | 429 | Wait before retrying |

### `EC-INTERNAL-*` — Internal

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-INTERNAL-001` | server | Not found (404) | 404 | Check URL |
| `EC-INTERNAL-002` | server | Unhandled error (500) | 500 | Report it with the requestId |

### `EC-LIFECYCLE-*` — Lifecycle (backend)

| Código | Componente | Mensaje | HTTP | Hint |
|--------|-----------|---------|------|------|
| `EC-LIFECYCLE-001` | server | Server startup failed | 500 | Check port / env / DB |

## Cómo emitir un error

### Frontend (Dart)

```dart
import 'package:mnexus_app/utils/error_codes.dart';

// Con constructor semántico
throw AppError.vault(
  code: 'EC-VAULT-003',
  message: 'No se pudo leer la nota',
  context: { 'path': notePath, 'size': fileSize },
  hint: 'Verifica permisos en Settings',
);

// O con safeCall (preferido para errores recuperables)
final r = await safeCallAsync<String>(
  component: 'vault',
  code: 'EC-VAULT-003',
  message: 'readNote failed',
  context: { 'path': notePath },
  op: () async => await vault.readNote(notePath),
);
if (!r.success) {
  showSnackBar('Error: ${r.error!.code}');
}
```

### Backend (TypeScript)

```typescript
import { E } from '../utils/errorCodes.js';
import { safeCallAsync } from '../utils/safeCall.js';

// Con constructor semántico
throw E.llm('EC-LLM-005', 'Ollama API error', {
  cause: originalError,
  context: { status: 500, model: 'llama3' },
  hint: 'Check Ollama is running and model is available',
});

// O con safeCall (preferido para errores recuperables)
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

## Cómo se loguean

### Frontend

```json
{
  "level": "ERROR",
  "time": "2026-09-07T14:23:11.456Z",
  "message": "[EC-VAULT-003] No se pudo leer la nota",
  "component": "vault",
  "code": "EC-VAULT-003",
  "category": "VAULT",
  "context": { "path": "/vault/notas/abc.md", "size": 1234 },
  "hint": "Verifica permisos en Settings",
  "error": "FileSystemException: ...",
  "stack": "..."
}
```

Ver `LOGGING.md` para cómo ver logs con `adb logcat`.

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
  "context": { "status": 500, "durationMs": 1234 },
  "hint": "Check Ollama is running and model is available",
  "stack": "Error: ...",
  "durationMs": 1234,
  "requestId": "req_1725716591456_x8k2p9"
}
```

Las respuestas HTTP también incluyen el código:

```json
{
  "code": "EC-LLM-005",
  "category": "LLM",
  "message": "Ollama API error",
  "hint": "Check Ollama is running and model is available",
  "requestId": "req_1725716591456_x8k2p9"
}
```

## Cómo extender

Para añadir un nuevo código:

1. **Elige la categoría** apropiada (ver tabla arriba).
2. **Asigna el siguiente número** disponible en esa categoría (no reutilices).
3. **Documenta el código** en este archivo (tabla + mensaje + hint).
4. **Usa el constructor semántico** del lado que corresponda (`E.*` o `AppError.*`).
5. **No cambies** el significado de códigos existentes — solo depreca y crea uno nuevo.
6. **Commit con tag** `error-codes:` en el mensaje.

Ejemplo de commit:

```bash
git commit -m "feat(llm): add EC-LLM-008 for token limit exceeded"
```

---

**Próximas versiones:**

- [ ] v0.46: i18n de los mensajes (separar `code` de `message`)
- [ ] v0.47: códigos para `SYNC`, `CONFL`, `PROP`, `PUSH`, `QUIZ`, `STR`, `REL`, `EVAL` (aún solo categorías definidas)
- [ ] v0.48: dashboard web para visualizar frecuencia de códigos en producción
