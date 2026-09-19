# M-NEXUS Documentation

Documentación técnica del sistema. Última actualización: **2026-09-19** (v2.16.0).

---

## 📚 Índice

| Doc | Contenido |
|---|---|
| [API.md](API.md) | REST API completa del backend (52+ routes) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diagramas de arquitectura, data flow, sync flow |
| [ERROR_CODES.md](ERROR_CODES.md) | Sistema unificado `EC-{CAT}-{NNN}` + helpers |
| [LOGGING.md](LOGGING.md) | pino backend + console frontend + correlación |
| [BACKEND_ONLY_FEATURES.md](BACKEND_ONLY_FEATURES.md) | Qué se expone en el frontend, qué es backend-only |

---

## 📂 En el repo

| Archivo | Contenido |
|---|---|
| [README.md](../README.md) | Overview + quick start + features (todas las versiones) |
| [CHANGELOG.md](../CHANGELOG.md) | Historial completo v1.0.0 → v2.16.0 |
| [AUDIT_REPORT.md](../AUDIT_REPORT.md) | Expectativa vs Realidad audit |
| [CHECKLIST.md](../CHECKLIST.md) | Audit checklist con deferred items |
| [VISUAL_AUDIT.md](../VISUAL_AUDIT.md) | Visual audit report |
| [backend/README.md](../backend/README.md) | Backend setup + endpoints v2.16.0 |
| [frontend/README.md](../frontend/README.md) | Frontend setup + módulos por feature |
| [screenshots/](../screenshots/) | Capturas: showcase/, v2140/, v2150/, v2160/ |

---

## 🏗️ Architecture (v2.16.0)

