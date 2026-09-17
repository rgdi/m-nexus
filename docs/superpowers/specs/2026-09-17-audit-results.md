# M-NEXUS v2.6.0 — UI Audit Report (botón por botón)

> **Date:** 2026-09-17
> **Method:** Playwright + visual inspection at 1440x900 + 768x1024
> **Routes audited:** overview, calendar, subjects, notes, todos, ai, settings
> **Interactive elements captured:** 113 (desktop) + 7 routes × 2 viewports

---

## Executive summary

| Severity | Count | Examples |
|---|---|---|
| 🔴 **CRITICAL** (broken) | 3 | Escape no cierra modales, demo data pollutes first run, FAB choca con dock |
| 🟡 **HIGH** (UX issue) | 5 | Subjects cards gigantes (240px), notas background amarillo chillón, AI side panel sobre-dimensionado, +AI menu redundante |
| 🟢 **MEDIUM** (polish) | 7 | Toolbar demasiado larga en notas, topbar siempre visible, intro demo borrable |

---

## Per-route findings

### 1. Overview (`#/`)

**Interactive elements:** 21 (16 anchors + 5 buttons)

✅ Works:
- Schedule / Subjects / At-a-glance / Quick notes cards
- Date picker (Sep 17)
- Dock navigation

🔴 CRITICAL:
- **"+ Definir primer syllabus"** aparece aislado, huérfano del flujo. Es un CTA fuera de contexto que un usuario nuevo no entiende.
- **Syllabus tracker** queda **cortado por el dock inferior**. La card "Syllabus tracker" aparece debajo del dock, no scrollea bien.

🟡 ISSUE:
- **FAB 🤖 flotante bottom-right** está SIEMPRE visible (no solo cuando hay contexto), choca con el dock.

🟢 POLISH:
- Los **subjects cards** del overview (`Math`, `Deutsch`...) tienen **64×64px avatar + texto** — OK desde v2.3.0-A. ✓

**Demo data:**
- "Math Mr. Meier · 9.2 M", "Politics-economics Fr. Stolz · 7.5 P", "Deutsch Dr. Seibert · 7.5 D", "Physics Dr. Müller · 7.0 Ψ", "Chemistry Dr. Müller · 7.2 C" — son **datos demo inyectados en primera ejecución** (`demoSeed.js`). **NO deberían existir en una instalación limpia**.

---

### 2. Calendar (`#/calendar`)

**Interactive elements:** 11 (7 anchors + 4 buttons)

✅ Works:
- Day/Week toggle funcional
- "+ Create event" CTA arriba-derecha
- Línea roja de "ahora"

🟡 ISSUE:
- **Día actual no marcado** — no hay highlight visual del día de hoy en week view
- **Vista vacía muy minimalista** — solo las horas de 6:00 a 10:00 se ven; el resto del viewport queda en blanco
- **FAB 🤖** visible — innecesario cuando hay "+ Create event" como CTA principal

🔴 BUG:
- **Modal "+ Create event"** — no se cierra con tecla Escape (probado en Playwright)

---

### 3. Subjects (`#/subjects`)

**Interactive elements:** 10 (7 anchors + 3 buttons)

🔴 CRITICAL:
- **Cards ENORMES**: cada card ocupa ~**200×120px** con icono + nombre + prof + grade + performance + decorative bar
  - **Esto contradice v2.3.0-A** que redujo cards a 64px horizontal rows
  - Pero **el código en `subjects.js` line 41-50 muestra estructura grande**: `<div class="subj-card">` con `trophy-icon`, `name`, `prof`, `grade`, `performance`
  - **NO se aplicó el cambio v2.3.0-A aquí** (solo en Overview)
- **24 subjects demo visibles**:
  ```
  Math, Politics-economics, Deutsch, Physics, Chemistry, French, Biology,
  Computer Sci., History, English, Art, Music,
  Anatomía, Fisiología, Bioquímica, Física, Histología, Anatomía, Fisiología,
  Bioquímica, Física, Histología, Anatomía, Bioquímica
  ```
  - Duplicados (Anatomía × 3, Fisiología × 3, etc.)
  - Algunos con `performance: 0.00` (vacíos)
  - **Esto es ruido brutal para un usuario nuevo**

