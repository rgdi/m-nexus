/* ============================================================
 * main.js — entry, router, bootstrap
 * v1.0.0 — vanilla JS, ES modules. No framework.
 * ============================================================ */

import { api } from "./services/api.js";
import { detectBackend } from "./services/dataSource.js";
import { mountThemeToggle, applyTheme, watchSystemTheme } from "./services/theme.js";
import * as fsrs from "./services/fsrs.js";
import { store } from "./services/store.js";
import { device, startDeviceWatch } from "./services/device.js";
import { i18n } from "./services/i18n.js";
import { mountLangSwitcher } from "./widgets/lang_switcher.js";
import { showSplash } from "./widgets/splash.js";
import { openSetupWizard, isSetupCompleted, resetSetup } from "./widgets/setup_wizard.js";
import { mountCommandPalette, openCommandPalette } from "./widgets/command_palette.js";
import { mountSwipeNav } from "./widgets/swipe_nav.js";
import { mountOfflinePill } from "./widgets/offline_pill.js";
import { mountVaultSwitcher } from "./services/vault.js";
import { mountAITutor } from "./widgets/ai_tutor.js";
import { connectSync } from "./services/sync_client.js";
import { icon as svgIcon } from "./widgets/icons.js";
import { renderOverview } from "./screens/overview.js";
import { renderCalendar } from "./screens/calendar.js";
import { renderSubjects } from "./screens/subjects.js";
import { renderNotes } from "./screens/notes.js";
import { renderTodos } from "./screens/todos.js";
import { renderAI } from "./screens/ai.js";
import { renderSettings } from "./screens/settings.js";
import { renderLogin } from "./screens/login.js";
import { renderDiagnostic } from "./screens/diagnostic.js";
import { renderApprovals } from "./screens/approvals.js";
import { renderSimulator } from "./screens/simulator.js";
import { renderFsrsSim } from "./screens/fsrs_sim.js";
import { renderOcclusionScreen } from "./screens/occlusion_screen.js";
import { auth } from "./services/auth.js";

const ROUTES = {
  overview: renderOverview,
  calendar: renderCalendar,
  subjects: renderSubjects,
  notes: renderNotes,
  todos: renderTodos,
  ai: renderAI,
  settings: renderSettings,
  login: renderLogin,
  diagnostic: renderDiagnostic,
  approvals: renderApprovals,
  simulator: renderSimulator,
  "fsrs-sim": renderFsrsSim,
  occlusion: renderOcclusionScreen,
};

const app = document.getElementById("app");
const dock = document.getElementById("dock");

