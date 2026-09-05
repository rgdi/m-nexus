# M-NEXUS Backend API (v0.35.0)

API REST del backend Node.js (Fastify 5 + TypeScript).

**Base URL:** `http://localhost:8787` (default) · **Versión API:** v1

**Auth:** todas las rutas (excepto `/health`, `/metrics`, `/push/*` y `/transcription/stream`) requieren
header `Authorization: Bearer <token>` excepto si la auth está deshabilitada.

**Header universal:** `X-Device-Id` (recomendado, identifica el device companion/app).

---

## 📋 Índice

- [Health & Metrics](#health--metrics)
- [Auth](#auth)
- [Devices & Stats](#devices--stats)
- [Vaults (sync)](#vaults-sync)
- [Audio & Transcription](#audio--transcription)
- [LLM & Embeddings](#llm--embeddings)
- [OCR](#ocr)
- [PDF](#pdf)
- [Flashcards (proposals)](#flashcards-proposals)
- [AI Routes (vault eval, quiz, proposals, knowledge)](#ai-routes)
- [FSRS Queue (async spaced repetition)](#fsrs-queue)
- [Push Notifications](#push-notifications)
- [Backup](#backup)
- [Update (auto-update del backend)](#update)
- [Secrets (AES-256-GCM)](#secrets)
- [Databases (Notion-style)](#databases-notion-style)
- [Upload (chunked, resumable)](#upload-chunked-resumable)
- [Rollback](#rollback)
- [WebSocket](#websocket)

---

## Health & Metrics

### `GET /api/v1/health`
Verifica que el backend está corriendo.

**Respuesta 200:**
```json
{
  "status": "ok",
  "version": "0.35.0",
  "uptime": 12345,
  "nodeVersion": "v22.0.0"
}
```

### `GET /metrics`
Métricas Prometheus. No requiere auth.

---

## Auth

### `POST /api/v1/register`
Registra un device companion.

**Body:**
```json
{
  "deviceId": "uuid-v4",
  "model": "Google Pixel 7",
  "osVersion": "Android 14 (SDK 34)",
  "displayName": "Mi Pixel"
}
```

**Respuesta 200:**
```json
{ "registered": true, "authToken": "..." }
```

### `POST /api/v1/auth/refresh`
Refresca el token de auth.

### `POST /api/v1/auth/revoke`
Revoca el token (logout).

### `POST /api/v1/auth/block`
Bloquea un device (admin).

### `GET /api/v1/audit`
Log de auditoría (admin).

---

## Devices & Stats

### `GET /api/v1/devices`
Lista devices registrados.

### `GET /api/v1/stats`
Estadísticas globales (vaults, flashcards, recordings, etc.).

**Respuesta 200:**
```json
{
  "users": 1,
  "vaults": 3,
  "notes": 1234,
  "flashcards": 567,
  "recordings": 89,
  "lastSync": "2026-09-04T23:00:00Z"
}
```

---

## Vaults (sync)

El plugin sincroniza notas (snapshots) con el backend.

### `POST /api/v1/notes/sync`
Sincroniza un batch de notas.

**Body:**
```json
{
  "snapshots": [
    { "path": "Flashcards/c1.md", "front": "...", "back": "...", "tags": ["anatomia"], "updatedAt": 1693838400 }
  ]
}
```

---

## Audio & Transcription

### `POST /api/v1/audio/transcribe`
Transcribe un archivo de audio.

**Body:** `multipart/form-data` con campo `audio`.

**Respuesta 200:**
```json
{
  "text": "El diafragma es un músculo...",
  "segments": [{ "start": 0, "end": 2.5, "text": "El diafragma" }],
  "language": "es",
  "duration": 300.5
}
```

### `POST /api/v1/audio/transcribe/stream`
Transcribe en streaming (WebSocket upgrade).

### `GET /transcription/stream` (WebSocket)
Stream de transcripción en tiempo real.

---

## LLM & Embeddings

### `POST /api/v1/llm/chat`
Chat con un LLM (DeepSeek, OpenAI, Ollama).

**Body:**
```json
{
  "messages": [{ "role": "user", "content": "Explica el diafragma" }],
  "model": "deepseek-chat",
  "temperature": 0.7
}
```

### `POST /api/v1/llm/embed`
Genera embeddings de un texto.

**Body:**
```json
{ "text": "El diafragma es un músculo..." }
```

**Respuesta:**
```json
{ "embedding": [0.012, -0.034, ...], "model": "text-embedding-3-small" }
```

### `GET /api/v1/llm/embed/cache`
Estadísticas de la caché de embeddings.

### `POST /api/v1/llm/embed/cache/clear`
Limpia la caché.

---

## OCR

### `POST /api/v1/ocr/image`
OCR de una imagen (DeepSeek OCR V2).

**Body:** `multipart/form-data` con campo `image`.

**Respuesta:**
```json
{
  "text": "...",
  "confidence": 0.95,
  "language": "es",
  "model": "deepseek-ocr-v2"
}
```

---

## PDF

### `POST /api/v1/pdf/diff`
Compara dos PDFs (versiones, cambios).

**Body:**
```json
{ "pdf1Path": "...", "pdf2Path": "..." }
```

---

## Flashcards (proposals)

### `POST /api/v1/flashcards/generate`
Genera propuestas de flashcards desde una nota.

**Body:**
```json
{ "notePath": "Apuntes/Clase3.md", "count": 5 }
```

---

## AI Routes

### `POST /api/v1/ai/eval-vault`
Evalúa el estado de un vault (qué estudiar, qué repasar).

### `POST /api/v1/ai/proposals`
Genera propuestas de flashcards/knowledge layers.

### `POST /api/v1/ai/quiz`
Inicia una sesión de quiz adaptativo.

### `GET /api/v1/ai/quiz/:id`
Obtiene estado de una sesión de quiz.

### `POST /api/v1/ai/quiz/:id/answer`
Envía respuesta a una pregunta.

### `POST /api/v1/ai/cross-relevance`
Calcula relevancia cruzada entre notas.

### `POST /api/v1/ai/embeddings/rebuild`
Recalcula embeddings de un vault.

### `POST /api/v1/ai/knowledge-graph`
Genera grafo de conocimiento de un vault.

---

## FSRS Queue

FSRS async con worker queue (no bloquea el event loop).

### `POST /api/v1/fsrs/eval`
Encola una evaluación FSRS.

**Body:**
```json
{ "userId": "...", "cardIds": ["c1", "c2", "c3"], "algorithm": "fsrs-v5" }
```

**Respuesta:**
```json
{ "jobId": "fsrs-abc123", "queued": true }
```

### `GET /api/v1/fsrs/job/:id`
Obtiene estado de un job.

**Respuesta:**
```json
{
  "state": "done",
  "result": { "jobId": "...", "cardsEvaluated": 100, "durationMs": 234 }
}
```

### `GET /api/v1/fsrs/stats`
Métricas de la cola (queued, running, processed, failed).

### `POST /api/v1/fsrs/wait/:id`
Long polling (espera a que un job termine, max 60s).

### `GET /api/v1/fsrs/list`
Lista todos los jobs (debug).

---

## Push Notifications

### `POST /push/register`
Registra un device para push.

### `POST /push/token/:deviceId`
Registra token FCM.

### `POST /push/send`
Envía push a un device.

### `POST /push/broadcast`
Envía push a todos los devices.

### `GET /push/tokens`
Lista tokens registrados.

### `GET /push/stats`
Estadísticas de push.

---

## Backup

### `POST /api/v1/backup/upload`
Sube un backup binario (ZIP).

### `GET /api/v1/backup/list`
Lista backups disponibles.

### `GET /api/v1/backup/download/:id`
Descarga un backup.

### `DELETE /api/v1/backup/:id`
Borra un backup.

### `GET /api/v1/backup/dump`
Dump completo del estado del backend.

---

## Update

### `GET /api/v1/update`
Información sobre updates disponibles (changelog, download URL).

### `GET /api/v1/update/check`
Chequea si hay una nueva versión.

### `POST /api/v1/update/apply`
Aplica una actualización (descarga + reinicia).

---

## Secrets

API keys cifradas con AES-256-GCM.

### `GET /api/v1/secrets`
Lista nombres de secrets (nunca los valores).

### `GET /api/v1/secrets/:name`
```json
{ "name": "openai_api_key", "configured": true }
```

### `POST /api/v1/secrets/:name`
Guarda un secret (cifrado).

**Body:**
```json
{ "value": "sk-..." }
```

### `DELETE /api/v1/secrets/:name`
Borra un secret.

### `POST /api/v1/secrets/test/:name`
Verifica que un secret se puede descifrar.

---

## Databases (Notion-style)

### `GET /api/v1/databases`
Lista databases de un vault.

### `POST /api/v1/databases`
Crea una database.

**Body:**
```json
{
  "vaultId": "...",
  "name": "Casos clínicos",
  "folder": "_M-NEXUS/Cases",
  "properties": [
    { "name": "title", "type": "text" },
    { "name": "severity", "type": "number" },
    { "name": "status", "type": "select", "options": ["draft", "reviewed", "mastered"] }
  ]
}
```

### `GET /api/v1/databases/:id`
Obtiene una database.

### `PATCH /api/v1/databases/:id`
Actualiza schema.

### `DELETE /api/v1/databases/:id`
Borra database (no borra las notas).

### `GET /api/v1/databases/:id/rows`
Lista rows (con filtros y sorts).

**Querystring:** `filters=...&sort=...` (JSON-encoded).

### `POST /api/v1/databases/:id/rows`
Crea un row.

### `PATCH /api/v1/databases/:id/rows/:rowId`
Actualiza un row (con conflict detection via `expectedClock`).

**Body:**
```json
{
  "properties": { "status": "reviewed" },
  "expectedClock": { "deviceA": 3 }
}
```

### `DELETE /api/v1/databases/:id/rows/:rowId`
Borra un row.

### `GET/POST /api/v1/databases/:id/views`
Vistas (table, kanban, calendar, gallery, list).

---

## Upload (chunked, resumable)

Para subir archivos grandes (audio, PDF, etc.) sin riesgo de timeout.

### `POST /api/v1/upload/init`
Inicia una sesión de upload.

**Body:**
```json
{
  "filename": "clase-2026-09-04.m4a",
  "totalSize": 52428800,
  "chunkSize": 1048576,
  "deviceId": "d1",
  "expectedSha256": "...",  // opcional
  "targetSubdir": "recordings/2026-09"
}
```

**Respuesta:**
```json
{
  "uploadId": "up-abc123",
  "totalChunks": 50,
  "chunkSize": 1048576
}
```

### `PUT /api/v1/upload/:id/chunk/:n`
Sube un chunk (raw bytes, Content-Type: `application/octet-stream`).

**Idempotente:** reenviar el mismo chunk retorna `{ duplicate: true }`.

### `GET /api/v1/upload/:id/status`
Estado del upload (qué chunks ya se recibieron).

**Respuesta:**
```json
{ "received": [0, 1, 2, 5], "total": 50 }
```

### `POST /api/v1/upload/:id/complete`
Finaliza el upload (ensambla + verifica SHA-256).

**Body (opcional):**
```json
{ "expectedSha256": "..." }
```

**Respuesta:**
```json
{ "sha256": "...", "path": "uploads/final/recording.m4a" }
```

### `DELETE /api/v1/upload/:id`
Cancela y limpia chunks.

---

## Rollback

Backup del estado del backend antes/después de updates.

### `POST /api/v1/rollback/create`
Crea un backup del estado.

**Respuesta:**
```json
{
  "backup": { "id": "backup-1693838400", "size": 1024, "path": "..." }
}
```

### `GET /api/v1/rollback/list`
Lista backups disponibles.

### `POST /api/v1/rollback/restore`
Restaura desde un backup.

**Body:**
```json
{ "backupId": "backup-1693838400", "confirm": true }
```

### `GET /api/v1/rollback/strategy`
Describe la estrategia (qué se guarda, qué se excluye).

---

## WebSocket

### `WS /api/v1/ws`
WebSocket para sync en tiempo real y notificaciones.

**Eventos:**
- `note.updated` — una nota fue modificada
- `recording.transcribed` — transcripción completa
- `proposal.ready` — propuesta de IA lista
- `flashcard.due` — flashcard vence
- `update.available` — nueva versión disponible