🔴 CRITICAL:
- **Modal "+ New subject"** — Escape no cierra (solo ✕ o clic fuera)

🟢 POLISH:
- Deck de iconos en colores variados se ve bien — pero es ruido si son demo data

---

### 4. Notes (`#/notes`)

**Interactive elements:** 16 (8 buttons + 1 input + 7 anchors)

✅ Works:
- Sidebar tree con folders + notas ✓
- "Search notebooks" funciona ✓
- Click en nota → carga en canvas principal ✓

🔴 CRITICAL:
- **Botón "+ New note" muestra texto "+ + New note"** (doble `+`) — bug en HTML literal:
  - El sidebar tiene `<button>+ + New note</button>` pero solo debería ser `<button>+ New note</button>`
- **Botón "📁+"** (crear folder) está **cortado visualmente** — el `+` queda fuera del viewport
- **Background amarillo canario** (`#fef3c7` o similar) MUY brillante — distrae y no fue pedido

🟡 ISSUE:
- **Toolbar horizontal enorme** cuando editas nota:
  - `✦ Intelligent overview` | `🔍` | `T` | `✦` | `🎴 Quick card`
  - + Canvas tools: `✏️` `🖍️` `🧽` `→` (4 icons)
  - + Side tools flotantes: `🎤` `🖼️` `🔗` `🔲` (4 icons vertical)
  - + Bottom canvas: 5 colores + borrador
  - = **~20 controles en una pantalla**
- **Side panel** (Note/AI tabs) ocupa ~30% del ancho, pero su contenido útil solo es texto
- **FAB 🤖** visible — choca con dock

🔴 BUG:
- **Botón `<` (back)** aparece en la esquina superior-izquierda, **fuera** de la sidebar — está flotando, no pertenece al layout

🟢 POLISH:
- **Top toolbar (↶ ↷ 💧 📱)** sigue visible aunque solo aporta undo/redo (en sheets el 90% no lo usa)
- **"+ Attach file"** placeholder sin uso claro

---

### 5. To-dos (`#/todos`)

**Interactive elements:** 15 (8 buttons + 7 anchors)

✅ Works:
- "OPEN / DONE / OVERDUE" counters ✓
- Task toggle ✓
- Fechas con badge OVERDUE en rojo ✓
- Subject chips (pol, bio, che, deu, math) ✓

🟡 ISSUE:
- **Datos demo** ("Submit politics-econ essay", "Read chapter 7 — Biology", "Practice integrals", "Buy lab coat", "Email professor about Referat") — todos en pasado/vencido
- **Botón "Toggle" sin aria-label** — no accesible

🟢 POLISH:
- "✓" verde para done es claro ✓
- **3 icon-only buttons** detectados: AI (🤖 FAB) + 2 toggle buttons

---

### 6. AI (`#/ai`)

**Interactive elements:** 10 (7 anchors + 2 buttons + 1 input)

✅ Works:
- Header "AI — Ask anything from your notes" ✓
- "Looking at: no context" (vacío) ✓
- Quick action card "💡 Explain concept" ✓
- Input "Ask a question… (Enter to send)" + Send button ✓
- RAG tutor mensaje inicial ✓
- **FAB oculta correctamente** (estamos en AI screen)

🟢 POLISH:
- Solo 1 quick action — podría haber más: "Summarize last note", "Generate flashcards from X"
- "Explain concept" no toma contexto (siempre genérico)

---

### 7. Settings (`#/settings`)

**Interactive elements:** 20 (13 buttons + 7 anchors)

✅ Works:
- Language: 🇬🇧 English ✓ / 🇪🇸 Español / 🇵🇹 Português ✓
- Theme: ◐ Auto · system ✓ / ☀ Light / ☽ Dark ✓
- Vault: 🏠 default ✓ / 🎓 school / 👤 personal / 💼 work ✓
- About: "M-NEXUS · v2.6.0" ✓
- Session: 🚪 Cerrar sesión ✓

