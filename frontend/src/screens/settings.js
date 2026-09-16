/* ============================================================
 * screens/settings.js — central preferences (no floating UI).
 * v2.4.0 — replaces top-right lang switcher + theme toggle.
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { getVaults, getCurrentVault, setCurrentVault } from "../services/vault.js";
import { getTheme, setTheme } from "../services/theme.js";
import { escapeHtml } from "../services/safe.js";
import { auth } from "../services/auth.js";
import { api } from "../services/api.js";

export function renderSettings(root) {
  const curLang = i18n.lang;
  const langs = i18n.languages();
  const curTheme = getTheme();
  const themes = [
    { code: "auto", label: "Auto · system" },
    { code: "light", label: "Light" },
    { code: "dark", label: "Dark" },
  ];
  const vaults = getVaults();
  const curVault = getCurrentVault();

  root.innerHTML = `
    <div class="screen" style="max-width: 720px; padding: var(--s-6)">
      <header class="screen-header">
        <button class="btn icon" id="back">${backIcon()}</button>
        <h1 class="h-title">Settings</h1>
      </header>

      <section class="settings-section">
        <h2>Language</h2>
        <p class="muted">Interfaz / Idioma / Idioma</p>
        <div class="settings-grid">
          ${langs.map(l => `
            <button class="settings-option ${l.code === curLang ? "active" : ""}" data-lang="${l.code}">
              <span class="flag">${l.flag}</span>
              <span class="name">${escapeHtml(l.name)}</span>
              <span class="check">${l.code === curLang ? "✓" : ""}</span>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="settings-section">
        <h2>Theme</h2>
        <p class="muted">Apariencia visual</p>
        <div class="settings-grid">
          ${themes.map(t => `
            <button class="settings-option ${t.code === curTheme ? "active" : ""}" data-theme="${t.code}">
              <span class="ico">${t.code === "light" ? "☀" : t.code === "dark" ? "☽" : "◐"}</span>
              <span class="name">${escapeHtml(t.label)}</span>
              <span class="check">${t.code === curTheme ? "✓" : ""}</span>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="settings-section">
        <h2>Vault</h2>
        <p class="muted">Espacio de notas independiente</p>
        <div class="settings-grid">
          ${vaults.map(v => `
            <button class="settings-option ${v === curVault ? "active" : ""}" data-vault="${escapeHtml(v)}">
              <span class="ico">${vaultIcon(v)}</span>
              <span class="name">${escapeHtml(v)}</span>
              <span class="check">${v === curVault ? "✓" : ""}</span>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="settings-section">
        <h2>About</h2>
        <p class="muted">M-NEXUS · v2.6.0</p>
        <p class="muted">Education Service · Offline-first</p>
      </section>

      <section class="settings-section">
        <h2>Session</h2>
        <p class="muted">Cerrar sesión en este dispositivo</p>
        <button class="settings-option" id="logout-btn">
          <span class="ico">🚪</span>
          <span class="name">Cerrar sesión</span>
        </button>
      </section>
    </div>
  `;

  root.querySelector("#back").addEventListener("click", () => {
    location.hash = "#/overview";
  });
  root.querySelectorAll("[data-lang]").forEach((b) => {
    b.addEventListener("click", () => {
      i18n.setLang(b.dataset.lang);
      renderSettings(root);
    });
  });
  root.querySelectorAll("[data-theme]").forEach((b) => {
    b.addEventListener("click", () => {
      setTheme(b.dataset.theme);
      renderSettings(root);
    });
  });
  root.querySelectorAll("[data-vault]").forEach((b) => {
    b.addEventListener("click", () => {
      setCurrentVault(b.dataset.vault);
      location.reload(); // vaults are isolated namespaces, fresh load is safest
    });
  });
  const logoutBtn = root.querySelector("#logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (!confirm("¿Cerrar sesión en este dispositivo?")) return;
      try { await api.auth?.logout?.(); } catch { /* best effort */ }
      auth.clearTokens();
      location.hash = "#/login";
      location.reload();
    });
  }
}

function backIcon() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
}

function vaultIcon(name) {
  const map = {
    default: "🏠",
    school: "🎓",
    personal: "👤",
    work: "💼",
  };
  return map[name] || "📁";
}
