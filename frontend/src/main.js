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
import { renderCapture } from "./screens/capture.js";
import { renderRag } from "./screens/rag.js";
import { renderGenerate } from "./screens/generate.js";
import { renderMood } from "./screens/mood.js";
import { mountCaptureFab } from "./widgets/capture_fab.js";
import { openAiCompanion } from "./widgets/ai_companion.js";
import { renderAI } from "./screens/ai.js";
import { renderSettings } from "./screens/settings.js";
import { renderJournal } from "./screens/journal.js";
import { renderPdfScreen } from "./screens/pdf.js";
import { renderKgScreen } from "./screens/kg.js";
import { renderV232Screen } from "./screens/v232.js";
import { renderStudy } from "./screens/study.js";
import { renderProgress } from "./screens/progress.js";
import { mountBottomTabbar } from "./widgets/bottom_tabbar.js";
import { renderLogin } from "./screens/login.js";
import { renderCluster } from "./screens/cluster.js";
import { mountPeerIndicator } from "./widgets/peer_indicator.js";
import { mountNotificationBell } from "./widgets/notifications_bell.js";
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
  // v2.38.0: quick capture (tasks / shopping / habits / expenses)
  capture: renderCapture,
  // v2.38.0: folder-scoped Q&A with citations
  rag: renderRag,
  // v2.38.1: generate study material from a folder
  generate: renderGenerate,
  // v2.38.1: mood tracker as its own screen
  mood: renderMood,
  ai: renderAI,
  settings: renderSettings,
  login: renderLogin,
  diagnostic: renderDiagnostic,
  approvals: renderApprovals,
  simulator: renderSimulator,
  "fsrs-sim": renderFsrsSim,
  occlusion: renderOcclusionScreen,
  cluster: renderCluster,
  journal: renderJournal,
  pdf: renderPdfScreen,
  kg: renderKgScreen,
  v232: renderV232Screen,
  // v2.35.0: mobile-first Study + Progress screens
  study: renderStudy,
  progress: renderProgress,
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

/* ===== PWA UI (v2.37.0) =====
 * Wires the service-worker events to something the user can act on.
 * Until now services/pwa.js emitted "installable", "update-available"
 * and "installed" into a Set that nobody was subscribed to, so the
 * whole module ran headless. */
function mountPwaUi(pwa) {
  if (!pwa?.onPwaEvent) return;

  pwa.onPwaEvent((evt) => {
    if (evt.type === "installable" && evt.installable) {
      // Chrome fired beforeinstallprompt and we held on to the event.
      offerInstallBanner(pwa);
    } else if (evt.type === "installable" && evt.manual === "ios") {
      offerManualInstallHint();
    } else if (evt.type === "update-available") {
      offerUpdateBanner(pwa);
    } else if (evt.type === "installed") {
      dismissBanner("mn-pwa-banner");
      try { localStorage.setItem("mnexus.pwa.installed", "1"); } catch {}
    }
  });
}

function dismissBanner(id) {
  document.getElementById(id)?.remove();
}

function offerInstallBanner(pwa) {
  if (document.getElementById("mn-pwa-banner")) return;
  try {
    if (localStorage.getItem("mnexus.pwa.dismissedInstall") === "1") return;
  } catch {}

  const el = document.createElement("div");
  el.id = "mn-pwa-banner";
  el.className = "mn-pwa-banner";
  el.innerHTML = `
    <div class="mn-pwa-banner-txt">
      <strong>Instalar M-NEXUS</strong>
      <span>Se abre como app y funciona sin conexión.</span>
    </div>
    <div class="mn-pwa-banner-acts">
      <button class="mn-pwa-btn mn-pwa-btn--ghost" data-mn-pwa-later>Ahora no</button>
      <button class="mn-pwa-btn" data-mn-pwa-install>Instalar</button>
    </div>`;
  document.body.appendChild(el);

  el.querySelector("[data-mn-pwa-install]")?.addEventListener("click", async () => {
    const ok = await pwa.promptInstall();
    if (ok) dismissBanner("mn-pwa-banner");
  });
  el.querySelector("[data-mn-pwa-later]")?.addEventListener("click", () => {
    try { localStorage.setItem("mnexus.pwa.dismissedInstall", "1"); } catch {}
    dismissBanner("mn-pwa-banner");
  });
}

