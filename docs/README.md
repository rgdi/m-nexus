# M-NEXUS Documentation

Documentación técnica del sistema. Última actualización: **2026-09-15** (v2.1.4).

---

## 📚 Índice

| Doc | Contenido |
|---|---|
| [API.md](API.md) | REST API completa del backend (46 routes) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diagramas de arquitectura, data flow, sync flow |
| [ERROR_CODES.md](ERROR_CODES.md) | Sistema unificado `EC-{CAT}-{NNN}` + helpers |
| [LOGGING.md](LOGGING.md) | pino backend + console frontend + correlación |
| [BACKEND_ONLY_FEATURES.md](BACKEND_ONLY_FEATURES.md) | Qué se expone en el frontend, qué es backend-only |

---

## 📂 En el repo

| Archivo | Contenido |
|---|---|
| [README.md](../README.md) | Overview + quick start + features |
| [CHANGELOG.md](../CHANGELOG.md) | Historial completo v1.0.0 → v2.1.4 |
| [app/test/validations/CHECKLIST_2026_v62.md](../app/test/validations/CHECKLIST_2026_v62.md) | Implementation checklist brutal-honesty |
| [app/test/e2e/E2E_REPORT.md](../app/test/e2e/E2E_REPORT.md) | E2E physical user simulation (31 checks) |
| [app/test/e2e/MOBILE_REPORT.md](../app/test/e2e/MOBILE_REPORT.md) | Mobile audit report (24 screenshots) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    M-NEXUS (v2.1.4)                           │
├─────────────────────────────────────────────────────────────┤
│  Frontend (vanilla JS, 8.5 KB LOC, 44 files)                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │Overview │ │Calendar │ │Subjects │ │ Notes   │ │  Todos  │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌───────────────────────────────┐    │
│  │  AI     │ │ Splash  │ │ 23 widgets (study, FSRS, AI, │    │
│  └─────────┘ └─────────┘ │ palette, graph3D, attachments)│    │
│                          └───────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  Services layer                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │   api   │ │  fsrs   │ │  exams  │ │sylabus  │ │  crdt   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  i18n   │ │  theme  │ │  vault  │ │ device  │ │sync_cl. │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
├─────────────────────────────────────────────────────────────┤
│  HTTP /api/v1 (legacy auth mode, AUTH_REQUIRED=false)         │
├─────────────────────────────────────────────────────────────┤
│  Backend (Node.js + Fastify + TypeScript, 19 KB LOC)         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │subjects │ │  notes  │ │ flashcards│ │  events │ │  tasks │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │   ai    │ │   llm   │ │   ocr   │ │  audio  │ │  pdf    │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  sync   │ │  auth   │ │ backup  │ │ update  │ │   ws   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 45 services: FSRS, LLM, RAG, search, devices, JWT, …│   │
│  └──────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  Storage: JSON files (`backend/data/*.json`)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Métricas del sistema

| Source | Count |
|---|---|
| Backend vitest tests | **796** |
| Frontend validation assertions | **315+** |
| E2E physical checks | **31** |
| Mobile screenshots | **24** |
| Playwright screenshots | **48+** |
| Backend routes | **46** |
| Frontend widgets | **23** |
| Backend LOC (TS) | **~19,200** |
| Frontend LOC (JS) | **~8,500** |
| Backend tests files | **67** |
| Frontend validation files | **12** |
| Git tags | **13** (v1.0.0 → v2.1.4) |

**Total verifications: ~1,170 verde.**

---

## 🚀 Quick links

- Run backend: `cd backend && npm run dev`
- Run frontend: `cd frontend/public && python3 -m http.server 8080`
- Build webview bundle: `bash scripts/build_webview.sh /tmp/bundle`
- Run tests: `cd backend && npm test` (796)
- Run validations: `node app/test/validations/validate_v211.cjs` (65)
- Run mobile audit: `node app/test/e2e/capture_all_mobile.cjs` (24 screenshots)
- Run E2E physical: `node app/test/e2e/e2e_physical.cjs` (31 checks)
