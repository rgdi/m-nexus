# M-NEXUS v2.6-v2.9 Showcase

Captures Playwright reales de los flujos completos de la app.

## Login & Setup
- `01-login.png` — Pantalla de login (M-NEXUS, Sign in, "Your session lasts 90 days")
- `wizard-1.png` … `wizard-8.png` — Setup wizard 8 slides (welcome → vault → subject → notebook → FSRS → finish → AI provider → admin+backups)

## Desktop (1440×900)
- `02-overview.png` — Overview con subjects cards + at a glance + quick notes + botones especiales (Cross-verify, Generate exam, 3D Graph, Syllabus tracker)
- `03-cmd-palette-empty.png` — Ctrl+K command palette (empty state)
- `04-cmd-palette-search.png` — Search "math" con resultados agrupados por SUBJECTS/NOTES/TASKS/EVENTS
- `05-cmd-palette-flashcards.png` — Search "capital" muestra Flashcards section
- `06-notes-editor-with-toolbar.png` — Notes editor limpio con Math seleccionada, 5 side-tabs, bottom toolbar consolidado, dock adaptativo, online pill verde
- `07-side-cards.png` — Side panel tab Cards: "Cards of «Math»" + "+ New card" form
- `08-side-media.png` — Side panel tab Media: "Attachments of «Math»" + other notes list
- `09-side-list.png` — Side panel tab List: searchable list con subject badges, current note highlighted
- `10-side-ai.png` — Side panel tab AI: contextual quick actions (Generate Clozes, Summarize Note, Make Flashcards, Open full AI)

## 3D Bone Viewer (Anatomy)
- `26-3d-bone-humerus.png` — Modal overlay con húmero procedural + 14 hotspots anatómicos (Cabeza humeral, Cuello anatómico, Troquiter, Troquín, Surco intertubercular, Cuello quirúrgico, Tuberosidad deltoidea, Surco del nervio radial, Fosa olecraneana, Epicóndilo medial, Epicóndilo lateral, Fosa coronoidea, Tróclea, Cóndilo/capitulum). Hint text "Drag to rotate · Long-press to add label"
- `27-3d-rotated.png` — Modelo rotado vía drag, hotspots siguen proyectados correctamente

## Image Occlusion
- `12-occlusion-screen.png` — Upload/URL toggle, lista de occlusion cards existentes
- `24-occlusion-editor-open.png` — Editor modal con SVG del húmero (cabeza ovalada + cuerpo + epífisis distal), botones Save / Save + queue for approval / ✕
- `25-occlusion-with-masks.png` — 3 máscaras dibujadas (Cabeza humeral, Troquiter, Epicóndilo medial) con labels rojos y ✕ delete

## Diagnostic / Simulator / FSRS
- `13-diagnostic-profile.png` — Resultado de 7 preguntas: Knowledge 100% / Confidence 94% / Initial stability 13.64d / Difficulty 1/10 / Target retention 89%. By-concept breakdown con barras violetas
- `14-exam-simulator.png` — Future-exam simulator: 9 sessions / 196 min / 631 cards. Retention curve exponencial. Daily plan con urgency colors
- `15-fsrs-day-by-day.png` — FSRS day-by-day REAL con ts-fsrs: 140 reviews / 30 new / 80% avg / 100% final retention. Curve + daily load

## AI Approvals
- `16-approval-queue.png` — 3 candidates con kind (OCCLUSION / FLASHCARD / CLOZE), confidence badge (81-95%), Approve/Reject buttons

## Settings
- `17-settings-export-ai-backup.png` — Settings con Language/Theme/Vault/Export/AI Provider/Backup

## Responsive
- `18-tablet-overview.png` — Tablet 768×1024
- `19-tablet-notes-editor.png` — Tablet editor con side panel
- `20-mobile-overview.png` — Mobile 375×800 — hamburger dock icon-only
- `21-mobile-notes-toolbar.png` — Mobile notes editor
- `22-mobile-side-cards.png` — Mobile side cards
- `23-mobile-xs-dock.png` — Mobile XS 360×720 ultra-compact
