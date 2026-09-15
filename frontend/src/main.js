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
import { icon as svgIcon } from "./widgets/icons.js";
import { renderOverview } from "./screens/overview.js";
import { renderCalendar } from "./screens/calendar.js";
import { renderSubjects } from "./screens/subjects.js";
import { renderNotes } from "./screens/notes.js";
import { renderTodos } from "./screens/todos.js";
import { renderAI } from "./screens/ai.js";

const ROUTES = {
  overview: renderOverview,
  calendar: renderCalendar,
  subjects: renderSubjects,
  notes: renderNotes,
  todos: renderTodos,
  ai: renderAI,
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
  const route = parseHash();
  app.dataset.route = route;
  // v1.4.0: clase de pantalla para fondos diferenciados
  app.className = `app screen-${route}`;
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
  // v1.2.0: arrancar watcher de dispositivo (DPR, orientation, theme, etc).
  startDeviceWatch();
  // v1.3.0: montar selector de idioma
  mountLangSwitcher();
  // v1.7.1: theme toggle (light/dark/auto)
  mountThemeToggle();
  setupHamburger();
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
    // Sembrar datos demo la primera vez (si no hay backend ni cache local)
    if (!store.has("seed.v1") && store.keys().filter(k => k.startsWith("col.")).length === 0) {
      const { seedDemo } = await import("./services/demoSeed.js");
      seedDemo(store);
      store.set("seed.v1", true);
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
    </div>
  `;
  document.body.appendChild(drawer);
  drawer.addEventListener("click", (e) => {
    if (e.target.closest("a")) drawer.remove();
    if (!e.target.closest(".panel")) drawer.remove();
  });
}

bootstrap();