function offerManualInstallHint() {
  if (document.getElementById("mn-pwa-banner")) return;
  const el = document.createElement("div");
  el.id = "mn-pwa-banner";
  el.className = "mn-pwa-banner";
  el.innerHTML = `
    <div class="mn-pwa-banner-txt">
      <strong>Añadir a pantalla de inicio</strong>
      <span>Comparte → «Añadir a pantalla de inicio».</span>
    </div>
    <div class="mn-pwa-banner-acts">
      <button class="mn-pwa-btn mn-pwa-btn--ghost" data-mn-pwa-later>Entendido</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("[data-mn-pwa-later]")?.addEventListener("click", () => dismissBanner("mn-pwa-banner"));
}

function offerUpdateBanner(pwa) {
  if (document.getElementById("mn-pwa-banner")) return;
  const el = document.createElement("div");
  el.id = "mn-pwa-banner";
  el.className = "mn-pwa-banner";
  el.innerHTML = `
    <div class="mn-pwa-banner-txt">
      <strong>Actualización disponible</strong>
      <span>Recarga para usar la versión nueva.</span>
    </div>
    <div class="mn-pwa-banner-acts">
      <button class="mn-pwa-btn mn-pwa-btn--ghost" data-mn-pwa-later>Luego</button>
      <button class="mn-pwa-btn" data-mn-pwa-reload>Recargar</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("[data-mn-pwa-reload]")?.addEventListener("click", () => pwa.applyUpdate());
  el.querySelector("[data-mn-pwa-later]")?.addEventListener("click", () => dismissBanner("mn-pwa-banner"));
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
  // v2.23.3: peer indicator (top-right server pill + overlay)
  mountPeerIndicator();
  // v2.32.0: Smart notifications bell (FSRS-7 predictive)
  // Mount directly (notif_bell uses appendChild, not innerHTML, to preserve
  // existing children like the #app mount).
  mountNotificationBell(document.body);
  // v2.36.0: PWA (service worker, install prompt, background sync).
  import("./services/pwa.js")
    .then((m) => m.registerPwa())
    .then((m) => mountPwaUi(m))
    .catch(() => {});
  // v2.38.0: capture FAB (mobile only; desktop has the dock entry)
  mountCaptureFab();

  // v2.38.0 — the AI companion opens as a popup from anywhere, the same
  // floating-window machinery the slash commands use. Ctrl/Cmd+K is the
  // shortcut; `?` is already taken by the v2.34.0 tour.
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openAiCompanion();
    }
  });
  document.addEventListener("mnexus:open-ai", () => openAiCompanion());
  // v2.35.0: mobile bottom tab bar (visible ≤ 820px via CSS)
  mountBottomTabbar(document.body);
  // v2.35.0: study tab badge = due card count
  import("./widgets/bottom_tabbar.js").then(async (m) => {
    try {
      const [{ detectApiBase }, { authHeaders }] = await Promise.all([
        import("./services/api_base.js"),
        import("./services/auth.js"),
      ]);
      // v2.37.0: was a bare fetch, so it 401'd once /api/v1/flashcards
      // stopped being a public route and the badge silently showed 0.
      const r = await fetch(`${detectApiBase()}/api/v1/flashcards`, { headers: authHeaders() });
      const j = r.ok ? await r.json() : { cards: [] };
      const now = Date.now();
      const due = (j.cards || []).filter((c) => {
        const f = c?.fsrs;
        if (!f || f.state === "new") return true;
        return typeof f.due !== "number" || f.due <= now;
      }).length;
      m.setStudyBadge(due);
    } catch {}
  }).catch(() => {});
  // v2.0.2: AI tutor FAB
  mountAITutor();
  // v2.0.6: E2E sync via WebSocket
  connectSync();
  // v2.16.0: Conflict merge UI — listens for field-level merges from sync.
  // Lazy-loaded so first paint isn't blocked.
  import("./widgets/conflict_merge_panel.js").then((m) => m.installConflictMergePanel()).catch(() => {});
  // v2.19.0: Android-specific device registration + permissions + offline queue.
  // No-op on web (the module exports a guard that returns early).
  import("./services/device_id.js").then((m) => m.registerDevice()).catch(() => {});
  // v2.21.0: auto-drain offline queue when navigator.onLine fires true.
  // Wires after registerDevice so we have a deviceId + apiBase + auth.
  Promise.all([
    import("./services/device_id.js"),
    import("./services/api_base.js"),
    import("./services/auth.js"),
    import("./services/offline_queue.js"),
  ]).then(([dev, base, auth, queue]) => {
    queue.autoDrainOnOnline(dev.getDeviceId(), base.detectApiBase(), auth.auth.getAccessToken() || undefined);
  }).catch(() => {});
  import("./widgets/android_settings.js").then((m) => m.installAndroidSettings({
    onChange: () => { /* trigger sync queue drain */ }
  })).catch(() => {});
  // v2.21.0: notification capture (Android only, no-op on web).
  import("./services/notif_capture.js").then((m) => m.installNotificationCapture()).catch(() => {});
  setupHamburger();
  setupDockCollapse();
  // v2.22.0: detect notches / camera cutouts / gesture bars and expose
  // window.MNEXUS_SAFE_AREAS + data-* attributes for advanced positioning.
  import("./services/safe_areas.js").then((m) => m.installSafeAreas()).catch(() => {});
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

