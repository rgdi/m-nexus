# v2.33.1 — Pending Issues

This file documents the issues filed after the v2.33.1 release.
Each issue has a title, labels, and a body ready to be opened
via the GitHub UI or via `gh issue create --title "..." --body-...`.

---

## Issue #1 — UI: Tour guiado pantalla por pantalla + tooltips para elementos avanzados

**Title:** [v2.34] Tour guiado pantalla por pantalla + tooltips para elementos avanzados

**Labels:** `enhancement`, `ui`, `a11y`, `v2.34`

**Body:**

### Contexto

Tras v2.33.1 (print preview modal + per-note print config), los usuarios nuevos
se pierden en la app porque hay elementos avanzados (modo del node, FSRS calibration,
Knowledge Graph rebuild, print config, occlusion mode, etc.) que no se explican
inline.

### Propuesta

Implementar un **tour guiado** que:

1. Se active en el primer login del usuario (toggleable en Settings).
2. Vaya pantalla por pantalla: Overview → Calendar → Subjects → Notes →
   To-dos → AI → Journal → Insights → Settings → Drawer (Advanced: PDF, Graph, Cluster).
3. Cada tour muestra un **popup anclado al elemento destacado** con:
   - Título y descripción corta
   - "Siguiente" / "Saltar este" / "Salir del tour"
   - Indicador de progreso (1/9, 2/9, ...)
4. **Tooltips inline** (`<details>` o popover) en elementos avanzados:
   - **Modo del node** (cluster / leader / follower / standalone): explicar la
     topología P2P y cómo afecta a la sync.
   - **FSRS Calibration**: qué hace `patienceFactor` y por qué importa.
   - **Knowledge Graph rebuild**: coste y cuándo hacerlo.
   - **Occlusion mode**: cómo crear máscaras y cómo aparecen al imprimir.
   - **Print config modal**: per-note vs vault-wide (futuro).
   - **Smart Notifications severity tiers**: critical/warning/info/success.

### Acceptance criteria

- [ ] Tour disparable manualmente desde Settings → Help → "Iniciar tour".
- [ ] Tour se guarda en localStorage (`mnexus.tour.completed`) y no se vuelve a mostrar.
- [ ] Tooltips inline para los 6 elementos avanzados listados.
- [ ] Tour responsive: popups flotantes en tablet/phone (no modals fullscreen).
- [ ] Tecla `?` abre el tour en cualquier momento.
- [ ] Tests: tour trigger on first login, manual trigger, tooltip presence.

---

## Issue #2 — UI: Slash commands convertidos en popups separados (no inline en la nota)

**Title:** [v2.34] Slash commands `/f`, `/occlusion`, `/test` → popups separados en lugar de inline en la nota

**Labels:** `enhancement`, `ui`, `notes`, `v2.34`

**Body:**

### Contexto

Actualmente los slash commands (`/f` para flashcard, `/occlusion` para image occlusion,
`/test` para self-test) **inyectan markup inline en el cuerpo de la nota**. Esto:
- Contamina el texto plano de la nota (al exportarla a PDF el placeholder sigue ahí).
- Hace que `[[wikilinks]]` y atomic blocks se entrelacen con elementos UI.
- En móvil/tablet el inline UI rompe el flujo de lectura.

### Propuesta

Convertir cada slash command en un **popup separado** que:

1. **`/f` → Flashcard popup**: se elimina el placeholder inline, se abre un modal/popup
   con el flashcard creator. El popup permite arrastrar y soltar la posición
   (drag con header como handle en desktop; modal bottom-sheet en mobile).
2. **`/occlusion` → Occlusion popup**: igual, draggable en desktop, sheet en mobile.
   Muestra las máscaras creadas y permite editarlas.
3. **`/test` → Self-test popup**: similar. Genera preguntas a partir de la nota
   y las muestra en el popup.

### Mecánica

- El comando `/f` deja de inyectar HTML inline en `note.body`. Solo registra el
  comando y abre el popup.
- El popup referencia el `noteId` y persiste las flashcards/occlusions via API.
- En desktop: popup es una ventana flotante draggable (header es handle, esquinas
  son resize handles).
- En mobile/tablet: popup es un bottom-sheet modal (drag-down para cerrar).
- Los popups NO están atados a la nota: el usuario puede tener varios abiertos
  simultáneamente y arrastrarlos.

