/* screens/capture.js — v2.38.0 quick capture.
 *
 * The inbox. One text field, everything else happens automatically:
 *
 *   "comprar pan mañana, ir al gimnasio todos los días, pagué 40€ de luz"
 *     → 3 rows, routed to Compras / Hábitos / Gastos
 *
 * Tabs below switch to one bucket at a time. Nothing is written until
 * the user accepts the preview, so a bad parse costs a tap, not a
 * delete-per-item.
 *
 * The parser is deterministic by default (see services/taskExtractor.ts).
 * The "con IA" toggle exists for the captures the rules cannot settle;
 * the UI labels every row with where it came from, so a row that says
 * "reglas" never claims a model looked at it.
 */

import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";
import { i18n } from "../services/i18n.js";
import { showToast } from "../widgets/toast.js";
import { voiceSupport, isCloudBacked, startDictation, stopDictation, isListening } from "../services/voice.js";

const BASE = detectApiBase();

/** Kind → label. The API speaks English; the user does not. */
const KIND_LABEL = {
  task: "tarea",
  shopping: "compra",
  habit: "hábito",
  expense: "gasto",
  event: "evento",
};
const kindLabel = (k) => KIND_LABEL[k] || k;

const TABS = [
  { kind: "task", label: "Tareas", icon: "✓" },
  { kind: "shopping", label: "Compras", icon: "🛒" },
  { kind: "habit", label: "Hábitos", icon: "🔥" },
  { kind: "expense", label: "Gastos", icon: "€" },
];

let activeTab = "task";
let cache = { task: [], shopping: [], habit: [], expense: [] };
let lastParse = null;

const money = (cents) =>
  (cents / 100).toLocaleString("es", { style: "currency", currency: "EUR" });

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function whenLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dl = d.getTime() - t0;
  if (dl === 0) return "hoy";
  if (dl === 86_400_000) return "mañana";
  if (dl < 0) return "atrasado";
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

async function loadAll() {
  try {
    const res = await Promise.all(
      TABS.map((t) =>
        fetch(`${BASE}/api/v1/tasks/summary?kind=${t.kind}`, { headers: authHeaders() })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    );
    TABS.forEach((t, i) => {
      cache[t.kind] = res[i]?.entries ?? [];
    });
  } catch {
    // Offline: the outbox will replay. Show the last known state.
  }
}

export async function renderCapture(root) {
  root.innerHTML = `
    <section class="screen m-screen cap">
      <div style="padding:calc(var(--m-safe-t) + 18px) 4px 10px">
        <p class="m-eyebrow">Captura rápida</p>
        <h1 class="m-display">ANOTA<br>LO QUE SEA</h1>
        <p class="m-body">Escribe como hablarías. Separa con comas.</p>
      </div>
      <div data-cap-host></div>
    </section>
  `;

  const host = root.querySelector("[data-cap-host]");
  paint(host);
  await loadAll();
  paint(host);
}

function paint(host) {
  const items = cache[activeTab] ?? [];
  const total = TABS.reduce((n, t) => n + (cache[t.kind]?.length ?? 0), 0);

  host.innerHTML = `
    <div class="cap-input-wrap">
      <textarea class="cap-input" data-cap-input rows="3"
        placeholder="comprar pan mañana, llamar al dentista el viernes"
        aria-label="Texto a capturar"></textarea>
      <div class="cap-input-actions">
        <label class="m-switch-toggle">
          <input type="checkbox" data-cap-llm>
          <span class="m-switch-track" aria-hidden="true"><span class="m-switch-knob"></span></span>
          <span class="m-switch-label">con IA</span>
        </label>
        ${voiceSupport() ? `
          <button class="cap-mic" data-cap-mic
                  title="${isCloudBacked()
                    ? "Dictado por voz. En Chrome el audio se envía al servicio de reconhecimento de Google."
                    : "Dictado por voz. Se procesa en el dispositivo."}"
                  aria-label="Dictar por voz">🎙</button>` : ""}
        <button class="m-btn cap-parse" data-cap-parse>Extraer</button>
      </div>
    </div>

    <div class="cap-preview" data-cap-preview ${lastParse ? "" : "hidden"}></div>

    <nav class="cap-tabs" role="tablist">
      ${TABS.map((t) => `
        <button class="cap-tab ${t.kind === activeTab ? "is-active" : ""}"
                role="tab" aria-selected="${t.kind === activeTab}"
                data-cap-tab="${t.kind}">
          <span class="cap-tab-icon">${t.icon}</span>
          <span class="cap-tab-lbl">${t.label}</span>
          <span class="cap-tab-n">${cache[t.kind]?.length ?? 0}</span>
        </button>`).join("")}
    </nav>

    <div class="cap-list" data-cap-list>
      ${items.length === 0 ? `
        <div class="m-empty-state">
          <span class="m-emoji">${TABS.find((t) => t.kind === activeTab)?.icon ?? "✓"}</span>
          <h3>Nada en ${TABS.find((t) => t.kind === activeTab)?.label.toLowerCase()}</h3>
          <p>${total > 0 ? "Elige otra pestaña arriba." : "Escribe arriba y pulsa Extraer."}</p>
        </div>` : items.map(rowHtml).join("")}
    </div>
  `;

  wire(host);
}