/**
 * v2.22.0: hamburger drawer redesigned.
 * - Bottom-left FAB (was top-left, overlapped camera on Android).
 * - 56×56 size, exceeds WCAG 2.5.5 touch target (44px).
 * - Positioned with env(safe-area-inset-bottom/left).
 * - Opens a Material Design 3 left-navigation drawer with scrim.
 * - Auto-focuses the close button on open (keyboard accessibility).
 * - Closes on: scrim click, ESC key, link click, close button.
 * - aria-expanded toggles on the FAB so screen readers know the state.
 */
function setupCmdTrigger() {
  if (document.getElementById("cmd-trigger")) return;
  const btn = document.createElement("button");
  btn.id = "cmd-trigger";
  btn.className = "cmd-trigger";
  btn.innerHTML = `<span>🔍</span><span class="cmd-text">Search…</span><kbd>⌘K</kbd>`;
  btn.addEventListener("click", () => openCommandPalette());
  document.body.appendChild(btn);
}

function setupHamburger() {
  const btn = document.getElementById("hamburger");
  if (!btn) return;
  btn.addEventListener("click", () => toggleAppDrawer());
}

let appDrawerOpen = false;

function toggleAppDrawer(force) {
  appDrawerOpen = typeof force === "boolean" ? force : !appDrawerOpen;
  const btn = document.getElementById("hamburger");
  if (appDrawerOpen) {
    openAppDrawer();
    btn && btn.setAttribute("aria-expanded", "true");
  } else {
    closeAppDrawer();
    btn && btn.setAttribute("aria-expanded", "false");
  }
}

