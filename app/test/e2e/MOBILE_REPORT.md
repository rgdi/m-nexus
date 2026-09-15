# Mobile Audit & Optimization Report — v2.1.3

**Date:** 2026-09-15 (audit)  
**Scope:** All 6 main screens (overview, calendar, subjects, notes list, todos, ai) + notes notebook view  
**Viewports tested:** 360×640, 390×844, 720×1024  

---

## Process

1. **Capture** all screens at 3 viewports → 24 screenshots
2. **Audit** each for: horizontal overflow, too-small touch targets, text truncation
3. **Fix** layout/CSS issues
4. **Re-capture** and verify `0 issues`

---

## Issues found & fixes

| # | Issue | Fix | Files |
|---|---|---|---|
| 1 | All screen titles clipped behind fixed top-bar | Added `padding-top: calc(safe-top + 56px)` for `.app` in mobile | `layout.css` |
| 2 | Top-bar too crowded on 360px (4 elements) | Collapsed cmd-trigger to icon-only | `components.css`, `main.js` |
| 3 | Vault switcher takes too much horizontal space | Hidden `.vault-name` on mobile | `components.css`, `vault.js` |
| 4 | AI tutor FAB overlapped the chat "Send" button | Hide FAB when `body.route-ai` or `body.ai-chat-open` | `ai_tutor.js`, `main.js` |
| 5 | Subject cards too tall (min 120px) on 2-col mobile | Reduced to 96px on phones | `components.css` |
| 6 | Calendar view-toggle pill overflowed header | Compacted padding/font on mobile | `calendar.css` |
| 7 | Task rows had chips overflowing horizontally | Moved chips below text + `flex-wrap` | `todos.js`, `components.css` |
| 8 | Todo checkbox (24×24) too small for touch | Increased to 32×32 with `min-width/height: 44px` | `todos.js` |
| 9 | Icon-only buttons (`.btn.icon`) shrunk by flex parent | Added `flex-shrink: 0` + bigger touch target | `components.css` |

---

## Final audit (after fixes)

```
360x640:
  ✓ overview     ✓ calendar     ✓ subjects
  ✓ notes-list   ✓ todos        ✓ ai-tutor
  ✓ notes-notebook

390x844:  same, 7/7 OK
720x1024: same, 7/7 OK

Total issues: 0
```

---

## Screenshots

24 PNGs in `/workspace/m-nexus/screenshots/mobile/`:

| Viewport | Overview | Calendar | Subjects | Notes-list | Todos | AI-tutor | Notebook |
|---|---|---|---|---|---|---|---|
| small (360) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| iphone (390) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tablet (720) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Plus `drawer.png` (hamburger menu) per viewport.

---

## Key technical changes

### `layout.css`
- Moved `@media (max-width: 720px) { .app { padding-top: ... } }` to **end of file** so it overrides the later `@supports (padding: max(0px))` rule that was setting it to `var(--s-3) = 10px`.
- Added mobile-specific `.screen-header` rules (stack items, full-width title, no spacer).

### `components.css`
- Added `flex-shrink: 0` to `.btn.icon`.
- Added `@media (pointer: coarse)` to bump touch targets to 44×44.
- Compacted `.subj-bubble` to 96px min on phones.
- Vault-switcher and cmd-trigger collapse to icon-only.

### `main.js`
- Mirror route name to `document.body.className = "route-${route}"` so FAB can be hidden via CSS when on /ai or when chat open.

### `ai_tutor.js`
- Adds/removes `ai-chat-open` class on body when chat opens/closes.

### `todos.js`
- Restructured `taskRow()`: title + date stay inline; chips go below.
- Bigger checkbox with min-width/min-height for touch.

---

## Verification

- 0 layout issues detected by automated audit at 360/390/720
- All 24 screenshots show clean layouts (titles visible, no overlap, hit-targets ≥44px on touch)
- Re-run: `node app/test/e2e/capture_all_mobile.cjs`
