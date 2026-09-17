/* ============================================================
 * screens/settings.js — central preferences (no floating UI).
 * v2.4.0 — replaces top-right lang switcher + theme toggle.
 * v2.6.0 — exposes AI Provider + Backup configuration.
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { getVaults, getCurrentVault, setCurrentVault } from "../services/vault.js";
import { getTheme, setTheme } from "../services/theme.js";
import { escapeHtml } from "../services/safe.js";
import { auth } from "../services/auth.js";
import { api } from "../services/api.js";

const AI_PROVIDERS = [
  { value: "mock", label: "Skip (mock — no real AI)" },
  { value: "ollama", label: "Ollama (local, private, free)" },
  { value: "openrouter", label: "OpenRouter (pay-per-use, many models)" },
  { value: "openai", label: "OpenAI-compatible (LM Studio, vLLM, etc.)" },
];

export async function renderSettings(root) {
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

  // Load AI + Backup config from server (graceful fail if not admin / offline)
  let aiConfig = { provider: "mock", model: "mock-1", enabledAt: 0 };
  let backupConfig = { intervalHours: 24, keepDaily: 30, keepMonthly: 12, remoteCommand: "" };
  let aiSaveStatus = "";
  let backupSaveStatus = "";

  try {
    const data = await api.admin.getAI();
    aiConfig = { ...aiConfig, ...data };
  } catch {
    /* not admin / offline */
  }
  try {
    const data = await api.admin.getBackup();
    backupConfig = { ...backupConfig, ...(data?.config ?? {}) };
  } catch {
    /* not admin / offline */
  }

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
        <h2>AI Provider</h2>
        <p class="muted">${aiConfig.provider === "mock" ? "Mock fallback — no AI configured" : `Currently: ${escapeHtml(aiConfig.provider)} / ${escapeHtml(aiConfig.model)}`}</p>
        <form id="ai-form" class="settings-form">
          <div class="form-row">
            <label>Provider
              <select name="ai-provider" class="input">
                ${AI_PROVIDERS.map(p => `<option value="${p.value}" ${p.value === aiConfig.provider ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="form-row" data-when="ollama,openai">
            <label>Base URL
              <input name="ai-baseUrl" class="input" value="${escapeHtml(aiConfig.baseUrl || "")}" placeholder="http://localhost:11434" />
            </label>
          </div>
          <div class="form-row" data-when="openrouter,openai">
            <label>API Key
              <input name="ai-apiKey" type="password" class="input" value="${escapeHtml(aiConfig.apiKey || "")}" placeholder="${aiConfig.apiKey ? "(unchanged)" : "paste here"}" />
            </label>
          </div>
          <div class="form-row">
            <label>Model
              <input name="ai-model" class="input" value="${escapeHtml(aiConfig.model || "")}" placeholder="llama3.1:8b" />
            </label>
          </div>
          <div class="form-row">
            <button type="submit" class="btn primary">${i18n.t("common.save")}</button>
            <button type="button" class="btn" id="ai-test-btn">🔌 ${i18n.t("settings.test")}</button>
            <span id="ai-status" class="settings-status">${escapeHtml(aiSaveStatus)}</span>
          </div>
        </form>
      </section>

      <section class="settings-section">
        <h2>Backup</h2>
        <p class="muted">Automatic snapshots with rotation</p>
        <form id="backup-form" class="settings-form">
          <div class="form-row">
            <label>Frequency
              <select name="bk-interval" class="input">
                <option value="6"  ${backupConfig.intervalHours === 6 ? "selected" : ""}>Every 6 hours</option>
                <option value="12" ${backupConfig.intervalHours === 12 ? "selected" : ""}>Every 12 hours</option>
                <option value="24" ${backupConfig.intervalHours === 24 || !backupConfig.intervalHours ? "selected" : ""}>Every 24 hours</option>
                <option value="0"  ${backupConfig.intervalHours === 0 ? "selected" : ""}>Disabled</option>
              </select>
            </label>
            <label>Keep daily
              <select name="bk-keep-daily" class="input">
                <option value="7"  ${backupConfig.keepDaily === 7 ? "selected" : ""}>7</option>
                <option value="30" ${backupConfig.keepDaily === 30 || !backupConfig.keepDaily ? "selected" : ""}>30</option>
                <option value="90" ${backupConfig.keepDaily === 90 ? "selected" : ""}>90</option>
              </select>
            </label>
          </div>
          <div class="form-row">
            <label>Remote command (optional)
              <input name="bk-remote" class="input" value="${escapeHtml(backupConfig.remoteCommand || "")}" placeholder="rclone copy {} remote:bucket/backups" />
            </label>
            <small>{} is replaced with the backup file path.</small>
          </div>
          <div class="form-row">
            <button type="submit" class="btn primary">${i18n.t("common.save")}</button>
            <button type="button" class="btn" id="bk-run-btn">▶ ${i18n.t("settings.runNow")}</button>
            <span id="bk-status" class="settings-status">${escapeHtml(backupSaveStatus)}</span>
          </div>
        </form>
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

  // ── Wire up handlers ──────────────────────────────────────
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
      location.reload();
    });
  });

  // AI form: show/hide conditional fields
  const aiSelect = root.querySelector('select[name="ai-provider"]');
  const updateAIFields = () => {
    const v = aiSelect.value;
    root.querySelectorAll(".form-row[data-when]").forEach((row) => {
      const showOn = row.dataset.when.split(",");
      row.style.display = showOn.includes(v) ? "" : "none";
    });
  };
  aiSelect.addEventListener("change", updateAIFields);
  updateAIFields();

  // AI form submit
  root.querySelector("#ai-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const status = root.querySelector("#ai-status");
    status.textContent = i18n.t("settings.saving");
    try {
      await api.admin.setAI({
        provider: fd.get("ai-provider"),
        baseUrl: fd.get("ai-baseUrl") || undefined,
        apiKey: fd.get("ai-apiKey") || undefined,
        model: fd.get("ai-model"),
      });
      status.textContent = "✓ " + i18n.t("settings.saved");
    } catch (err) {
      status.textContent = "✗ " + (err.message || "error");
    }
  });

  // AI test button
  root.querySelector("#ai-test-btn").addEventListener("click", async () => {
    const status = root.querySelector("#ai-status");
    status.textContent = i18n.t("settings.testing");
    try {
      const data = await api.admin.testAI();
      status.textContent = data.ok ? "✓ " + i18n.t("settings.aiWorks") : "✗ " + data.message;
    } catch (err) {
      status.textContent = "✗ " + (err.message || "error");
    }
  });

  // Backup form submit
  root.querySelector("#backup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const status = root.querySelector("#bk-status");
    status.textContent = i18n.t("settings.saving");
    try {
      await api.admin.setBackup({
        intervalHours: Number(fd.get("bk-interval") ?? 24),
        keepDaily: Number(fd.get("bk-keep-daily") ?? 30),
        keepMonthly: 12,
        remoteCommand: fd.get("bk-remote") || undefined,
      });
      status.textContent = "✓ " + i18n.t("settings.saved");
    } catch (err) {
      status.textContent = "✗ " + (err.message || "error");
    }
  });

  // Backup run now
  root.querySelector("#bk-run-btn").addEventListener("click", async () => {
    const status = root.querySelector("#bk-status");
    status.textContent = i18n.t("settings.running");
    try {
      const data = await api.admin.runBackup();
      status.textContent = data.ok ? "✓ " + i18n.t("settings.backupDone") : "✗ " + (data.error || "error");
    } catch (err) {
      status.textContent = "✗ " + (err.message || "error");
    }
  });

  // Logout
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