```
┌──────────────────────────────────────────────────────────────────┐
│                      M-NEXUS (v2.16.0)                            │
├──────────────────────────────────────────────────────────────────┤
│  Frontend (vanilla JS, 71 files, ~25 KB LOC)                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │Overview │ │Calendar │ │Subjects │ │ Notes   │ │  Todos  │    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│  ┌─────────┐ ┌─────────┐ ┌──────────────────────────────────┐   │
│  │  AI     │ │ Settings│ │ 27 widgets                       │   │
│  │         │ │ + Stylus│ │ (3D, AI tutor, occlusion, etc)   │   │
│  └─────────┘ └─────────┘ └──────────────────────────────────┘   │
│  Services layer                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │   api   │ │  auth   │ │  fsrs   │ │ aiTagger│ │  crdt   │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │sync_cl. │ │ yjs_cl. │ │ stylus  │ │ exams   │ │syllabus │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
├──────────────────────────────────────────────────────────────────┤
│  WebSocket / REST / multipart                                    │
│  - /ws/sync            → CRDT JSON sync                          │
│  - /api/v1/crdt/ws/:path → Yjs official binary sync              │
│  - /api/v1/models/upload → multipart .glb upload                 │
├──────────────────────────────────────────────────────────────────┤
│  Backend (Node.js + Fastify + TypeScript, 77 test files)         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │subjects │ │  notes  │ │ flashcards│ │  events │ │  tasks │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │  sync   │ │  crdt   │ │ aiTaggr │ │  ocr    │ │  audio  │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │  auth   │ │ backup  │ │ glbMod. │ │aiProvdr │ │ devices │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 52 services: FSRS, LLM, RAG, search, devices, JWT, CRDT, │    │
│  │ handwriting, AIProviders, CloudflareAccess, …             │    │
│  └──────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────┤
│  Storage:                                                        │
│  - JSON files (data/notes.json, flashcards.json, ai-config.json) │
│  - 3 built-in .glb models (animal_cell, plant_cell, bacterium)   │
│  - User uploaded .glb models (data/models/user/)                 │
│  - Audit WORM log (data/audit.jsonl, prod)                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📊 Métricas del sistema (v2.16.0)

| Source | Count |
|---|---|
| Backend vitest tests | **930** (77 files) |
| Frontend vitest tests | **255** (21 files) |
| **Total automated** | **1185 tests** ✅ |
| Frontend validation scripts | 315+ assertions (12 files) |
| E2E physical checks | 31 (5 user scenarios) |
| Mobile screenshots | 24 (360/390/720 viewports) |
| Backend routes | 52 |
| Backend services | 52 |
| Frontend widgets | 27 |
| Frontend screens | 9 |
| Backend LOC (TS) | ~35,000 |
| Frontend LOC (JS) | ~25,000 |
| Git tags | **17** (v1.0.0 → v2.16.0) |
| Public models | 3 built-in + N user uploads |
| Bundle size | 1217 KB / 71 files |

**Total verifications: ~1,500 verde.**

---

## 🚀 Quick links

- Run backend: `cd backend && PORT=4100 npx tsx src/server.ts`
- Run frontend: `cd frontend && python3 -m http.server 8080`
- Build webview bundle: `bash scripts/build_webview.sh /tmp/bundle`
- Run backend tests: `cd backend && ./node_modules/.bin/vitest run --exclude="**/syncE2E.test.ts"` (930 tests)
- Run frontend tests: `cd frontend && ./node_modules/.bin/vitest run` (255 tests)
- Run validations: `node app/test/validations/validate_v211.cjs` (65 assertions)
- Run mobile audit: `node app/test/e2e/capture_all_mobile.cjs` (24 screenshots)
- Run E2E physical: `node app/test/e2e/e2e_physical.cjs` (31 checks)

---

## 🆕 What's new (v2.16)

- **CRDT vector clocks + field-level LWW**: `services/crdt.ts` con `compareClocks`, `mergeFields`, `shouldApply`. Aplicado en `routes/sync_v2.ts`. Broadcast lleva `__mergedFields` cuando se mergean campos concurrentes.
- **Yjs official client**: `frontend/src/services/yjs_client.js` carga Yjs via CDN (`yjs@13.6.32/+esm`), habla binary protocol del WS endpoint `/api/v1/crdt/ws/:notePath`.
- **Conflict merge UI**: `widgets/conflict_merge_panel.js` panel lateral con cards (type+ID, origin+time, diff prev→new con badges `← merged`), dismiss, auto-fade 30s, mobile responsive.
- **User-uploaded .glb**: `routes/glbModels.ts` con multipart 50MB, valida magic `glTF`, files en `public/models/user/`. Built-ins protegidos de delete.
- **Pressure curves UI**: sección nueva en Settings → Stylus. 4 curvas (linear, soft=sqrt, firm=p², exponential), sliders (minPressure, tiltResponse), checkbox hover. Canvas preview en vivo. `services/stylus.js` exports `applyPressureCurve`, `tiltAlpha`. notes.js usa estas curvas configurables.

## 🆕 v2.15

- **3 modelos .glb de célula** (NO huesos como pediste): animal_cell (membrana+núcleo+mitocondrias+RE+Golgi), plant_cell (pared+núcleo+vacuola+cloroplastos), bacterium (cápsula+nucleoide+ribosomas+plásmido). Generados con Python script propio.
- **CRDT casero** con vector clocks + field-level LWW (ahora convive con Yjs — el casero se usa para JSON pub/sub events, Yjs para documents).
- **AI auto-tagging usa config del admin**: aiTagger ahora consume `generateCompletion()` de aiProviders que lee `data/ai-config.json`. Ollama local funciona sin env vars.
- **Tilt Y combinado**: alpha = `Math.sqrt(tiltX² + tiltY²)/90` (vector magnitude).
- **Hover preview para pen**: círculo+crosshair en el tip, throttled con rAF.

## 🆕 v2.14

- **OCR confidence real**: tesseract corre 2x (text + TSV), per-word confidence parseado. Frontend threshold 0.3.
- **Tesseract langs configurable**: `TESSERACT_LANGS` env var (default `spa+eng`).
- **Tilt-based opacity** para pen (tilt 0..90° → alpha 1..0.5).
- **OCR toast widget** con `OCR · {source} · conf {pct}%`.
- **GLB infra** (`/models` y `/public` en PUBLIC_PATHS).

## 🆕 v2.13

- **Pressure-sensitive drawing** (`PointerEvent.pressure × 0.5..1.5`).
- **Palm rejection** (capture-phase, area > 1500 px²).
- **Offline handwriting OCR** (debounced 800ms, tesseract --psm 7).

Ver [CHANGELOG.md](../CHANGELOG.md) para detalle completo de todas las versiones.
