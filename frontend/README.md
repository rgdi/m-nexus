# M-NEXUS — Frontend (v1.0.0)

> **Tablet-first** Education Service UI: Overview, Calendar, Subjects, Notes (stylus-first canvas), To-do's, AI Tutor.

## Stack

- **Zero framework.** Vanilla ES modules + CSS variables (design tokens).
- **PointerEvents API** for stylus (pressure, tilt) on the canvas.
- **localStorage** fallback when the backend is offline (auto-detected).
- **No build step** required — open `public/index.html` from any static server.

## Run locally

```bash
# 1. From the repo root
cd frontend/public

# 2. Serve with any static server. Examples:
python3 -m http.server 8080
# or
npx serve .

# 3. Open http://localhost:8080
```

The app expects the backend at `http://localhost:4100`. If unreachable, it falls back to localStorage (demo seed loads automatically).

## File map

```
frontend/
├── public/
│   ├── index.html         entry point
│   ├── manifest.json      PWA manifest
│   └── favicon.svg
└── src/
    ├── main.js            router + bootstrap
    ├── styles/
    │   ├── tokens.css     design tokens (colors, spacing, etc.)
    │   ├── base.css       reset + typography
    │   ├── layout.css     app shell + dock
    │   ├── components.css buttons, cards, modales
    │   ├── calendar.css   day / week calendar
    │   └── notebook.css   stylus canvas + pencil drawer
    ├── services/
    │   ├── api.js         HTTP client to backend
    │   ├── store.js       localStorage wrapper
    │   └── demoSeed.js    fallback demo data
    └── screens/
        ├── overview.js    landing screen
        ├── calendar.js    day / week calendar
        ├── subjects.js    list + detail (grades grid)
        ├── notes.js       stylus canvas notebook
        ├── todos.js       to-do's with priority + due dates
        └── ai.js          AI Tutor chat
```

## Design philosophy

- **Tablet-first**, mobile-friendly.
- **Glass-style dock** at the bottom (Education Service reference).
- **Subject bubbles** with strong color identity (red/yellow/blue/purple/green).
- **Pencil drawer** with multiple pens (colors + sizes).
- **Auto-save** on every stroke.
- **Offline-first**: works without backend.

## Roadmap

- [ ] Multi-page notebooks (drag to reorder)
- [ ] OCR handwriting via backend (`/handwriting/recognize`)
- [ ] PDF import + highlights
- [ ] Marketplace UI
- [ ] Sync dashboard
- [ ] Mobile bottom sheet drawer (hamburger menu)
- [ ] Light/dark theme toggle
- [ ] i18n (es / en / pt)
