# CHECKLIST ÉPICO M-NEXUS — Sesión 2026-09-10

> **Pedido del usuario:** 25+ items. Implementar TODO. Sin prisa pero sin pausa.
> **Estado inicial:** v0.47.36 (build 103), 582/582 tests backend pasan.

## ESTADO ACTUAL POR ITEM (audit inicial)

### GRUPO A — Bugs críticos existentes

| # | Item | Estado | Acción |
|---|---|---|---|
| A1 | Errores: botones Anki no repiten en misma sesión | ❓ Sin verificar | Auditar flashcard_review |
| A2 | Formato APKG importación | ✅ Backend OK (importService.ts) | ❌ Falta UI client |
| A3 | Mover/cambiar notas de carpeta (con flashcards) | ❌ Sin UI move/rename | Implementar |
| A4 | Markdown se ve en plaintext | ❓ Sin verificar | Auditar note_view |
| A5 | Flashcards auto no deben aprobarse automáticamente | ❓ Sin verificar | Auditar auto_flashcard_service |
| A6 | Dibujo sobre texto tipo Samsung Notes | ✅ Existe handwriting_canvas.dart | Verificar integración |
| A7 | AI Tutor con nota en contexto + historial | ❌ Parcial (LocalTutorService existe) | Implementar historial |
| A8 | Editar flashcard + acceso a fuente | ❓ Sin verificar | Auditar |
| A9 | Interconexión notas → PDF/PPT con IA | ❌ NO EXISTE | Implementar desde cero |
| A10 | Navegación archivos: crear/renombrar/mover | ❌ Solo create | Añadir move/rename |
| A11 | Editor rich text (Samsung Notes + Google Docs) | ❌ Markdown puro | Implementar rich text |
| A12 | Settings: eliminar 'asignaturas' | ❓ Sin verificar | Auditar settings_screen |
| A13 | Flashcards auto: aprobadas + en main como recientes | ❓ Sin verificar | Verificar |
| A14 | Sección verificación desde main | ❌ Sin sección | Implementar |
| A15 | Nota diaria estilo Notion (tasks, calendario) | ❌ Básica | Implementar |
| A16 | Home: subject actual + tareas | ❌ Solo métricas | Mejorar |
| A17 | Calendario: día anterior al seleccionar | ❌ Bug confirmado | Fix |
| A18 | Audio recorder clases con auto-asignación | ❌ NO EXISTE | Implementar |
| A19 | Sync backend: notas, flashcards, imágenes | ❓ Backend OK, client? | Verificar |
| A20 | Text 125% overflow 22px en TODAS pantallas | ❓ Sin verificar | Test + fix |

### GRUPO B — Audit y limpieza

| # | Item | Estado |
|---|---|---|
| B1 | Logging exhaustivo en partes sin él | ❌ Parcial |
| B2 | Audit todas features implementadas y su estado | ❌ No documentado |
| B3 | Rediseñar settings (quitar campos inútiles) | ❌ Pendiente |

### GRUPO C — AFFiNE clone (orden directa, no negociable)

| # | Item | Estado |
|---|---|---|
| C1 | Notion-style blocks (heading, list, todo, code, callout, divider, toggle) | ❌ |
| C2 | Tablas editables | ❌ |
| C3 | Slash command menu (`/`) | ❌ |
| C4 | Drag & drop blocks | ❌ |
| C5 | Inline math (KaTeX) | ❌ |
| C6 | Code block con syntax highlight | ❌ |
| C7 | Embeds (YouTube, Twitter, Figma, etc.) | ❌ |
| C8 | Page links bidireccionales | Parcial (wikilinks) |
| C9 | Outline sidebar | ❌ |
| C10 | Multi-column layout | ❌ |
| C11 | Sync end-to-end real-time (estilo AFFiNE) | ❌ |
| C12 | Linked databases (vistas filtradas de notes) | ❌ |
| C13 | Whiteboards | ❌ |
| C14 | Mind maps | ❌ |
| C15 | AI copilot inline | ❌ |
| C16 | Templates gallery | ❌ |
| C17 | Comments & mentions | ❌ |
| C18 | Version history visual | ❌ |
| C19 | Import from Notion/Roam/CSV | ❌ |
| C20 | Export to PDF/HTML/Markdown | ❌ |

## PLAN DE EJECUCIÓN

Voy milestone por milestone. Cada milestone termina con:
- ✅ Tests pasan
- ✅ Push a GitHub
- ✅ Release publicado (debug APK al menos)

### Milestone 1: Fix bugs críticos
- A1, A4, A5, A8, A12, A13, A14, A17, A20, A19
- A2 (UI APKG import)
- A3, A10 (move/rename notes)
- A7, A15, A16 (AI Tutor, daily notes, home)

### Milestone 2: AFFiNE-style editor
- C1-C10 (blocks, slash menu, drag&drop, math, code)
- A6 (Samsung Notes drawing)

### Milestone 3: Interconexión PDF/PPT + AI
- A9 (auto-link a PDFs con embeddings)
- C11 (sync real-time)

### Milestone 4: Audio recorder + clase
- A18

### Milestone 5: Polish + audit final
- B1, B2, B3
- Tests con overflow, accesibilidad, performance

## NOTAS

- **Sin ADB device**: haré tests estructurales + validación Node.js de algoritmos. Tests visuales将通过 flutter analyze + manual code review.
- **AFFiNE es 100% TypeScript/React, m-nexus es Flutter/Dart**: tendré que portar conceptos, no copiar código. Lo que se pueda portar directo lo portaré.
- **No release nocturno automático**: bumpeo + push solo cuando hay un milestone completo y verificado.

## COMMITS

- v0.49.2 → 0.49.2-0.49.10: Milestone 1 (fixes + imports + UI)
- v0.50.x: Milestone 2 (rich text editor)
- v0.51.x: Milestone 3 (interconexión)
- v0.52.x: Milestone 4 (audio)
- v0.53.x: Milestone 5 (polish)

## ESTADO ACTUAL: En progreso Milestone 1.