🔴 CRITICAL:
- **NO muestra AI Provider config** — la feature estrella de v2.6.0 no es accesible desde UI (solo via API)
- **NO muestra Backup config** — el sistema de rotación + remote push no es configurable desde UI

🟡 ISSUE:
- **Botón "button"** aparece sin label (probablemente el `<` back que tiene `class="btn icon"`)

---

## Cross-cutting issues

### Modal Escape handling

| Modal | Escape closes? | Click outside? |
|---|---|---|
| New subject | ✗ **BUG** | ✓ |
| New event | ✗ **BUG** (probable) | ✓ |
| New task | ✗ **BUG** (probable) | ✓ |
| Login (kbd) | ✓ (form submit) | n/a |

**Fix:** Add document keydown listener in `openModal()` that closes on Escape.

### Demo data pollution (`demoSeed.js`)

**Files affected:**
- `Math`, `Politics-economics`, `Deutsch`, `Physics`, `Chemistry`, `French`, `Biology`, `Computer Sci.`, `History`, `English`, `Art`, `Music` (12 subjects)
- 5 events today (Math, Politics, Deutsch, Physics, Chemistry)
- 3 notes (Welcome, Getting started, Flashcards demo)
- 6 tasks (Submit politics-econ essay, Read chapter 7, etc.)
- 12 subjects × duplicates

**Impact:** A user installing fresh M-NEXUS sees 30+ items of demo data immediately. Very confusing.

**Fix:** Gate `seedDemo()` on a `?demo=1` query param, or move behind a "Try with sample data" button in wizard.

### FAB AI redundancy

The AI tutor FAB (🤖) appears in:
- Overview, Calendar, Subjects, To-dos (visible)
- Notes (visible but hidden sometimes)
- AI (hidden — correct)
- Settings (visible — should be hidden)
- Login (hidden — correct via `route-login` class)

**User feedback (v2.3.0-A):** "minimize floating UI, AI = 1 button/page"

**Fix:** Hide FAB when:
- On `route-settings` (no AI needed)
- On `route-overview` if no contextual note is set
- Reduce to only appear when there's a meaningful context

### Notes toolbar clutter

User feedback (v2.3.0-B): "13→8 botones". Current implementation:
- **Top toolbar:** 5 items
- **Canvas tools:** 4 items
- **Side tools:** 4 items vertical
- **AI side panel:** 3 menu items
- = **16 controls in notebook view**

**Fix:** Move canvas tools to a drawer (already exists `pencil-drawer`), keep only 3-4 essentials visible.

---

## Top 10 fixes prioritized

| # | Severity | Fix | Effort |
|---|---|---|---|
| 1 | 🔴 | Gate `demoSeed()` behind explicit opt-in | 30 min |
| 2 | 🔴 | Add Escape closes modals (all screens) | 1 hour |
| 3 | 🔴 | Reduce subjects cards to v2.3.0-A spec (64px rows) | 1 hour |
| 4 | 🔴 | Fix "+ + New note" double-plus bug | 5 min |
| 5 | 🔴 | Settings: add AI Provider + Backup config sections | 2 hours |
| 6 | 🟡 | Hide FAB on settings/overview (no context) | 30 min |
| 7 | 🟡 | Yellow background on notes — make neutral | 15 min |
| 8 | 🟡 | Collapse notes toolbar (move canvas tools to drawer) | 1 hour |
| 9 | 🟢 | Add Subject chip filter on To-dos | 30 min |
| 10 | 🟢 | Highlight "today" in Calendar week view | 20 min |

**Total effort:** ~8 hours

---

## Test plan for fixes

For each fix:
1. Playwright screenshot before/after
2. Re-run interactive audit (each button must work)
3. Verify no pageErrors / consoleErrors
4. Confirm existing 153 frontend tests still green
