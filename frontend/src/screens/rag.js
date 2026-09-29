/* screens/rag.js — v2.38.0 folder-scoped Q&A with citations.
 *
 * Ask a question about ONE folder and get an answer grounded only in
 * what is inside it, with the passages shown so the answer can be
 * checked. Two things are deliberately visible:
 *
 *   - the folder scope, because a scoped answer and a library-wide one
 *     are different claims
 *   - the citations, always, even with no model configured — in that
 *     case the passages ARE the answer and the app says so rather than
 *     pretending it failed
 */

import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";
import { showToast } from "../widgets/toast.js";

const BASE = detectApiBase();

/** Note titles are user text and end up inside an attribute. */
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
const LS_SCOPE = "mnexus.rag.scope";

let folders = [];
let scope = localStorage.getItem(LS_SCOPE) || "";
let meta = null;
let noteTitles = [];
let last = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function renderRag(root) {
  root.innerHTML = `
    <section class="screen m-screen rag">
      <div style="padding:calc(var(--m-safe-t) + 18px) 4px 10px">
        <p class="m-eyebrow">Pregunta a tus notas</p>
        <h1 class="m-display">BUSCA<br>EN UNA CARPETA</h1>
        <p class="m-body">La respuesta solo usa lo que hay dentro.</p>
      </div>
      <div data-rag-host></div>
    </section>
  `;
  const host = root.querySelector("[data-rag-host]");
  paint(host);

  try {
    // The starter prompts need note *titles*; /rag/folders only returns
    // per-folder counts. Same round trip, one extra request.
    const [r, nr] = await Promise.all([
      fetch(`${BASE}/api/v1/rag/folders`, { headers: authHeaders() }),
      fetch(`${BASE}/api/v1/notes`, { headers: authHeaders() }),
    ]);
    if (nr.ok) {
      try { noteTitles = (await nr.json()).notes || []; } catch { noteTitles = []; }
    }
    if (r.ok) {
      meta = await r.json();
      folders = meta.folders ?? [];
      // A saved scope may no longer exist.
      if (scope && !folders.some((f) => f.id === scope)) scope = "";
      paint(host);
    }
  } catch {
    // Offline. The scope picker still works from the last known list.
  }
}

function paint(host) {
  const total = meta?.totalChunks ?? 0;
  host.innerHTML = `
    <div class="rag-scope">
      <label class="rag-scope-lbl" for="rag-scope-sel">Carpeta</label>
      <select class="rag-scope-sel" id="rag-scope-sel" data-rag-scope>
        <option value="">Toda la biblioteca (${total})</option>
        ${folders.map((f) => `
          <option value="${esc(f.id)}" ${scope === f.id ? "selected" : ""}>
            ${"· ".repeat(f.depth)}${esc(f.path)} (${f.chunks})
          </option>`).join("")}
      </select>
    </div>

    <form class="rag-ask" data-rag-form>
      <textarea class="rag-input" data-rag-input rows="2"
        placeholder="¿Qué dicen mis notas sobre…"
        aria-label="Pregunta"></textarea>
      <div class="rag-ask-row">
        <label class="rag-llm">
          <input type="checkbox" data-rag-llm>
          <span class="m-switch-track" aria-hidden="true"><span class="m-switch-knob"></span></span>
          <span class="m-switch-label">Responder con IA</span>
        </label>
        <button class="m-btn" type="submit">Preguntar</button>
      </div>
    </form>

    <button class="rag-gen" data-rag-gen>
      Generar material con esto →
    </button>

    <div data-rag-result></div>

    <!-- v2.38.2: three quarters of this screen used to be empty until a
         question was asked. Showing what is actually in the library
         turns it from a form into something you can start from. -->
    <div class="rag-starters" data-rag-starters>
      <h2 class="m-section-label">Prueba con</h2>
      <div class="rag-starters-list"></div>
    </div>
  `;
  wire(host);
  renderStarters(host);
  if (last) renderResult(host, last);
}

/**
 * Starter prompts drawn from what is actually in the library.
 *
 * A generic "¿Qué es la fotosíntesis?" on a screen whose whole promise
 * is "the answer only uses what is in here" is a bad first impression.
 * These come from the caller's own note titles.
 */
