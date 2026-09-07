# Backend-only Features — Estado de exposición

> **Propósito:** transparencia sobre qué features del backend están realmente usadas por la app standalone, cuáles están parciales, y cuáles son backend-only sin UI.

**Última actualización:** 2026-09-07 · v0.45.0

---

## ✅ Features expuestas en la app (al menos parcialmente)

| Feature | Estado app | Notas |
|---|---|---|
| Vault (filesystem) | ✅ Total | Lectura/escritura de `.md` con SAF picker |
| Calendar events | ✅ Total | MethodChannel + lista de calendarios Android |
| Recordings | ✅ Total | `RecordingService.kt` + upload a backend |
| Backend health check | ✅ Total | `BackendClient.ping()` |
| Error codes EC-XXX-NNN | ✅ Total | Sincronizados frontend/backend |
| Auto-update (app) | ✅ Total | GitHub Releases cada 6h |
| Settings persistentes | ✅ Total | SharedPreferences |

---

## ⚠️ Features backend implementadas pero NO consumidas por la app

| Feature | Backend file | Estado | Acción en roadmap |
|---|---|---|---|
| **LLM chat (Ollama/OpenRouter)** | `services/llm.ts`, `routes/llm.ts` | Backend completo, app sin UI | [Fase 5.A](../CHECKLIST.md) — AI tutor |
| **Whisper transcription** | `services/whisper.ts`, `services/streamingTranscription.ts` | Backend placeholder (`text: ""`), app sin UI | [Fase 1.C](../CHECKLIST.md) |
| **Embeddings (OpenAI)** | `services/embeddings.ts` | Backend completo, app sin uso | [Fase 2.A](../CHECKLIST.md) — búsqueda semántica |
| **OCR (Tesseract/DeepSeek)** | `services/ocr.ts`, `services/deepseekOcr.ts` | Backend completo, app sin UI de cámara | [Fase 6.C](../CHECKLIST.md) |
| **Adaptive quiz engine** | `services/adaptiveQuiz.ts`, `services/adaptiveQuizEngine.ts` | Backend completo con knowledge graph, app sin UI | [Fase 5.B](../CHECKLIST.md) |
| **Cross-relevance** | `services/crossRelevance.ts` | Backend completo, app sin uso | [Fase 2.A](../CHECKLIST.md) |
| **Conflict Resolution (LWW-field)** | `services/conflictResolver.ts` | Backend correcto (260 LOC), app sin sync | [Fase 4.A](../CHECKLIST.md) |
| **Chunked upload** | `routes/upload.ts` | Backend completo, app no usa | [Fase 4.A](../CHECKLIST.md) |
| **Secret Manager (AES-256-GCM)** | `services/secretManager.ts` | Backend completo, app no consume | N/A (interno backend) |
| **Push notifications (FCM)** | `services/pushNotifications.ts` | Backend con FCM, app no recibe | [Fase 4.C](../CHECKLIST.md) |
| **Backup ZIP+SQLite** | `services/backupIndex.ts` | Backend completo, app sin UI de backup | [Fase 6.??](../CHECKLIST.md) |
| **Notion-style databases** | `routes/structured*.ts`, `services/structuredNotes.ts` | Backend completo, app sin UI | N/A (no en roadmap) |
| **PDF diff** | `routes/pdf.ts` | Backend completo, app sin uso | N/A |
| **Vault evaluation** | `services/vaultEval.ts` | Backend completo, app sin uso | N/A |
| **Metrics (Prometheus)** | `utils/metrics.ts` | Backend completo, app no las muestra | N/A (interno) |
| **Dashboard** | `routes/dashboard.ts` | Endpoint existe, sin UI web renderizada | N/A |
| **WebSocket streaming** | `routes/ws.ts` | Endpoint existe, app no conecta | [Fase 4.A](../CHECKLIST.md) |
| **Auto-update (backend)** | `utils/updateChecker.ts`, `routes/update.ts` | Existe, no se invoca automáticamente | N/A |

---

## ❌ Features mencionadas en docs pero NO implementadas

| Feature | Documentada en | Estado real |
|---|---|---|
| **Plugin de Obsidian** | README, descripción GitHub, v0.28 | **No existe** — la app es standalone desde v0.43 |
| **Web Clipper** | v0.33 release notes | **No existe** — sin extensión ni endpoint |
| **iOS app** | "multi-dispositivo" | **No existe** — solo Android + Web PWA |

---

## Roadmap de exposición

| Fase | Feature expuesta | Esfuerzo |
|---|---|---|
| **1.A** | FSRS real (reemplaza SM-2 fake) | 🔴 Crítico |
| **1.B** | AI proposals con LLM | 🔴 Crítico |
| **1.C** | Whisper real (reemplaza placeholder) | 🔴 Crítico |
| **1.D** | Voice input en app (speech_to_text) | 🔴 Crítico |
| **2.A** | Search full-text FTS5 (usa embeddings como bonus) | 🔴 Crítico |
| **3.A-3.J** | Cloze, IO, audio, type-answer, heatmap, stats | 🟠 SRS completo |
| **4.A-4.C** | Sync CRDT, E2E, push notifications | 🟠 Multi-device |
| **5.A-5.B** | AI tutor chat + adaptive quiz UI | 🟠 AI |
| **5.C** | Marketplace + Anki .apkg import | 🟡 Comunidad |

Ver [CHECKLIST.md](../CHECKLIST.md) para el plan completo.
