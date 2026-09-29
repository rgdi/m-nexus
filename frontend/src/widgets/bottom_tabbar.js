/* ============================================================
 * widgets/bottom_tabbar.js — Mobile bottom navigation.
 *
 * v2.35.0 — 5 tabs, safe-area aware, badge support, active state
 * synced to the hash router. Mounted once in main.js; only visible
 * on viewports ≤ 820px (CSS hides it elsewhere).
 *
 * Tabs:
 *   Home   #/overview
 *   Notes  #/notes
 *   Study  #/study      (new — swipeable flashcard session)
 *   Stats  #/progress   (new — heatmap + charts)
 *   You    #/settings
 * ============================================================ */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/>',
  notes: '<path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>',
  study: '<path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  you: '<circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
};

const TABS = [
  { id: "home", hash: "#/overview", label: "Inicio", i18n: "dock.overview", icon: "home" },
  { id: "notes", hash: "#/notes", label: "Notas", i18n: "dock.notes", icon: "notes" },
  { id: "study", hash: "#/study", label: "Estudiar", i18n: "dock.study", icon: "study" },
  { id: "stats", hash: "#/progress", label: "Progreso", i18n: "dock.progress", icon: "stats" },
  { id: "you", hash: "#/settings", label: "Tú", i18n: "dock.settings", icon: "you" },
];

let barEl = null;
let badgeCounts = { study: 0, notes: 0 };

export function mountBottomTabbar(host = document.body) {
  if (document.getElementById("m-tabbar")) return document.getElementById("m-tabbar");

  barEl = document.createElement("nav");
  barEl.id = "m-tabbar";
  barEl.className = "m-tabbar";
  barEl.setAttribute("role", "tablist");
  barEl.setAttribute("aria-label", "Navegación principal");
  barEl.innerHTML = TABS.map((t) => `
    <a class="m-tab${t.id === "study" ? " m-tab--study" : ""}"
       href="${t.hash}"
       data-tab-id="${t.id}"
       data-i18n="${t.i18n}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.icon]}</svg>
      <span>${t.label}</span>
      <span class="m-tab-badge" data-badge-for="${t.id}" hidden>0</span>
    </a>
  `).join("");

  host.appendChild(barEl);

  // Keep active state in sync with the router.
  const sync = () => {
    const cur = (location.hash || "#/overview").split("?")[0];
    for (const a of barEl.querySelectorAll(".m-tab")) {
      const isActive = a.getAttribute("href").split("?")[0] === cur;
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  };
  window.addEventListener("hashchange", sync);
  sync();

  return {
    el: barEl,
    setBadge(tabId, n) {
      badgeCounts[tabId] = n;
      const b = barEl.querySelector(`[data-badge-for="${tabId}"]`);
      if (!b) return;
      if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = false; }
      else b.hidden = true;
    },
    setLabel(tabId, text) {
      const a = barEl.querySelector(`[data-tab-id="${tabId}"] span:not(.m-tab-badge)`);
      if (a) a.textContent = text;
    },
    destroy() {
      window.removeEventListener("hashchange", sync);
      barEl.remove();
      barEl = null;
    },
  };
}

/** Convenience: bump the Study tab badge from the FSRS due count. */
export function setStudyBadge(n) {
  const b = document.querySelector('[data-badge-for="study"]');
  if (!b) return;
  if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = false; }
  else b.hidden = true;
}
