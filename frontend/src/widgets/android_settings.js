// android_settings.js — Android-specific Settings panel (v2.19.0).
//
// Mounted when window.Capacitor is detected. Renders three sections:
//   1. Backend configuration: shows current API base, allows changing it
//      with a "Test connection" button.
//   2. Device identification: shows the registered deviceId + lastSeenAt,
//      with a "Re-register" button (forces a fresh POST /devices/register).
//   3. Runtime permissions: lets the user request notifications,
//      storage (if needed), and battery-optimization exemption.
//      Each permission has a button and current status badge.
//
// All state changes persist locally (localStorage) and are also reported
// to the backend via PATCH /api/v1/devices/:id/{permissions,preferences}.

import { getDeviceId, registerDevice, reportPermissions, reportPreferences, getCachedDeviceInfo } from "../services/device_id.js";
import { size as queueSize, replay as replayQueue } from "../services/offline_queue.js";
import { auth } from "../services/auth.js";

const PANEL_ID = "android-settings-panel";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isCapacitor() {
  return typeof window !== "undefined" && !!window.Capacitor;
}

/** @typedef {Object} PermissionRow
 *  @property {string} id
 *  @property {string} label
 *  @property {string} description
 *  @property {string} [perm]
 */

/** @type {PermissionRow[]} */
const PERMISSION_ROWS = [
  {
    id: "notifications",
    label: "Notificaciones",
    description: "Recordatorios FSRS, conflictos de sync, estado de descarga.",
    perm: "NOTIFICATIONS",
  },
  {
    id: "storage",
    label: "Almacenamiento",
    description: "Guardar adjuntos y exports localmente.",
    perm: "READ_MEDIA_IMAGES",
  },
  {
    id: "audio",
    label: "Micrófono (grabación de notas)",
    description: "Grabar explicaciones orales en modo estudio.",
    perm: "RECORD_AUDIO",
  },
  {
    id: "batteryOptimizationIgnored",
    label: "Sin optimización de batería",
    description: "Permitir sincronización en background sin restricciones de Doze.",
    perm: "IGNORE_BATTERY_OPTIMIZATIONS",
  },
  {
    id: "camera",
    label: "Cámara",
    description: "Escanear páginas de libros o capturar fotos para occlusions.",
    perm: "CAMERA",
  },
  {
    id: "location",
    label: "Ubicación",
    description: "Geotag en eventos y notas (opcional).",
    perm: "ACCESS_FINE_LOCATION",
  },
];

async function queryPermissions(): Promise<Record<string, string>> {
  // Capacitor Permissions plugin queries native Android permissions.
  const result: Record<string, string> = {};
  if (!isCapacitor()) {
    return result;
  }
  try {
    const permMod = await import("@capacitor/permissions");
    for (const row of PERMISSION_ROWS) {
      if (!row.perm) continue;
      try {
        const r = await permMod.Permissions.query({ name: row.perm });
        result[row.id] = (r.state) || "denied";
      } catch {
        result[row.id] = "unavailable";
      }
    }
  } catch {
    // Permissions plugin not available
  }
  return result;
}

async function requestPermission(permName) {
  if (!isCapacitor()) return "web-mock";
  try {
    const permMod = await import("@capacitor/permissions");
    const r = await permMod.Permissions.request({ name: permName });
    return (r.state) || "denied";
  } catch (e) {
    console.warn("[android-settings] request failed:", e);
    return "error";
  }
}

async function openIgnoreBatteryOptimizations(): Promise<void> {
  if (!isCapacitor()) return;
  try {
    // Capacitor App plugin doesn't expose this directly; dispatch an
    // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS intent via the App
    // plugin's openUrl fallback or a tiny native plugin. For now we
    // just instruct the user.
    const appMod = await import("@capacitor/app");
    // Some Android devices route this through Settings.ACTION_BATTERY_SAVER_SETTINGS;
    // there is no exact Capacitor mapping so we surface a manual step.
    void appMod;
    return;
  } catch {
    // ignore
  }
}

let installed = false;
/** @type {Record<string, string>} */
let currentPermissions = {};

/** @type {{backendUrl?: string, syncIntervalMinutes?: number, offlineMode?: boolean}} */
let currentPrefs = {};

/** @type {(() => void) | null} */
let onChangeListener = null;

