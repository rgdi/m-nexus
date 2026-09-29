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

export function mountCaptureFab() {
  if (document.getElementById(ID)) return;

  const fab = document.createElement("button");
  fab.id = ID;
  fab.className = "mn-capture-fab";
  fab.type = "button";
  fab.title = "Captura rápida";
  fab.setAttribute("aria-label", "Captura rápida");
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>`;

  fab.addEventListener("click", () => {
    location.hash = "#/capture";
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
