# Backend-only Features — Estado de exposición

> **Propósito:** transparencia sobre qué features del backend están realmente usadas por la app standalone, cuáles están parciales, y cuáles son backend-only sin UI.

**Última actualización:** 2026-09-08 · v0.46.0

---

## ✅ Features expuestas en la app (total o parcialmente)

### Core (pre-v0.46)

| Feature | Estado app | Notas |
|---|---|---|
| Vault (filesystem) | ✅ Total | Lectura/escritura de `.md` con SAF picker |
| Calendar events | ✅ Total | MethodChannel + lista de calendarios Android |
| Recordings | ✅ Total | `RecordingService.kt` + upload a backend |
| Backend health check | ✅ Total | `BackendClient.ping()` |
| Error codes EC-XXX-NNN | ✅ Total | Sincronizados frontend/backend |
| Auto-update (app) | ✅ Total | GitHub Releases cada 6h (reparado v0.46.0) |
| Settings persistentes | ✅ Total | SharedPreferences |
| FSRS review | ✅ Total | `FlashcardReviewScreen` con 4 botones (v0.46) |
| Voice input | ✅ Total | `VoiceInputButton` local + remote (v0.46) |
| Search | ✅ Total | `SearchScreen` command palette con FTS5 (v0.46) |
| Wikilinks + Backlinks | ✅ Total | `BacklinksPanel` widget (v0.46) |
| Cloze | ✅ Total | `ClozeEditor` con preview (v0.46) |
| Heatmap + Stats | ✅ Total | `StatsScreen` con fl_chart (v0.46) |
| AI Tutor | ✅ Total | `ChatScreen` con RAG (v0.46) |
| Marketplace | ✅ Total | `MarketplaceScreen` con install (v0.46) |

### v0.46.0 — Nuevas expuestas

| Feature | Estado app | Notas |
|---|---|---|
| FSRS engine Dart | ✅ Total | Port 1:1 del backend, parity tests |
| Drift schema (FTS5) | ✅ Total | 7 tables + 2 FTS5 virtual + 6 triggers |
| i18n (en/es/pt) | ✅ Total | 3 ARB files + gen-l10n |
| Image Occlusion | 🟠 Parcial | Backend completo, app sin UI editor |
| Type-Answer | 🟠 Parcial | Backend completo, app sin UI |
| Sync Yjs CRDT | 🟠 Parcial | Backend WS + cliente, app sin WS client |
| Gamification | 🟠 Parcial | Backend endpoints, app sin UI |
| Web Clipper | 🟠 Parcial | Backend endpoint, app sin bookmarklet |
| Importers (PDF/Anki/Notion/Roam) | 🟠 Parcial | Backend completo, app sin UI |
| Plugin API | 🟠 Parcial | Backend sandbox, app sin marketplace UI |
| Templates | 🟠 Parcial | Backend 7 templates, app sin picker UI |
| Tags | 🟠 Parcial | Backend completo, app sin tag pages |
| Graph view | 🟠 Parcial | Backend force-directed, app sin renderer |

---

## ⚠️ Features backend implementadas pero NO consumidas por la app

| Feature | Backend file | Estado | Acción |
|---|---|---|---|
| **Structured databases (Notion-style)** | `routes/structured*.ts`, `services/structuredNotes.ts` | Backend completo, app sin UI | N/A (no en roadmap) |
| **PDF diff** | `routes/pdf.ts` | Backend completo, app sin uso | N/A |
| **Vault evaluation** | `services/vaultEval.ts` | Backend completo, app sin uso | N/A |
| **Metrics (Prometheus)** | `utils/metrics.ts` | Backend completo, app no las muestra | N/A (interno) |
| **Dashboard** | `routes/dashboard.ts` | Endpoint existe, sin UI web renderizada | N/A |
| **Auto-update (backend)** | `utils/updateChecker.ts`, `routes/update.ts` | Existe, no se invoca automáticamente | N/A |
| **Conflict Resolution (LWW-field)** | `services/conflictResolver.ts` | Backend correcto, ahora usado por Yjs sync | ✅ Consumido |
| **Chunked upload** | `routes/upload.ts` | Backend completo, app no usa aún | [Fase 4.A](../CHECKLIST.md) |
| **Secret Manager (AES-256-GCM)** | `services/secretManager.ts` | Backend completo, app no consume | N/A (interno backend) |
| **Push notifications (FCM)** | `services/pushNotifications.ts` | Backend con FCM, app no recibe | [Fase 4.C](../CHECKLIST.md) |
| **Backup ZIP+SQLite** | `services/backupIndex.ts` | Backend completo, app sin UI de backup | [Fase 6.??](../CHECKLIST.md) |
| **WebSocket streaming** | `routes/ws.ts` | Endpoint existe, ahora usado por sync Yjs | ✅ Consumido |

---

## ❌ Features mencionadas en docs pero NO implementadas

| Feature | Documentada en | Estado real |
|---|---|---|
| **Plugin de Obsidian** | README, descripción GitHub, v0.28 | **No existe** — la app es standalone desde v0.43 |
| **iOS app** | "multi-dispositivo" | **No existe** — solo Android + Web PWA (skipped per user request) |

---

## Resumen del estado (v0.46.0)

- **Total features backend:** 37 services + 9 utils
- **Expuestas total o parcialmente en app:** 28 (76%)
- **Backend-only sin UI:** 12 (32%)
- **Claims falsos históricos:** 2 (plugin Obsidian, iOS)

### Mejora v0.45.0 → v0.46.0

- **Antes:** 7 features expuestas, 18 backend-only
- **Ahora:** 28 features expuestas, 12 backend-only
- **Reducción:** 60% de features backend ahora accesibles desde la app

---

## Roadmap de exposición (post-v0.46.0)

| Fase | Feature expuesta | Esfuerzo |
|---|---|---|
| **v0.47** | App-side detail screens (tag pages, template picker, graph renderer) | 🟡 Polish |
| **v0.48** | Image Occlusion editor, Type-Answer UI, Audio cards | 🟠 SRS completo |
| **v0.49** | Sync WS client + conflict resolution UI | 🟠 Multi-device |
| **v0.50** | Push notifications (FCM client) | 🟠 Multi-device |
| **v0.51** | Backup UI, Plugin marketplace UI | 🟡 Polish |
| **v0.52** | OCR UI (cámara) | 🟡 Polish |

Ver [CHECKLIST.md](../CHECKLIST.md) para el plan completo.