function rowHtml(t) {
  const isHabit = (t.kind ?? "task") === "habit";
  return `
    <div class="cap-row" data-id="${esc(t.id)}">
      <button class="cap-check" data-cap-toggle aria-label="Completar"
              aria-pressed="${t.done}">${t.done ? "✓" : ""}</button>
      <div class="cap-row-body">
        <div class="cap-row-text">${esc(t.text)}</div>
        <div class="cap-row-meta">
          ${t.due ? `<span class="cap-chip">${whenLabel(t.due)}</span>` : ""}
          ${t.amountCents ? `<span class="cap-chip cap-chip--money">${money(t.amountCents)}</span>` : ""}
          ${isHabit ? `<span class="cap-chip cap-chip--streak">🔥 ${t.streak ?? 0}</span>` : ""}
          ${t.subject ? `<span class="cap-chip">${esc(t.subject)}</span>` : ""}
        </div>
      </div>
      ${isHabit ? `<button class="cap-habit-btn" data-cap-habit-check aria-label="Registrar hoy">Hoy</button>` : ""}
      <button class="cap-del" data-cap-del aria-label="Eliminar">✕</button>
    </div>`;
}

function wire(host) {
  const input = host.querySelector("[data-cap-input]");
  const llm = host.querySelector("[data-cap-llm]");

  host.querySelector("[data-cap-parse]")?.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) { showToast("Escribe algo primero", "error"); return; }
    const btn = host.querySelector("[data-cap-parse]");
    btn.disabled = true;
    btn.textContent = "Extrayendo…";
    try {
      const r = await fetch(`${BASE}/api/v1/tasks/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text, useLlm: llm?.checked === true, persist: false }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      lastParse = await r.json();
      renderPreview(host);
    } catch (e) {
      showToast(`No se pudo extraer: ${e.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Extraer";
    }
  });

  // v2.38.1 — dictation. The button only exists where the browser can
  // actually transcribe, so there is nothing to disable or explain.
  const mic = host.querySelector("[data-cap-mic]");
  mic?.addEventListener("click", (e) => {
    e.preventDefault();
    if (isListening()) {
      stopDictation();
      return;
    }
    startDictation(input, {
      onStart: () => {
        mic.classList.add("is-live");
        mic.textContent = "⏹";
        mic.setAttribute("aria-label", "Detener dictado");
      },
      onEnd: () => {
        mic.classList.remove("is-live");
        mic.textContent = "🎙";
        mic.setAttribute("aria-label", "Dictar por voz");
      },
      onError: (msg) => {
        showToast(msg, "error");
        mic.classList.remove("is-live");
        mic.textContent = "🎙";
      },
    });
  });

  // Ctrl/Cmd+Enter saves without reaching for the button.
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      host.querySelector("[data-cap-parse]")?.click();
    }
  });

  host.querySelectorAll("[data-cap-tab]").forEach((b) => {
    b.addEventListener("click", () => {
      activeTab = b.dataset.capTab;
      paint(host);
    });
  });

  host.querySelectorAll("[data-cap-toggle]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.closest("[data-id]")?.dataset.id;
      if (!id) return;
      try {
        await fetch(`${BASE}/api/v1/tasks/${id}/toggle`, {
          method: "POST", headers: authHeaders(),
        });
        await loadAll();
        paint(host);
      } catch (e) {
        showToast(`No se pudo guardar: ${e.message}`, "error");
      }
    });
  });

  host.querySelectorAll("[data-cap-del]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.closest("[data-id]")?.dataset.id;
      if (!id) return;
      try {
        await fetch(`${BASE}/api/v1/tasks/${id}`, {
          method: "DELETE", headers: authHeaders(),
        });
        await loadAll();
        paint(host);
      } catch (e) {
        showToast(`No se pudo borrar: ${e.message}`, "error");
      }
    });
  });

  host.querySelectorAll("[data-cap-habit-check]").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.closest("[data-id]")?.dataset.id;
      try {
        const r = await fetch(`${BASE}/api/v1/tasks/${id}/habit-check`, {
          method: "POST", headers: authHeaders(),
        });
        const j = await r.json();
        await loadAll();
        paint(host);
        showToast(`Racha: ${j.streak} ${j.streak === 1 ? "día" : "días"}`);
      } catch (err) {
        showToast(`No se pudo registrar: ${err.message}`, "error");
      }
    });
  });

  // Closure, not a bare reference: addEventListener passes the event,
  // so `acceptAll` would receive the event in place of `host` and blow
  // up on host.querySelector.
  host.querySelector("[data-cap-accept]")?.addEventListener("click", () => acceptAll(host));
  host.querySelector("[data-cap-dismiss]")?.addEventListener("click", () => {
    lastParse = null;
    paint(host);
  });
  host.querySelectorAll("[data-cap-accept-one]").forEach((b) => {
    b.addEventListener("click", () => acceptOne(host, b.dataset.capAcceptOne));
  });
  host.querySelectorAll("[data-cap-drop-one]").forEach((b) => {
    b.addEventListener("click", () => {
      if (lastParse) {
        lastParse.tasks.splice(Number(b.dataset.capDropOne), 1);
        renderPreview(host);
      }
    });
  });
}

