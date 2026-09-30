/* widgets/capture_fab.js — v2.38.0
 *
 * The one control that has to be reachable from anywhere: capture a
 * thought before you lose it. A FAB rather than a tab, because a tab
 * costs a slot and the tab bar is already at five, while "record this
 * now" is the action people reach for mid-thought.
 *
 * Hidden on the capture screen itself, and on desktop (where the dock
 * already carries a Captura entry).
 */

const ID = "mn-capture-fab";


/** Las dos cosas que cabe hacer desde un botón flotante, y solo eso. */
function buildMenu(fab) {
  const menu = document.createElement("div");
  menu.className = "mn-fab-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button class="mn-fab-menu-item" role="menuitem" data-go="#/capture">
      <span class="mn-fab-menu-icon" aria-hidden="true">✎</span>
      <span>Capturar algo</span>
    </button>
    <button class="mn-fab-menu-item" role="menuitem" data-ai>
      <span class="mn-fab-menu-icon" aria-hidden="true">✦</span>
      <span>Preguntar a la IA</span>
    </button>`;
  menu.querySelector('[data-go]').addEventListener("click", () => {
    menu.remove();
    location.hash = "#/capture";
  });
  menu.querySelector("[data-ai]").addEventListener("click", () => {
    menu.remove();
    window.dispatchEvent(new CustomEvent("mnexus:open-ai"));
  });
  fab.setAttribute("aria-expanded", "true");
  return menu;
}

export function mountCaptureFab() {
  if (document.getElementById(ID)) return;

  const fab = document.createElement("button");
  fab.id = ID;
  fab.className = "mn-capture-fab";
  fab.type = "button";
  fab.title = "Captura rápida";
  fab.setAttribute("aria-label", "Acciones rápidas");
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-haspopup", "menu");
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>`;

  // v2.38.7 — un solo botón flotante, no dos apilados.
  //
  // El botón de captura y el del tutor de IA ocupaban los dos el mismo
  // hueco, abajo a la derecha, con style inline. En el editor de notas
  // se veían dos círculos morados superpuestos: el de detrás era
  // inalcanzable. La IA tiene ya su propia superficie —el companion,
  // con historial y subconsultas— así que el botón abre un menú corto
  // con las dos cosas en vez de duplicar el acceso.
  fab.addEventListener("click", () => {
    const open = document.querySelector(".mn-fab-menu");
    if (open) {
      open.remove();
      fab.setAttribute("aria-expanded", "false");
      return;
    }
    document.body.appendChild(buildMenu(fab));
  });

  document.addEventListener("click", (ev) => {
    const menu = document.querySelector(".mn-fab-menu");
    if (menu && !menu.contains(ev.target) && ev.target !== fab && !fab.contains(ev.target)) {
      menu.remove();
      fab.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      const menu = document.querySelector(".mn-fab-menu");
      if (menu) {
        menu.remove();
        fab.setAttribute("aria-expanded", "false");
        fab.focus();
      }
    }
  });

  document.body.appendChild(fab);
  syncVisibility();
  window.addEventListener("hashchange", syncVisibility);
}

function syncVisibility() {
  const fab = document.getElementById(ID);
  if (!fab) return;
  // Already there, or the user is looking at the capture screen.
  const onCapture = (location.hash || "").startsWith("#/capture");
  // Desktop has a real dock entry; the FAB would be a duplicate.
  const wide = window.matchMedia("(min-width: 821px)").matches;
  fab.hidden = onCapture || wide;
}

/** Called by the router so a re-render cannot leave it stale. */
export function refreshCaptureFab() {
  syncVisibility();
}