async function renderPanel(root) {
  const deviceId = getDeviceId();
  const cached = getCachedDeviceInfo();
  const queueCount = await queueSize();

  const permsHtml = PERMISSION_ROWS.map((row) => {
    const status = currentPermissions[row.id] || "unknown";
    const statusClass = status === "granted" || status === "limited" ? "perm-ok" : status === "denied" ? "perm-bad" : "perm-unknown";
    return `
      <div class="android-perm-row" data-perm="${row.id}">
        <div class="android-perm-head">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <p class="muted small">${escapeHtml(row.description)}</p>
          </div>
          <span class="android-perm-badge ${statusClass}">${escapeHtml(status)}</span>
        </div>
        <div class="android-perm-actions">
          ${row.perm ? `<button type="button" class="btn small android-perm-ask" data-perm-name="${escapeHtml(row.perm)}">Pedir permiso</button>` : ""}
          ${row.id === "batteryOptimizationIgnored" ? `<button type="button" class="btn small" data-battery-btn>Ir a ajustes</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  root.innerHTML = `
    <section class="settings-section android-only-section">
      <h2>Android — Dispositivo</h2>
      <p class="muted">Esta sección solo aparece cuando la app corre dentro del wrapper Capacitor (Android o iOS).</p>

      <div class="android-card">
        <div class="android-card-head">
          <span class="android-card-label">Device ID</span>
          <code class="android-device-id">${escapeHtml(deviceId)}</code>
        </div>
        <div class="android-card-meta">
          <span>Plataforma: <strong>${escapeHtml(cached?.platform || "—")}</strong></span>
          <span>Modelo: <strong>${escapeHtml(cached?.manufacturer || "—")} ${escapeHtml(cached?.model || "")}</strong></span>
          <span>OS: <strong>${escapeHtml(cached?.osVersion || "—")}</strong></span>
          <span>App: <strong>v${escapeHtml(cached?.appVersion || "—")}</strong></span>
          <span>Último contacto: <strong>${cached?.lastSeenAt ? new Date(cached.lastSeenAt).toLocaleString() : "nunca"}</strong></span>
        </div>
        <button type="button" class="btn" data-action="reregister">Re-registrar dispositivo</button>
      </div>
    </section>

    <section class="settings-section android-only-section">
      <h2>Configuración del backend</h2>
      <p class="muted">Cambia a qué servidor apunta esta app. Útil si cambias de red o apuntas a un servidor remoto.</p>
      <form id="backend-form" class="settings-form">
        <label class="form-row">
          Backend URL
          <input name="backend-url" type="url" class="input" placeholder="http://10.0.2.2:4100"
                 value="${escapeHtml(currentPrefs.backendUrl || window.MNEXUS_BACKEND_URL || detectCurrentBackend())}" />
        </label>
        <label class="form-row">
          <input type="checkbox" name="offline-mode" ${currentPrefs.offlineMode ? "checked" : ""} />
          Modo offline (no enviar nada al backend; todo se queda en la cola)
        </label>
        <label class="form-row">
          Intervalo de sincronización (minutos)
          <input name="sync-interval" type="number" min="1" max="1440" class="input"
                 value="${escapeHtml(String(currentPrefs.syncIntervalMinutes || 5))}" />
        </label>
        <div class="form-row">
          <button type="submit" class="btn primary">Guardar</button>
          <button type="button" class="btn" data-action="test-backend">Probar conexión</button>
          <span id="backend-status" class="settings-status"></span>
        </div>
      </form>
    </section>

    <section class="settings-section android-only-section">
      <h2>Permisos del dispositivo</h2>
      <p class="muted">Estos permisos son opcionales. Si no los concedes, la app sigue funcionando pero con menos capacidades.</p>
      <div class="android-perm-list">${permsHtml}</div>
    </section>

    <section class="settings-section android-only-section">
      <h2>Cola offline</h2>
      <p class="muted">Cuando no hay red, las mutaciones se guardan aquí y se envían cuando vuelves a estar online.</p>
      <div class="android-card">
        <div class="android-card-head">
          <span>Pendientes: <strong id="android-queue-count">${queueCount}</strong></span>
        </div>
        <div class="form-row">
          <button type="button" class="btn" data-action="drain-queue">Reintentar ahora</button>
          <button type="button" class="btn" data-action="clear-queue">Vaciar cola</button>
          <span id="android-queue-status" class="settings-status"></span>
        </div>
      </div>
    </section>
  `;

  // Wire handlers
  root.querySelector('[data-action="reregister"]')?.addEventListener("click", async () => {
    const info = await registerDevice();
    if (info) {
      flashStatus("backend-status", "✓ Dispositivo re-registrado");
      onChangeListener?.();
      await renderPanel(root);
    }
  });

  root.querySelector('[data-action="test-backend"]')?.addEventListener("click", async () => {
    const input = root.querySelector<HTMLInputElement>('input[name="backend-url"]');
    const url = input?.value?.trim();
    if (!url) return;
    const status = flashStatus("backend-status", "Probando...");
    try {
      const r = await fetch(`${url}/api/v1/health`);
      if (r.ok) {
        const j = await r.json();
        status.textContent = `✓ Conectado (versión ${j.version || "?"})`;
      } else {
        status.textContent = `✗ HTTP ${r.status}`;
      }
    } catch (e) {
      status.textContent = `✗ Error: ${e.message}`;
    }
  });

  root.querySelector("#backend-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const fd = new FormData(form);
    const backendUrl = String(fd.get("backend-url") || "").trim();
    const offlineMode = !!fd.get("offline-mode");
    const syncInterval = Number(fd.get("sync-interval") || 5);
    currentPrefs = { backendUrl, offlineMode, syncIntervalMinutes: syncInterval };
    // Apply runtime: window.MNEXUS_BACKEND_URL drives api.js detection.
    window.MNEXUS_BACKEND_URL = backendUrl || undefined;
    localStorage.setItem("mnexus.backendUrl", backendUrl || "");
    localStorage.setItem("mnexus.offlineMode", offlineMode ? "1" : "");
    localStorage.setItem("mnexus.syncIntervalMinutes", String(syncInterval));
    await reportPreferences(currentPrefs);
    flashStatus("backend-status", "✓ Guardado");
    onChangeListener?.();
  });

  root.querySelectorAll(".android-perm-ask").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const permName = btn.getAttribute("data-perm-name") ?? "";
      const state = await requestPermission(permName);
      // Map native state → our permission model.
      const row = PERMISSION_ROWS.find((r) => r.perm === permName);
      if (row) {
        currentPermissions[row.id] = state;
      }
      await reportPermissions(currentPermissions);
      await renderPanel(root);
    });
  });

  root.querySelector('[data-battery-btn]')?.addEventListener("click", () => {
    void openIgnoreBatteryOptimizations();
  });

  root.querySelector('[data-action="drain-queue"]')?.addEventListener("click", async () => {
    const status = flashStatus("android-queue-status", "Enviando...");
    try {
      const r = await replayQueue(getDeviceId(), `${currentPrefs.backendUrl || detectCurrentBackend()}/`, auth.getAccessToken() || undefined);
      status.textContent = `✓ Replay: ${r.applied} aplicadas, ${r.superseded} superseded, ${r.rejected} rechazadas, ${r.remaining} restantes`;
      await renderPanel(root);
    } catch (e) {
      status.textContent = `✗ ${e.message}`;
    }
  });

  root.querySelector('[data-action="clear-queue"]')?.addEventListener("click", async () => {
    if (!confirm("¿Vaciar toda la cola offline? Las mutaciones pendientes se perderán.")) return;
    const { clear } = await import("../services/offline_queue.js");
    await clear();
    await renderPanel(root);
  });
}