function parseHash() {
  const hash = location.hash || "#/overview";
  const name = hash.replace(/^#\//, "").split("/")[0] || "overview";
  return ROUTES[name] ? name : "overview";
}

/** v1.6.2: parsea query string del hash (#/notes?id=X&t=154) */
function parseHashQuery() {
  const hash = location.hash || "#/overview";
  const q = hash.includes("?") ? hash.split("?")[1] : "";
  const params = {};
  q.split("&").forEach((kv) => {
    const [k, v] = kv.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return params;
}

function setActiveDock(route) {
  dock.querySelectorAll(".dock-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
    const label = el.querySelector(".lbl");
    if (label) {
      const i18nKey = label.dataset.i18n || `dock.${el.dataset.route}`;
      label.textContent = i18n.t(i18nKey);
    }
  });
}

async function render() {
  // v2.6.0: gate routes behind auth. Login is always allowed.
  if (!auth.isAuthed() && ROUTES[parseHash()] !== renderLogin) {
    // If we don't have any token, force login. If we have refresh token,
    // the first 401 from any API call will trigger refresh; until then
    // the user can still see data (LAN bypass / public routes).
    // For maximum safety on public deploys: force login if no refresh token.
    if (!auth.hasRefreshToken()) {
      location.hash = "#/login";
      return;
    }
  }
  const route = parseHash();
  app.dataset.route = route;
  // v1.4.0: clase de pantalla para fondos diferenciados
  app.className = `app screen-${route}`;
  // v2.1.3 + v2.6.0: reflect route on body. Use individual class toggles so we
  // don't wipe dock-collapsed / ai-chat-open / etc when changing route.
  document.body.classList.forEach((c) => {
    if (c.startsWith("route-")) document.body.classList.remove(c);
  });
  document.body.classList.add(`route-${route}`);
  document.body.dataset.activeRoute = route;
  // v2.4.0: also expose to global so AI screen can detect current context
  window.__mnexusActiveRoute = route;
  setActiveDock(route);
  app.innerHTML = `<div class="screen"><div class="empty">${i18n.t("common.loading")}</div></div>`;
  try {
    const fn = ROUTES[route];
    await fn(app);
  } catch (e) {
    console.error("[render]", e);
    app.innerHTML = `
      <div class="screen">
        <div class="empty">
          <div class="em-title">${i18n.t("common.error")}</div>
          <div>${escapeHtml(e.message)}</div>
        </div>
      </div>`;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

window.addEventListener("hashchange", render);

/* ===== Bootstrap ===== */
async function bootstrap() {
  // v1.6.3: detectar backend online para activar API
  await detectBackend();
  // v1.7.1: aplicar theme persistido
  applyTheme();
  watchSystemTheme();
  // v1.4.0: splash screen con logo Education Service
  showSplash();
  // v2.1.5: first-run setup wizard (slideshow) — only if not completed yet
  // Run after splash to avoid double-rendering animation overhead
  setTimeout(() => {
    if (!isSetupCompleted()) openSetupWizard();
  }, 800);
  // v1.2.0: arrancar watcher de dispositivo (DPR, orientation, theme, etc).
  startDeviceWatch();
  // v1.3.0: montar selector de idioma
  // v2.4.0: ahora vive dentro de Settings; el botón flotante se oculta.
  mountLangSwitcher();
  // v1.7.1: theme toggle (light/dark/auto)
  // v2.4.0: ahora vive dentro de Settings; el botón flotante se oculta.
  mountThemeToggle();
  // v2.4.0: marcar que Settings está activo → CSS oculta los flotantes.
  document.documentElement.classList.add("v2-4-settings");
  // v1.9.0: command palette (Ctrl+K)
  mountCommandPalette();
  setupCmdTrigger();
  // v2.7.0: mobile swipe navigation
  mountSwipeNav();
  // v2.7.0: offline status pill
  mountOfflinePill();
  // v1.9.3: vault switcher
  mountVaultSwitcher();
  // v2.0.2: AI tutor FAB
  mountAITutor();
  // v2.0.6: E2E sync via WebSocket
  connectSync();
  // v2.16.0: Conflict merge UI — listens for field-level merges from sync.
  // Lazy-loaded so first paint isn't blocked.
  import("./widgets/conflict_merge_panel.js").then((m) => m.installConflictMergePanel()).catch(() => {});
  setupHamburger();
  setupDockCollapse();
  // Set initial lang attribute on html
  document.documentElement.lang = i18n.lang;
  // v1.3.1: traducir todos los data-i18n al boot (dock, etc)
  applyI18nToDom();
  // v1.6.0: inyectar SVG en [data-icon]
  applyIconsToDom();

  // API: si no hay backend en línea, usa fallback offline (localStorage).
  store.bind(api);
  // Detectar backend
  try {
    await api.health();
    document.documentElement.dataset.backend = "online";
  } catch {
    document.documentElement.dataset.backend = "offline";
    // v2.6.0: demo data is opt-in only — no longer pollutes fresh installs.
    // Enable with: localStorage.setItem("mnexus.demo.enabled", "1") then reload,
    // or click "Cargar datos demo" on the Overview screen.
    if (localStorage.getItem("mnexus.demo.enabled") === "1" && !store.has("seed.v1") && store.keys().filter(k => k.startsWith("col.")).length === 0) {
      const { seedDemo } = await import("./services/demoSeed.js");
      seedDemo(store);
      store.set("seed.v1", true);
      // Auto-clear the flag so it doesn't seed again later.
      localStorage.removeItem("mnexus.demo.enabled");
    }
  }
  // Exponer device + i18n para debug en consola
  if (typeof window !== "undefined") {
    window.__device = device;
    window.__i18n = i18n;
    window.__mnexusHashQuery = parseHashQuery;
    window.__mnexusNoteState = window.__mnexusNoteState ?? { selectedId: null };
    window.__mnexusFsrs = fsrs;
  }

// v1.6.3: estado de notas (compartido entre cross-verify y notebook)
document.addEventListener("notes:open", (e) => {
  const id = e.detail?.id;
  if (id) {
    window.__mnexusNoteState.selectedId = id;
    window.__mnexusNoteState.page = 0;
    // re-render si la pantalla actual es notes
    if (parseHash() === "notes") render();
  }
});

  // v1.3.0: re-render al cambiar idioma
  i18n.subscribe(() => {
    applyI18nToDom();
    applyIconsToDom();
    render();
  });

  await render();
}

/** v1.3.1: aplica i18n a todos los elementos con data-i18n en el DOM. */
function applyI18nToDom() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    el.textContent = i18n.t(key);
  });
}

/** v1.6.0: inyecta SVG inline en todos los [data-icon]. */
function applyIconsToDom() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    el.innerHTML = svgIcon(name, 18);
  });
}

