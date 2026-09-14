# M-NEXUS — Implementation Checklist 2026 / v62+

> Brutal honesty report — every item must be **REAL**, **TESTED** and **PUSHED** to `main`.
> Stack: TypeScript backend (Fastify + SQLite) + Vanilla JS+CSS frontend. **NO Flutter.**

---

## ✅ v1.0.x — RESET (commits `220b6da` → `ded5771` → `e41ab52`)

### v1.0.0 — Reset (Flutter borrado, vanilla JS+CSS desde cero)
- [x] Flutter borrado (153 archivos Dart)
- [x] 72 tags + 3 branches borrados
- [x] Frontend: 21 archivos, ~3000 LOC
- [x] Education Service style (subject bubbles + glass dock bottom)
- [x] Tablet-first responsive
- [x] Stylus canvas (PointerEvents + pressure + tilt)
- [x] Multiple pencils + insert toolbar
- [x] Intelligent overview modal
- [x] Offline-first (localStorage fallback)
- [x] Dark mode (prefers-color-scheme)

### v1.1.0 — Backend connected (commit `ded5771`)
- [x] 4 rutas backend nuevas (`/subjects`, `/notes`, `/events`, `/tasks`)
- [x] Persistencia JSON en `data/*.json`
- [x] `dataSource.js` abstraction API/localStorage
- [x] 25 tests backend nuevos (sub 7 + notes 6 + events 6 + tasks 6)

### v1.2.0 — Responsive + Adaptive (commit `e41ab52`)
- [x] 6 CSS reescritos con `clamp()` + 7 breakpoints
- [x] 5 prefers-* queries + container queries + safe area
- [x] `device.js` runtime tier detection
- [x] Touch targets 44-48px, mouse compact 32-38px
- [x] Landscape phones: pencil drawer a bottom-right
- [x] validate_v12_responsive.cjs: **35/35 pass**

### v1.3.0 — i18n es/en/pt (commit `c1490d1`)
- [x] `i18n.js` 240 líneas, 130+ strings
- [x] `lang_switcher.js` floating button + menu
- [x] Auto-detect via navigator.language + localStorage
- [x] Subscribe reactivo re-render
- [x] validate_v13_i18n.cjs: **26/26 pass**

### v1.3.1 — Definition popup (commit `522f1b3`)
- [x] Long-press 600ms en canvas → popup flotante
- [x] Word + IPA + syllable + frequency + pronunciation
- [x] Auto-close outside click

### ✅ v1.4.0 — Polish (commit `70a1335`)
- [x] `splash.js` — logo "Education Service / always at hand" on boot
- [x] Animated blobs (8s/10s ease-in-out)
- [x] Auto-dismiss 1.2s o on pointerdown
- [x] `top_toolbar.js` — undo/redo/bg-fill/hide-UI top-right
- [x] Per-screen backgrounds (overview light blue, notes lime)
- [x] body.hide-ui hides dock + lang-switcher + toolbar
- [x] body.no-bg removes screen bg fill
- [x] validate_v14_polish.cjs: **18/18 pass**
- [x] Playwright screenshots: **48/48 assertions, 20 PNGs**

---

## 📊 Resumen total

| Version | Feature | Tests | Commit |
|---|---|---|---|
| v1.0.0 | Reset Flutter→Vanilla JS | — | `220b6da` |
| v1.1.0 | Backend CRUD | 25 backend | `ded5771` |
| v1.2.0 | Responsive+Adaptive | 35 validate | `e41ab52` |
| v1.3.0 | i18n es/en/pt | 26 validate | `c1490d1` |
| v1.3.1 | Definition popup | +screenshots | `522f1b3` |
| **v1.4.0** | **Splash + per-screen bg + top toolbar** | **18 validate + 48 playwright** | **`70a1335`** |

**Total: 79 validation tests + 48 Playwright assertions = 127 verificaciones automatizadas, todas verdes.**
