/* widgets/ai_companion.js — v2.38.0
 *
 * Your AI second brain, in a popup you can summon from anywhere.
 *
 * ── What is borrowed, and from where ──────────────────────────────
 * Khoj (github.com/khoj-ai/khoj) is the reference for the conversational
 * shape. Two details from it matter more than the rest:
 *
 *   1. SUBQUERIES ARE GENERATED WITH THE CONVERSATION HISTORY, not from
 *      the last message alone (`routers/helpers.py::generate_online_subqueries`
 *      passes `chat_history` into the prompt). That is the whole reason
 *      its answers feel continuous: "¿y el tratamiento?" retrieves on
 *      the disease you were already discussing instead of on the two
 *      words "el tratamiento". Without it, every follow-up question is
 *      a cold start.
 *
 *   2. THE SEARCH IS A TOOL, NOT A PREAMBLE. Khoj exposes online search
 *      as a tool the agent may call (`processor/tools/online_search.py`),
 *      so the model decides whether it needs the web at all. Here the
 *      decision is made in the same spirit but on the server, where it
 *      can see whether the local index actually had anything.
 *
 * Two things are deliberately NOT done:
 *
 *   - The web fallback is off by default and clearly labelled when used.
 *     Notes are the product; sending a question to a search engine is a
 *     decision the user makes, not one the app makes for them.
 *   - Nothing is claimed as a citation unless it came out of the local
 *     index with a note id attached. A web result is shown as a web
 *     result.
 *
 * It opens in the floating window built in v2.34.0: a draggable,
 * resizable panel on desktop and a bottom sheet on a phone, with no
 * route change, so the conversation survives navigating around it.
 */

import { openFloatingWindow, closeFloatingWindow } from "./floating_window.js";
import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";
import { showToast } from "./toast.js";

const BASE = detectApiBase();
const LS_HISTORY = "mnexus.ai.history";
const LS_SCOPE = "mnexus.ai.scope";
const LS_WEB = "mnexus.ai.allowWeb";
const MAX_TURNS = 24;

let win = null;
let busy = false;
let turns = loadHistory();

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_HISTORY) || "[]");
    return Array.isArray(raw) ? raw.slice(-MAX_TURNS) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch { /* private mode */ }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** Minimal inline markdown: **bold**, `code`, and paragraphs. */
function md(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(\d+)\]/g, '<a class="acit" data-cite="$1">[$1]</a>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function transcriptHtml() {
  if (turns.length === 0) {
    return `
      <div class="ac-empty">
        <p>Pregúntame lo que quieras sobre tus notas.</p>
        <div class="ac-samples">
          <button data-ac-sample="¿Qué dicen mis notas sobre este tema?">¿Qué dicen mis notas…?</button>
          <button data-ac-sample="Resume lo más importante que tengo guardado">Resume lo importante</button>
          <button data-ac-sample="¿Y por qué?">¿Y por qué?</button>
        </div>
        <p class="ac-hint">La última pregunta es la que enseña: <code>¿Y por qué?</code>
           busca en el contexto de la conversación, no solo en las palabras escritas.</p>
      </div>`;
  }
  return turns.map((t) => `
    <div class="ac-turn ac-turn--${t.role}">
      <div class="ac-bubble">${md(t.text)}</div>
      ${t.citations?.length ? `
        <div class="ac-cites">
          ${t.citations.map((c, i) => `
            <a class="ac-cite" href="#/notes?id=${encodeURIComponent(c.noteId)}" data-ac-cite>
              <span class="ac-cite-n">${i + 1}</span>
              <span>${esc(c.noteTitle)}<em>${esc(c.folderName || "sin carpeta")}</em></span>
            </a>`).join("")}
        </div>` : ""}
      ${t.web?.length ? `
        <div class="ac-web">
          <span class="ac-web-tag">web</span>
          ${t.web.map((w) => `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>`).join(" · ")}
        </div>` : ""}
      ${t.searches?.length > 1 ? `
        <div class="ac-strategy">${t.searches.length} búsquedas: ${t.searches.map((s) => `<code>${esc(s.term)}</code>`).join(", ")}</div>` : ""}
    </div>`).join("");
}

/**
 * Open the companion. Re-focuses the existing window instead of
 * stacking a second one.
 */