/** v1.5.x: hamburger drawer (mobile only) */
function setupHamburger() {
  const btn = document.getElementById("hamburger");
  if (!btn) return;
  btn.addEventListener("click", () => openDrawer());
  // close on outside click
  document.addEventListener("click", (e) => {
    if (e.target.closest(".drawer")) return;
    const d = document.querySelector(".drawer");
    if (d && !d.contains(e.target) && !btn.contains(e.target)) d.remove();
  });
}

/** v1.9.0: command palette trigger button (search box top-center) */
function setupCmdTrigger() {
  if (document.getElementById("cmd-trigger")) return;
  const btn = document.createElement("button");
  btn.id = "cmd-trigger";
  btn.className = "cmd-trigger";
  btn.innerHTML = `<span>🔍</span><span class="cmd-text">Search…</span><kbd>⌘K</kbd>`;
  btn.addEventListener("click", () => openCommandPalette());
  document.body.appendChild(btn);
}

function openDrawer() {
  document.querySelector(".drawer")?.remove();
  const routes = [
    { hash: "#/overview", i18n: "dock.overview", icon: "⊞" },
    { hash: "#/calendar", i18n: "dock.calendar", icon: "▦" },
    { hash: "#/subjects", i18n: "dock.subjects", icon: "◍" },
    { hash: "#/notes",    i18n: "dock.notes",    icon: "✎" },
    { hash: "#/todos",    i18n: "dock.todos",    icon: "✓" },
    { hash: "#/ai",       i18n: "dock.tutor",    icon: "✦" },
  ];
  const cur = location.hash || "#/overview";
  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.innerHTML = `
    <div class="panel">
      <h2 style="margin: 0 0 var(--s-3)">M-NEXUS</h2>
      ${routes.map((r) => `
        <a href="${r.hash}" class="${cur === r.hash ? "active" : ""}" data-i18n="${r.i18n}">
          <span style="margin-right: 10px">${r.icon}</span>
          <span>${i18n.t(r.i18n)}</span>
        </a>
      `).join("")}
      <div style="margin-top: var(--s-4); padding-top: var(--s-3); border-top: 1px solid var(--border)">
        <button id="rerun-setup" style="background:none;border:none;text-align:left;padding:10px 12px;width:100%;cursor:pointer;font-size:14px;color:var(--fg-muted);border-radius:8px">
          🎬 Re-run setup wizard
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(drawer);
  drawer.addEventListener("click", (e) => {
    if (e.target.closest("a")) drawer.remove();
    if (e.target.closest("#rerun-setup")) {
      drawer.remove();
      resetSetup();
      openSetupWizard({ force: true });
      return;
    }
    if (!e.target.closest(".panel")) drawer.remove();
  });
}

/* ============================================================
 * v2.4.0 — Collapsible main menu (dock).
 *
 * User can hide the dock to maximize content area. A small
 * hamburger button re-appears at bottom-left when collapsed.
 *
 * State persists in localStorage["mnexus.dock.collapsed"] = "1"|"0".
 * ============================================================ */
function setupDockCollapse() {
  const expand = document.getElementById("dock-expand");
  if (!expand) return;

  // Restore previous state
  if (localStorage.getItem("mnexus.dock.collapsed") === "1") {
    document.body.classList.add("dock-collapsed");
  }

  // Click expand button → show dock again
  expand.addEventListener("click", () => {
    document.body.classList.remove("dock-collapsed");
    localStorage.setItem("mnexus.dock.collapsed", "0");
  });

  // v2.6.0: keyboard shortcut to TOGGLE (was Ctrl+B only → collapse)
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey && !e.altKey) {
      // Skip when typing in input/textarea
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      e.preventDefault();
      const collapsed = document.body.classList.toggle("dock-collapsed");
      localStorage.setItem("mnexus.dock.collapsed", collapsed ? "1" : "0");
    }
  });

  // v2.4.0: click any active dock item toggles collapse (so user can collapse via dock itself)
  document.querySelectorAll("#dock .dock-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      // Only collapse on second click on the same item (avoid hiding during navigation)
      const current = document.body.dataset.activeRoute;
      const target = item.dataset.route;
      if (current === target) {
        e.preventDefault();
        const collapsed = document.body.classList.toggle("dock-collapsed");
        localStorage.setItem("mnexus.dock.collapsed", collapsed ? "1" : "0");
      }
    });
  });
}

bootstrap();
