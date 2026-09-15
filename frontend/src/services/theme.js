/* ============================================================
 * theme.js — manual theme control (light/dark/auto).
 * v1.7.1 — persiste en localStorage y aplica atributo data-theme.
 *
 * Valores: "light" | "dark" | "auto"
 * Default: "auto" (sigue prefers-color-scheme)
 *
 * Atributo data-theme en <html>:
 *   "light" — siempre light
 *   "dark"  — siempre dark
 *   ausente o "auto" — usa media query
 * ============================================================ */

const KEY = "mnexus.theme";

export function getTheme() {
  try { return localStorage.getItem(KEY) || "auto"; }
  catch { return "auto"; }
}

export function setTheme(value) {
  try { localStorage.setItem(KEY, value); } catch {}
  applyTheme();
}

export function applyTheme() {
  const t = getTheme();
  const html = document.documentElement;
  if (t === "light" || t === "dark") {
    html.setAttribute("data-theme", t);
  } else {
    html.removeAttribute("data-theme");
  }
}

/** Watch system preference change — solo si theme = auto */
export function watchSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (getTheme() === "auto") applyTheme();
  });
}

/** Monta el botón de toggle en top-right (junto al lang switcher). */
export function mountThemeToggle() {
  if (document.getElementById("theme-toggle")) return;
  const btn = document.createElement("button");
  btn.id = "theme-toggle";
  btn.className = "theme-toggle";
  btn.title = "Theme";
  btn.setAttribute("aria-label", "Toggle theme");
  syncIcon(btn);
  btn.addEventListener("click", () => {
    const cur = getTheme();
    const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
    setTheme(next);
    syncIcon(btn);
    // también re-renderiza
    document.dispatchEvent(new CustomEvent("theme:change"));
  });
  document.body.appendChild(btn);
}

function syncIcon(btn) {
  const t = getTheme();
  const icons = {
    auto: "🌓",
    light: "☀️",
    dark: "🌙",
  };
  btn.textContent = icons[t] || "🌓";
  btn.dataset.theme = t;
}