export function openAiCompanion(seedQuestion = "") {
  if (win) { win.focus?.(); return; }

  const body = document.createElement("div");
  body.className = "ac";
  body.innerHTML = `
    <div class="ac-bar">
      <select class="ac-scope" data-ac-scope title="Limitar la búsqueda a una carpeta">
        <option value="">Todas las notas</option>
      </select>
      <label class="ac-web-toggle" title="Permitir que busque en la web si no encuentra nada aquí">
        <input type="checkbox" data-ac-web>
        <span>web</span>
      </label>
      <button class="ac-clear" data-ac-clear title="Borrar la conversación">✕</button>
    </div>
    <div class="ac-log" data-ac-log>${transcriptHtml()}</div>
    <form class="ac-input-row" data-ac-form>
      <textarea class="ac-input" data-ac-input rows="1"
        placeholder="Pregunta lo que quieras…" aria-label="Pregunta"></textarea>
      <button class="ac-send" data-ac-send type="submit" aria-label="Enviar">↑</button>
    </form>
  `;

  win = openFloatingWindow({
    id: "mnexus-ai-companion",
    title: "Tu segundo cerebro",
    icon: "✦",
    kind: "popup",
    width: 520,
    height: 560,
    body,
    onClose: () => { win = null; },
  });

  // Populate the folder picker.
  fetch(`${BASE}/api/v1/rag/folders`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const sel = body.querySelector("[data-ac-scope]");
      if (!d || !sel) return;
      for (const f of d.folders ?? []) {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = `${f.path} (${f.chunks})`;
        sel.appendChild(o);
      }
      sel.value = localStorage.getItem(LS_SCOPE) || "";
    })
    .catch(() => {});

  const web = body.querySelector("[data-ac-web]");
  if (web) web.checked = localStorage.getItem(LS_WEB) === "1";

  const input = body.querySelector("[data-ac-input]");
  const log = body.querySelector("[data-ac-log]");

  body.querySelectorAll("[data-ac-sample]").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.dataset.acSample; ask(); }));

  body.querySelector("[data-ac-clear]")?.addEventListener("click", () => {
    turns = [];
    saveHistory();
    log.innerHTML = transcriptHtml();
    wireSamples(body);
  });

  body.querySelector("[data-ac-scope]")?.addEventListener("change", (e) => {
    try { localStorage.setItem(LS_SCOPE, e.target.value); } catch {}
  });
  web?.addEventListener("change", () => {
    try { localStorage.setItem(LS_WEB, web.checked ? "1" : "0"); } catch {}
  });

  body.querySelector("[data-ac-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    ask();
  });

  // Enter sends, Shift+Enter is a newline. A textarea that hijacks
  // Enter is the single most annoying thing a chat box can do.
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
  });

  // Auto-grow, capped, so the popup never eats the transcript.
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
  });

  if (seedQuestion) input.value = seedQuestion;
  input?.focus();
  log.scrollTop = log.scrollHeight;

  function wireSamples(scope) {
    scope.querySelectorAll("[data-ac-sample]").forEach((b) =>
      b.addEventListener("click", () => {
        scope.querySelector("[data-ac-input]").value = b.dataset.acSample;
        ask();
      }));
  }

  function repaint() {
    log.innerHTML = transcriptHtml();
    log.scrollTop = log.scrollHeight;
    wireSamples(body);
  }

  async function ask() {
    if (busy) return;
    const q = input.value.trim();
    if (!q) return;

    busy = true;
    input.value = "";
    input.style.height = "auto";
    turns.push({ role: "user", text: q });
    repaint();

    const pending = document.createElement("div");
    pending.className = "ac-turn ac-turn--pending";
    pending.innerHTML = `<div class="ac-bubble ac-bubble--thinking">buscando…</div>`;
    log.appendChild(pending);
    log.scrollTop = log.scrollHeight;

    try {
      // v2.38.9 — primero lo que el backend ya sabe hacer sin modelo.
      // Un LLM para "¿qué se ha dicho de más en la clase?" es tirar
      //tokens: es un cruce de palabras contra el índice, y sale
      //determinista. Solo si no hay coincidencias se pregunta al modelo.
      const local = await tryLocalIntent(q);
      if (local) {
        pending.remove();
        turns.push({ role: "assistant", ...local });
        saveHistory();
        repaint();
        busy = false;
        return;
      }

      const r = await fetch(`${BASE}/api/v1/rag/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          question: q,
          folderId: body.querySelector("[data-ac-scope]")?.value || null,
          useLlm: true,
          // The conversation is the difference between a cold start and
          // a follow-up that resolves the right pronoun.
          history: turns.slice(0, -1).map((t) => ({ role: t.role, text: t.text })),
          allowWeb: body.querySelector("[data-ac-web]")?.checked === true,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      pending.remove();
      turns.push({
        role: "assistant",
        text: d.answer || "(sin respuesta del modelo)",
        citations: d.citations,
        web: d.web,
        searches: d.searches,
      });
      saveHistory();
      repaint();
    } catch (e) {
      pending.remove();
      turns.push({ role: "assistant", text: `No pude responder: ${e.message}` });
      saveHistory();
      repaint();
      showToast(`IA: ${e.message}`, "error");
    } finally {
      busy = false;
    }
  }
}

export function closeAiCompanion() {
  closeFloatingWindow("mnexus-ai-companion");
  win = null;
}

// ---------------------------------------------------------------------------
// Intenciones locales: las que no necesitan modelo
// ---------------------------------------------------------------------------

/**
 * v2.38.9 — "que se ha dicho de mas en la clase" y "que se ha dejado de
 * ver" no son preguntas de lenguaje: son cruces contra el indice de
 * recursos. Se resuelven en el backend en milisegundos y con el mismo
 * resultado cada vez, y un LLM aqui seria Caro e inventado.
 *
 * El motivo de que esto viva en el chat y no en un boton: el usuario
 * ya esta escribiendo a la IA. Anadir un boton al lado obliga a decidir
 * cual de los dos; esto no obliga a decidir nada.
 */
const INTENTS = [
  {
    id: "coverage",
    // Sin tildes ni mayusculas: se compara en normalizado.
    match: (q) => /(que|q)\s+(se\s+ha\s+)?(dicho|contado|explicado|visto)|se\s+ha\s+quedado\s+fuera|falta\s+en\s+(el\s+)?(powerpoint|ppt|diapositiv)/.test(q),
    answer: "Voy a cruzar lo último que has dicho con tu material.",
  },
  {
    id: "unreviewed",
    match: (q) => /que\s+no\s+(hemos|vimos|ha)\s+(visto|comentado|repasado)|no\s+hemos\s+visto/.test(q),
    answer: "Te digo qué hay en el material que no hemos pasado.",
  },
];

async function tryLocalIntent(raw) {
  const q = (raw || "").toLowerCase();
  if (!q) return null;
  if (!/cobert|diapositiv|powerpoint|clase|material|transcri|revisad/.test(q)) return null;
  const intent = INTENTS.find((i) => i.match(q));
  if (!intent) return null;

  const { authHeaders } = await import("../services/auth.js");
  const { detectApiBase } = await import("../services/api_base.js");
  const base = detectApiBase();
  const H = { ...authHeaders(), "content-type": "application/json" };

  // De dónde sale la transcripción: la última grabación, o lo que haya
  // en la caja de captura. Sin transcripción no hay nada que cruzar y
  // se dice, en vez de fingir un resultado.
  const transcript = await latestTranscript(base, H);
  if (!transcript) {
    return {
      text:
        "No encuentro ninguna transcripción que cruzar. Graba la clase o pega los apuntes en la pantalla de captura y te lo cruzo con el material.",
    };
  }

  try {
    const r = await fetch(base + "/api/v1/coverage/cross", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ transcript: transcript.text, label: transcript.label }),
    });
    if (r.status === 409) {
      const b = await r.json().catch(() => ({}));
      return { text: b.warning || "No hay material indexado todavía." };
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    return { text: renderCoverage(d, intent.id), coverage: d };
  } catch (e) {
    return { text: "No pude hacer el cruce: " + (e.message || e) };
  }
}

async function latestTranscript(base, H) {
  try {
    const r = await fetch(base + "/api/v1/recordings", { headers: H });
    if (r.ok) {
      const list = (await r.json()) || [];
      const arr = Array.isArray(list) ? list : list.recordings || [];
      const last = arr.filter((x) => x && (x.transcript || x.text)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      if (last) return { text: last.transcript || last.text, label: last.title || last.subject || "última clase" };
    }
  } catch {}
  return null;
}

/** El cruce en texto plano. Cada línea lleva su sitio en el documento. */
function renderCoverage(d, intent) {
  const pct = Math.round((d.ratio || 0) * 100);
  const L = [];
  L.push(`**${intent === "unreviewed" ? "Sin revisar" : "Cobertura"}: ${d.covered}/${d.total} frases (${pct}%)**`);
  for (const p of d.perDoc || []) {
    const w = p.warning ? ` — ${p.warning}` : "";
    L.push(`· ${p.fileName}: ${Math.round(p.ratio * 100)}% de ${p.total} bloques · ${p.pages} pág.${w}`);
  }
  if (intent === "unreviewed") {
    const u = (d.unreviewed || []).slice(0, 8);
    if (!u.length) L.push("\nNo queda nada sin pasar: todo el material aparece en la clase.");
    for (const x of u) L.push(`· ${x.locator || x.fileName}: ${x.quote.slice(0, 110)}…`);
  } else {
    const m = (d.missing || []).slice(0, 8);
    if (!m.length) L.push("\nTodo lo que se dijo está en el material.");
    for (const g of m) {
      const donde = g.nearest ? ` (parecido a ${g.nearest.locator || g.nearest.fileName})` : "";
      L.push(`· **${g.severity}** ${g.text.slice(0, 140)}…${donde}`);
    }
  }
  L.push(`\n_(${d.ms}ms, determinista — sin modelo de lenguaje)_`);
  return L.join("\n");
}