### Acceptance criteria

- [ ] `/f` no inyecta HTML inline. Abre flashcard creator popup.
- [ ] `/occlusion` no inyecta HTML inline. Abre occlusion popup.
- [ ] `/test` no inyecta HTML inline. Abre self-test popup.
- [ ] En desktop, popups son draggables (header = handle).
- [ ] En mobile/tablet, popups son bottom-sheet modals con drag-down.
- [ ] Múltiples popups simultáneos soportados.
- [ ] Los popups persisten al navegar entre pantallas (pero no al cerrar la pestaña).
- [ ] Tests: cada popup tiene su propio test de mount/unmount.

---

## Issue #3 — UX: Modal "modo del node" explicativo

**Title:** [v2.34] Modal explicativo del modo del node (cluster topology)

**Labels:** `enhancement`, `ux`, `cluster`, `v2.34`

**Body:**

### Contexto

El componente "modo del node" (en cluster admin) permite a un usuario elegir entre:
- **standalone**: instancia única sin cluster.
- **follower**: replica del leader (read-only writes son forwarded).
- **leader**: recibe writes, las replica a followers.
- **standalone-with-bootstrap**: standalone que aún no descubrió peers.

Es la pieza más técnica y los usuarios no entienden qué cambia.

### Propuesta

Popup/modal que se abre al hacer click en el icono de info (`?`) junto al selector
de modo. Contenido:

```
┌─────────────────────────────────────────────┐
│  Modo del node                              │
│  ─────────────────                          │
│                                              │
│  📦 standalone                               │
│     Instancia única. Tú eres el leader       │
│     implícito. Si quieres escalar más tarde, │
│     cambia a follower y apunta a otro node.  │
│                                              │
│  👑 leader                                   │
│     Recibe writes y las replica a followers. │
│     Si este node cae, los followers          │
│     entran en modo read-only.                │
│                                              │
│  🔗 follower                                 │
│     Réplica del leader. Writes se forwardan. │
│     Si el leader no responde, el cluster     │
│     promueve al follower con más uptime.      │
│                                              │
│  🛰 standalone-with-bootstrap                │
│     Todavía descubriendo peers. Cambia a      │
│     leader/follower cuando termine el scan.   │
│                                              │
│  [Ver diagrama de topología]                  │
│  [Cerrar]                                    │
└─────────────────────────────────────────────┘
```

Con un mini diagrama SVG de 3 nodos y flechas mostrando el flujo de writes.

### Acceptance criteria

- [ ] Icon `?` junto al selector de modo abre el modal.
- [ ] Modal tiene las 4 descripciones + diagrama SVG.
- [ ] Modal accesible (Esc cierra, focus trap).
- [ ] Tooltip inline adicional en el selector con resumen de una línea.

---

## Issue #4 — UI: Tour "first login" auto-trigger

**Title:** [v2.34] Tour "first login" auto-trigger con localStorage flag

**Labels:** `enhancement`, `ui`, `onboarding`, `v2.34`

**Body:**

### Contexto

Necesitamos un tour que se active automáticamente la primera vez que un usuario
entra a la app. Tiene que ser skippable y no aparecer nunca más a menos que el
usuario lo pida explícitamente desde Settings.

### Acceptance criteria

- [ ] `mnexus.tour.completed` en localStorage; ausente → tour se muestra.
- [ ] Botón "Saltar tour" en cada paso.
- [ ] Botón "Salir del tour" en el header del popup.
- [ ] Al completar, `mnexus.tour.completed = Date.now()`.
- [ ] Settings → Help → "Volver a hacer el tour" resetea el flag.
- [ ] Tests para el flow completo.

---

## Cómo crear las issues

```bash
# Opción 1: vía gh CLI
gh issue create --repo rgdi/m-nexus --label "enhancement,ui,a11y,v2.34" \
  --title "[v2.34] Tour guiado pantalla por pantalla + tooltips para elementos avanzados" \
  --body-file .github/ISSUES.md --body-... (extract section 1)

# Opción 2: vía API
curl -X POST -H "Authorization: token $GH_TOKEN" \
  https://api.github.com/repos/rgdi/m-nexus/issues \
  -d '{"title":"...", "body":"...", "labels":["enhancement","v2.34"]}'
```