function openAppDrawer() {
  closeAppDrawer(); // ensure only one instance
  const cur = (location.hash || "#/overview").split("?")[0];
  const routes = [
    { hash: "#/overview", i18n: "dock.overview", icon: "⊞" },
    { hash: "#/calendar", i18n: "dock.calendar", icon: "▦" },
    { hash: "#/subjects", i18n: "dock.subjects", icon: "◍" },
    { hash: "#/notes",    i18n: "dock.notes",    icon: "✎" },
    { hash: "#/todos",    i18n: "dock.todos",    icon: "✓" },
    { hash: "#/ai",       i18n: "dock.tutor",    icon: "✦" },
    { hash: "#/journal",  i18n: "dock.journal",  icon: "📓" },
    { hash: "#/v232",     i18n: "dock.insights", icon: "💡" },
    { hash: "#/settings", i18n: "dock.settings", icon: "⚙" },
  ];
  // Advanced screens (accessible via drawer, not in dock for mobile clarity)
  const advanced = [
    { hash: "#/pdf",      i18n: "dock.pdf",      icon: "📄" },
    { hash: "#/kg",       i18n: "dock.kg",       icon: "🕸️" },
    { hash: "#/cluster",  i18n: "dock.cluster",  icon: "🛰️" },
    // v2.38.1: two more destinations, kept out of the dock so the
    // bottom bar stays thumb-sized. Both are reachable in one tap
    // from here.
    { hash: "#/generate", i18n: "dock.generate", icon: "✨" },
    { hash: "#/mood",     i18n: "dock.mood",     icon: "💚" },
  ];

  const scrim = document.createElement("div");
  scrim.className = "app-drawer-scrim";
  scrim.setAttribute("aria-hidden", "true");
  scrim.addEventListener("click", () => toggleAppDrawer(false));

  const drawer = document.createElement("aside");
  drawer.id = "app-drawer";
  drawer.className = "app-drawer";
  drawer.setAttribute("role", "navigation");
  drawer.setAttribute("aria-label", "Application menu");
  drawer.setAttribute("aria-hidden", "false");
  drawer.innerHTML = `
    <header class="app-drawer-header">
      <h2>M-NEXUS</h2>
      <button class="app-drawer-close" type="button" aria-label="Close menu">✕</button>
    </header>
    <nav class="app-drawer-nav" aria-label="Primary">
      ${routes.map((r) => `
        <a href="${r.hash}" class="${cur === r.hash ? "active" : ""}" ${cur === r.hash ? 'aria-current="page"' : ""}>
          <span class="icon" aria-hidden="true">${r.icon}</span>
          <span>${i18n.t(r.i18n)}</span>
        </a>
      `).join("")}
    </nav>
    ${advanced.length ? `
      <div class="app-drawer-section">
        <h3>${i18n.t("drawer.advanced")}</h3>
        <nav class="app-drawer-nav" aria-label="Advanced">
          ${advanced.map((r) => `
            <a href="${r.hash}" class="${cur === r.hash ? "active" : ""}" ${cur === r.hash ? 'aria-current="page"' : ""}>
              <span class="icon" aria-hidden="true">${r.icon}</span>
              <span>${i18n.t(r.i18n)}</span>
            </a>
          `).join("")}
        </nav>
      </div>
    ` : ""}
    <footer class="app-drawer-footer">
      <button id="drawer-rerun-setup" type="button">🎬 Re-run setup wizard</button>
    </footer>
  `;

  document.body.appendChild(scrim);
  document.body.appendChild(drawer);

  // Animate in
  requestAnimationFrame(() => {
    scrim.setAttribute("aria-hidden", "false");
    drawer.setAttribute("aria-hidden", "false");
  });

  // Wire close
  drawer.querySelector(".app-drawer-close").addEventListener("click", () => toggleAppDrawer(false));
  drawer.querySelector("#drawer-rerun-setup").addEventListener("click", () => {
    toggleAppDrawer(false);
    resetSetup();
    openSetupWizard({ force: true });
  });
  drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => toggleAppDrawer(false)));

  // Focus the close button for keyboard users
  setTimeout(() => drawer.querySelector(".app-drawer-close")?.focus(), 100);

  // ESC to close
  const onKey = (e) => {
    if (e.key === "Escape") {
      toggleAppDrawer(false);
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  appDrawerOpen = true;
}

function closeAppDrawer() {
  document.querySelector(".app-drawer")?.remove();
  document.querySelector(".app-drawer-scrim")?.remove();
  appDrawerOpen = false;
  document.getElementById("hamburger")?.setAttribute("aria-expanded", "false");
}

/** Backward-compat: legacy drawer called via openDrawer() in some modules. */
function openDrawer() { return openAppDrawer(); }

/* ============================================================
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
