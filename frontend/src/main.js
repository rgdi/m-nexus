/* ============================================================
 * main.js — entry, router, bootstrap
 * v1.0.0 — vanilla JS, ES modules. No framework.
 * ============================================================ */

import { api } from "./services/api.js";
import { store } from "./services/store.js";
import { device, startDeviceWatch } from "./services/device.js";
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

function setActiveDock(route) {
  dock.querySelectorAll(".dock-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
}

async function render() {
  const route = parseHash();
  app.dataset.route = route;
  setActiveDock(route);
  app.innerHTML = '<div class="screen"><div class="empty">Cargando…</div></div>';
  try {
    const fn = ROUTES[route];
    await fn(app);
  } catch (e) {
    console.error("[render]", e);
    app.innerHTML = `
      <div class="screen">
        <div class="empty">
          <div class="em-title">Algo falló</div>
          <div>${e.message}</div>
        </div>
      </div>`;
  }
}

window.addEventListener("hashchange", render);

/* ===== Bootstrap ===== */
async function bootstrap() {
  // v1.2.0: arrancar watcher de dispositivo (DPR, orientation, theme, etc).
  startDeviceWatch();

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
  // Exponer device para debug en consola
  if (typeof window !== "undefined") window.__device = device;

  await render();
}

bootstrap();