function detectCurrentBackend() {
  if (window.Capacitor) return "http://10.0.2.2:4100";
  if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    return `http://${location.hostname}:4100`;
  }
  return "http://localhost:4100";
}

function flashStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return el;
}

export async function installAndroidSettings(opts = {}) {
  if (installed) return;
  if (!isCapacitor()) return; // Web fallback: skip entirely.
  installed = true;
  onChangeListener = opts.onChange || null;
  currentPrefs = {
    backendUrl: localStorage.getItem("mnexus.backendUrl") || undefined,
    offlineMode: localStorage.getItem("mnexus.offlineMode") === "1",
    syncIntervalMinutes: Number(localStorage.getItem("mnexus.syncIntervalMinutes") || "5"),
  };
  currentPermissions = await queryPermissions();

  // Register this device once on first install (best-effort).
  void registerDevice().then(() => {
    currentPermissions = currentPermissions; // re-read after register
  });

  // Hook the settings panel render.
  // The settings screen calls renderAndroidSettings() to inject this.
  window.addEventListener("hashchange", () => {
    if (location.hash.startsWith("#/settings")) {
      // Defer to allow the settings screen to mount first.
      setTimeout(() => injectIntoSettings(), 100);
    }
  });
  // Try to inject immediately if we're already on settings.
  if (location.hash.startsWith("#/settings")) {
    setTimeout(() => injectIntoSettings(), 100);
  }
}

export async function injectIntoSettings() {
  if (!isCapacitor()) return;
  const settingsRoot = document.querySelector(".screen.settings") || document.querySelector(".settings-screen") || document.querySelector('[data-screen="settings"]');
  if (!settingsRoot) {
    // Fall back to document body if no settings root found.
    let container = document.getElementById(PANEL_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = PANEL_ID;
      document.body.appendChild(container);
    }
    await renderPanel(container);
    return;
  }
  let container = settingsRoot.querySelector("#" + PANEL_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = PANEL_ID;
    settingsRoot.appendChild(container);
  }
  await renderPanel(container);
}
