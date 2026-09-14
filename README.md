# M-NEXUS — Education Service (v1.0.0)

> **Tablet-first** Education Service for medical students:
> notebook (stylus), calendar, subjects, to-do's, AI tutor — local-first.

---

## v1.0.0 — Reset & rewrite

Esta versión es un **reset total**. Lo anterior (Flutter Android app, 700+ tests, etc.) se ha borrado. Empezamos de cero con un enfoque diferente:

- **Frontend:** Vanilla HTML/CSS/JS (zero framework), tablet-first
- **Backend:** Node.js + Fastify + SQLite (lo que ya funcionaba, consolidado)
- **Inspiración visual:** Education Service de Anastasia Stepanova

## Quick start

```bash
# Backend
cd backend
npm ci
npm run dev   # http://localhost:4100

# Frontend
cd frontend/public
python3 -m http.server 8080
# Open http://localhost:8080
```

Si el backend no está disponible, el frontend funciona **offline** con `localStorage` y datos demo.

## Estructura del repo

```
m-nexus/
├── frontend/                ← NUEVO, vanilla HTML/CSS/JS
│   ├── public/
│   │   ├── index.html       entry + dock
│   │   ├── manifest.json    PWA
│   │   └── favicon.svg
│   └── src/
│       ├── main.js          router
│       ├── styles/          tokens, base, layout, components, calendar, notebook
│       ├── services/        api.js, store.js, demoSeed.js
│       └── screens/         overview, calendar, subjects, notes, todos, ai
├── backend/                 ← CONSOLIDADO, Node.js + Fastify + SQLite
│   ├── src/
│   │   ├── routes/          REST endpoints (35+)
│   │   ├── services/        business logic (45+)
│   │   ├── middleware/      auth, csp, rate limit, path validation
│   │   └── utils/           errors, paths, crypto, etc
│   └── tests/               700+ tests
├── docs/                    ← legacy docs
└── scripts/                 ← setup, sync E2E, health check
```

## Features

| Categoría | Implementado |
|-----------|--------------|
| Notes (stylus notebook) | ✅ Canvas + PointerEvents + multi-page + pencils |
| Calendar | ✅ Day/Week + create event modal |
| Subjects | ✅ Bubbles + detail con grades grid |
| To-dos | ✅ Priority + due dates + filters |
| AI Tutor | ✅ Chat panel + RAG (cuando backend) |
| FSRS Spaced Repetition | ✅ Backend (21 params, 4 ratings) |
| Sync E2E (LWW) | ✅ Backend (REST) |
| Marketplace | ✅ Backend (SQLite) |
| E2E encryption (AES-256-GCM + ECDH P-256) | ✅ Backend |
| Web Clipper (HTML→MD, URL→MD) | ✅ Backend |
| Search (FTS5 + stemmer ES/EN) | ✅ Backend |
| Multi-language i18n (en/es/pt) | ⏳ Pendiente |
| Mobile (Android/iOS) | ❌ Skipped |
| Plugin system | ❌ Skipped |

## Stack decisions

- **Frontend = Vanilla JS, no React/Vue/etc.** Tablet-first, stylus-first, PWA-installable. Cero build step.
- **Backend = Fastify + better-sqlite3.** Las features reales que funcionaban en v0.60-v0.62 se conservan y consolidan.
- **localStorage como fallback offline.** El frontend detecta automáticamente si el backend responde y degrada gracefully.

## Roadmap hacia v1.1.0

- [ ] Conectar todos los endpoints del backend al frontend (markeplace, sync, E2E settings, etc.)
- [ ] Multi-language i18n en el frontend (es/en/pt)
- [ ] Handwriting OCR via backend (`/handwriting/recognize`)
- [ ] PDF import + highlights
- [ ] Sync dashboard
- [ ] Theme custom UI
- [ ] Tests E2E con Playwright

## Licencia

Privada — © 2026 M-NEXUS