function renderStarters(host) {
  const box = host.querySelector("[data-rag-starters]");
  if (!box) return;
  const list = box.querySelector(".rag-starters-list");
  const chips = noteTitles.filter((n) => !n.isJournal).slice(0, 3);
  if (!chips.length) { box.remove(); return; }
  list.innerHTML = chips.map((n) => {
    const t = String(n.title || "").trim();
    if (!t) return "";
    return `<button type="button" class="rag-starter" data-rag-starter="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
  }).join("");
  list.querySelectorAll("[data-rag-starter]").forEach((b) => {
    b.addEventListener("click", () => {
      const input = host.querySelector("[data-rag-input]");
      if (!input) return;
      input.value = b.getAttribute("data-rag-starter");
      input.focus();
    });
  });
}

function wire(host) {
  const sel = host.querySelector("[data-rag-scope]");
  sel?.addEventListener("change", () => {
    scope = sel.value;
    try { localStorage.setItem(LS_SCOPE, scope); } catch {}
  });

  // v2.38.1: generation starts from the same scope, so a question that
  // surfaced the right passages can become study material in one tap.
  host.querySelector("[data-rag-gen]")?.addEventListener("click", () => {
    const q = host.querySelector("[data-rag-input]")?.value.trim();
    location.hash = `#/generate`;
  });

  host.querySelector("[data-rag-form]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = host.querySelector("[data-rag-input]");
    const question = input.value.trim();
    if (!question) return;
    const btn = host.querySelector('[data-rag-form] button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Buscando…";
    try {
      const r = await fetch(`${BASE}/api/v1/rag/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          question,
          folderId: scope || null,
          useLlm: host.querySelector("[data-rag-llm]")?.checked === true,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      last = await r.json();
      renderResult(host, last);
    } catch (e) {
      showToast(`No se pudo buscar: ${e.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Preguntar";
    }
  });
}

function renderResult(host, d) {
  const el = host.querySelector("[data-rag-result]");
  if (!el) return;

  const scopeName = scope
    ? folders.find((f) => f.id === scope)?.path ?? "la carpeta"
    : "toda la biblioteca";

  if (!d.citations?.length) {
    el.innerHTML = `
      <div class="m-empty-state">
        <span class="m-emoji">🔍</span>
        <h3>Sin resultados</h3>
        <p>${esc(d.answer || `Nada coincide en ${scopeName}.`)}</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    ${d.answer ? `
      <div class="rag-answer">
        <p>${esc(d.answer)}</p>
      </div>` : `
      <div class="rag-answer rag-answer--raw">
        <p>Sin modelo configurado, así que estos son los fragmentos que
           encontrarían la respuesta. Pulsa <strong>Responder con IA</strong>
           para redactarla a partir de ellos.</p>
      </div>`}

    <div class="rag-meta">
      <span>${d.searched} de ${d.totalChunks} passages</span>
      ${d.searches?.length > 1 ? `<span>· ${d.searches.length} búsquedas</span>` : ""}
      ${d.usedLlm ? `<span class="rag-chip">IA</span>` : `<span class="rag-chip">solo búsqueda</span>`}
    </div>

    ${d.searches?.length > 1 ? `
      <details class="rag-strategy">
        <summary>Cómo se buscó</summary>
        <ul>${d.searches.map((s) => `
          <li><code>${esc(s.term)}</code> — ${s.hits ?? 0} fragmentos</li>`).join("")}</ul>
        ${d.strategy ? `<p class="rag-reasoning">${esc(d.strategy)}</p>` : ""}
      </details>` : ""}

    <h3 class="rag-cites-h">Fuentes · ${d.citations.length}</h3>
    <div class="rag-cites">
      ${d.citations.map((c, i) => `
        <a class="rag-cite" href="#/notes?id=${encodeURIComponent(c.noteId)}">
          <span class="rag-cite-n">${i + 1}</span>
          <span class="rag-cite-body">
            <strong>${esc(c.noteTitle)}</strong>
            <em>${esc(c.folderName || "sin carpeta")} · ${esc(c.locator)}</em>
            <span class="rag-cite-snip">${esc(c.snippet)}</span>
          </span>
        </a>`).join("")}
    </div>
  `;
}
