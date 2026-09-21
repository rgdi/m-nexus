/* ============================================================
 * screens/settings.js — central preferences (no floating UI).
 * v2.4.0 — replaces top-right lang switcher + theme toggle.
 * v2.6.0 — exposes AI Provider + Backup configuration.
 * v2.16.0 — adds Stylus & pressure section (curve, minP, tilt, hover preview).
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { getVaults, getCurrentVault, setCurrentVault } from "../services/vault.js";
import { getTheme, setTheme } from "../services/theme.js";
import { escapeHtml } from "../services/safe.js";
import { auth } from "../services/auth.js";
import { api } from "../services/api.js";
import { exportVaultJSON, exportNoteMarkdown } from "../widgets/export.js";
import { openAnkiImport, exportMnxToAnki } from "../widgets/anki_import.js";
import {
  getPressureConfig,
  setPressureConfig,
  applyPressureCurve,
  STYLUS_PRESETS,
} from "../services/stylus.js";

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

  // v2.16.0: load stylus config (pressure curve, sensitivity, tilt, hover).
  const stylusCfg = getPressureConfig();
  const pressureCurve = stylusCfg.curve;
  const minPressure = stylusCfg.minPressure;
  const tiltResponse = stylusCfg.tiltResponse;
  const showHover = stylusCfg.showHover;
  let stylusSaveStatus = "";

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
        <h2>Cluster de servidores</h2>
        <p class="muted">varios servidores sincronizando en paralelo, con auto-descubrimiento</p>
        <a class="settings-option" id="cluster-link" href="#/cluster">
          <span class="ico">🛰️</span>
          <span class="name">Administrar cluster</span>
          <span class="muted small">Ver peers, promover/demote, healthcheck</span>
        </a>
      </section>

      <section class="settings-section">
        <h2>Anki interop</h2>
        <p class="muted">Importar o exportar a .apkg (Anki)</p>
        <button class="settings-option" id="anki-import-btn">
          <span class="ico">📥</span>
          <span class="name">Importar deck .apkg</span>
          <span class="muted small">Detecta automáticamente collection.json o anki2</span>
        </button>
        <button class="settings-option" id="anki-export-btn">
          <span class="ico">📤</span>
          <span class="name">Exportar a .apkg</span>
          <span class="muted small">Basic + Cloze, con historial FSRS-6</span>
        </button>
      </section>

      <section class="settings-section">
        <h2>Export</h2>
        <p class="muted">Descarga tu vault para respaldo o migración</p>
        <div class="settings-grid" style="grid-template-columns: 1fr 1fr;">
          <button class="settings-option" id="export-vault">
            <span class="ico">💾</span>
            <span class="name">Full vault (JSON)</span>
            <span class="muted small">All notes, subjects, tasks, events</span>
          </button>
          <button class="settings-option" id="export-current-note">
            <span class="ico">📝</span>
            <span class="name">Current note (Markdown)</span>
            <span class="muted small">Open a note first</span>
          </button>
        </div>
        <div id="export-status" class="muted small" style="margin-top:8px"></div>
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
        <h2>Stylus &amp; pressure</h2>
        <p class="muted">Calibrate how your stylus responds in the notes canvas</p>
        <form id="stylus-form" class="settings-form">
          <div class="form-row">
            <label class="pressure-curve-label">
              Pressure curve
              <select name="st-curve" class="input">
                <option value="linear"      ${pressureCurve === "linear" ? "selected" : ""}>Linear (raw input)</option>
                <option value="soft"        ${pressureCurve === "soft" ? "selected" : ""}>Soft (more responsive at low pressure)</option>
                <option value="firm"        ${pressureCurve === "firm" ? "selected" : ""}>Firm (less responsive at low pressure)</option>
                <option value="exponential" ${pressureCurve === "exponential" ? "selected" : ""}>Exponential (heavier feel)</option>
              </select>
            </label>
            <label class="pressure-curve-label">
              Min pressure (sensitivity floor)
              <input name="st-minP" type="range" min="0" max="0.5" step="0.01" value="${minPressure}" />
              <span class="pressure-curve-value" data-show="st-minP">${minPressure.toFixed(2)}</span>
            </label>
          </div>
          <div class="form-row">
            <label class="pressure-curve-label">
              Tilt response
              <input name="st-tilt" type="range" min="0" max="1" step="0.05" value="${tiltResponse}" />
              <span class="pressure-curve-value" data-show="st-tilt">${tiltResponse.toFixed(2)}</span>
            </label>
            <label class="pressure-curve-label">
              Show hover preview
              <input name="st-hover" type="checkbox" ${showHover ? "checked" : ""} />
            </label>
          </div>
          <div class="form-row">
            <button type="submit" class="btn primary">${i18n.t("common.save")}</button>
            <button type="button" class="btn" id="st-test-btn">Test in canvas</button>
            <span id="st-status" class="settings-status">${escapeHtml(stylusSaveStatus)}</span>
          </div>
          <div class="pressure-curve-preview">
            <canvas id="st-curve-canvas" width="320" height="120"></canvas>
            <small class="muted">Visualizes how raw pressure (x) maps to stroke width (y). Hover the test canvas to preview.</small>
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

  // v2.27.0 — Anki interop buttons
  const ankiImportBtn = root.querySelector("#anki-import-btn");
  if (ankiImportBtn) {
    ankiImportBtn.addEventListener("click", async () => {
      ankiImportBtn.disabled = true;
      try {
        await openAnkiImport(async (res) => {
          // After commit, refresh the page so flashcards re-load.
          if (typeof window !== "undefined" && window.location) {
            // Light toast before reload.
            const toast = document.createElement("div");
            toast.className = "muted small";
            toast.textContent = `✅ Importadas ${res?.persisted ?? 0} tarjetas`;
            ankiImportBtn.parentElement.appendChild(toast);
          }
        });
      } finally {
        ankiImportBtn.disabled = false;
      }
    });
  }
  const ankiExportBtn = root.querySelector("#anki-export-btn");
  if (ankiExportBtn) {
    ankiExportBtn.addEventListener("click", async () => {
      await exportMnxToAnki();
    });
  }

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

  // v2.7.0: Export vault / current note
  const exportVaultBtn = root.querySelector("#export-vault");
  const exportNoteBtn = root.querySelector("#export-current-note");
  const exportStatus = root.querySelector("#export-status");
  if (exportVaultBtn) {
    exportVaultBtn.addEventListener("click", async () => {
      exportStatus.textContent = i18n.t("settings.exporting") || "Exporting…";
      try {
        const v = await exportVaultJSON();
        const counts = `${v.notes.length} notes, ${v.subjects.length} subjects, ${v.tasks.length} tasks, ${v.events.length} events`;
        exportStatus.textContent = (i18n.t("settings.exported") || "Exported") + ` (${counts})`;
      } catch (e) {
        exportStatus.textContent = (i18n.t("settings.exportError") || "Export failed") + ": " + e.message;
      }
    });
  }
  if (exportNoteBtn) {
    exportNoteBtn.addEventListener("click", async () => {
      // Try to find a currently-open note id from sessionStorage hash
      const hash = location.hash;
      const m = hash.match(/[?&]id=([^&]+)/);
      const noteId = m ? decodeURIComponent(m[1]) : null;
      if (!noteId) {
        exportStatus.textContent = i18n.t("settings.openNoteFirst") || "Open a note first";
        return;
      }
      exportStatus.textContent = i18n.t("settings.exporting") || "Exporting…";
      try {
        await exportNoteMarkdown(noteId);
        exportStatus.textContent = i18n.t("settings.exported") || "Exported";
      } catch (e) {
        exportStatus.textContent = (i18n.t("settings.exportError") || "Export failed") + ": " + e.message;
      }
    });
  }

  // v2.16.0: Stylus form submit (pressure curve, sensitivity, tilt, hover).
  const stylusForm = root.querySelector("#stylus-form");
  const curveCanvas = root.querySelector("#st-curve-canvas");
  if (curveCanvas) {
    drawPressureCurvePreview(curveCanvas, pressureCurve);
  }
  if (stylusForm) {
    // Live-update the value chips next to range inputs.
    stylusForm.querySelectorAll('input[type="range"]').forEach((el) => {
      el.addEventListener("input", () => {
        const chip = root.querySelector(`[data-show="${el.name}"]`);
        if (chip) chip.textContent = parseFloat(el.value).toFixed(2);
        // Live-update the curve preview when curve changes.
        const curveSel = stylusForm.querySelector('select[name="st-curve"]');
        if (curveCanvas && curveSel && el.name === "st-curve") {
          // No-op: range is not the curve selector. Curve is in <select>.
        }
        const minP = parseFloat(stylusForm.querySelector('input[name="st-minP"]').value);
        const tilt = parseFloat(stylusForm.querySelector('input[name="st-tilt"]').value);
        drawPressureCurvePreview(curveCanvas, curveSel?.value || pressureCurve, minP, tilt);
      });
    });
    const curveSel = stylusForm.querySelector('select[name="st-curve"]');
    if (curveSel) {
      curveSel.addEventListener("change", () => {
        const minP = parseFloat(stylusForm.querySelector('input[name="st-minP"]').value);
        const tilt = parseFloat(stylusForm.querySelector('input[name="st-tilt"]').value);
        drawPressureCurvePreview(curveCanvas, curveSel.value, minP, tilt);
      });
    }

    stylusForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(stylusForm);
      const status = root.querySelector("#st-status");
      try {
        setPressureConfig({
          curve: fd.get("st-curve") || "linear",
          minPressure: parseFloat(fd.get("st-minP")) || 0,
          tiltResponse: parseFloat(fd.get("st-tilt")) || 0.6,
          showHover: fd.get("st-hover") === "on",
        });
        status.textContent = "✓ " + i18n.t("settings.saved");
      } catch (err) {
        status.textContent = "✗ " + (err?.message || "error");
      }
    });

    // Test button: draw a sample curve using current settings.
    const testBtn = root.querySelector("#st-test-btn");
    if (testBtn) {
      testBtn.addEventListener("click", () => {
        const fd = new FormData(stylusForm);
        const curve = fd.get("st-curve") || "linear";
        const minP = parseFloat(fd.get("st-minP")) || 0;
        const tilt = parseFloat(fd.get("st-tilt")) || 0.6;
        drawPressureCurvePreview(curveCanvas, curve, minP, tilt, true);
      });
    }
  }

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

/**
 * Draws the pressure curve preview: maps raw pressure (x) to stroke width (y).
 * 4 curves: linear, soft, firm, exponential.
 */
function drawPressureCurvePreview(canvas, curveName, minP = 0, tilt = 0.6, test = false) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // Grid
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = (i / 4) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    const y = (i / 4) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Curve
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let px = 0; px <= w; px++) {
    const p = px / w;
    const mapped = applyPressureCurve(p, curveName, { minPressure: minP });
    const y = h - mapped * h * 0.95 - 2;
    if (px === 0) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();
  // Labels
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.font = "10px -apple-system, sans-serif";
  ctx.fillText("Pressure →", 6, 12);
  ctx.fillText(curveName, w - 60, h - 6);
  if (test) {
    ctx.fillStyle = "#ef4444";
    ctx.fillText("✓ preview updated", 6, h - 6);
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