/**
 * Preview the parse before anything is written. `how` is shown per row
 * so the user can see which rows the model touched — a row the rules
 * produced is never labelled as AI-graded.
 */
function renderPreview(host) {
  const el = host.querySelector("[data-cap-preview]");
  if (!el || !lastParse) return;
  const { tasks, usedLlm, llmError } = lastParse;

  if (tasks.length === 0) {
    el.hidden = false;
    el.innerHTML = `
      <div class="cap-preview-empty">
        No encontré ninguna tarea ahí. Prueba con algo como
        <code>comprar pan mañana</code>.
      </div>`;
    return;
  }

  el.hidden = false;
  el.innerHTML = `
    <div class="cap-preview-head">
      <span>${tasks.length} ${tasks.length === 1 ? "cosa" : "cosas"}</span>
      ${usedLlm
        ? `<span class="cap-badge ${llmError ? "cap-badge--warn" : ""}">${llmError ? "IA no disponible" : "revisado con IA"}</span>`
        : `<span class="cap-badge">por reglas</span>`}
    </div>
    <ul class="cap-preview-list">
      ${tasks.map((t, i) => `
        <li class="cap-preview-row">
          <span class="cap-kind cap-kind--${t.kind}">${kindLabel(t.kind)}</span>
          <span class="cap-preview-text">${esc(t.text)}</span>
          ${t.due ? `<span class="cap-chip">${whenLabel(t.due)}</span>` : ""}
          ${t.how !== "rule" ? `<span class="cap-how">${t.how}</span>` : ""}
          <button class="cap-x" data-cap-drop-one="${i}" aria-label="Quitar">✕</button>
        </li>`).join("")}
    </ul>
    <div class="cap-preview-actions">
      <button class="m-btn m-btn--ghost" data-cap-dismiss>Descartar</button>
      <button class="m-btn" data-cap-accept>Guardar ${tasks.length}</button>
    </div>`;
  wire(host);
}

async function acceptAll(host) {
  if (!lastParse) return;
  const btn = host.querySelector("[data-cap-accept]");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
  try {
    const r = await fetch(`${BASE}/api/v1/tasks/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text: lastParse.source ?? rebuildText(lastParse) }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    host.querySelector("[data-cap-input]").value = "";
    lastParse = null;
    await loadAll();
    paint(host);
    showToast("Guardado");
  } catch (e) {
    showToast(`No se pudo guardar: ${e.message}`, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Guardar"; }
  }
}

async function acceptOne(host, index) {
  if (!lastParse) return;
  const t = lastParse.tasks[Number(index)];
  try {
    await fetch(`${BASE}/api/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(t),
    });
    lastParse.tasks.splice(Number(index), 1);
    if (lastParse.tasks.length === 0) { lastParse = null; await loadAll(); paint(host); }
    else renderPreview(host);
  } catch (e) {
    showToast(`No se pudo guardar: ${e.message}`, "error");
  }
}

function rebuildText(parse) {
  return parse.tasks.map((t) => t.text).join(", ");
}
