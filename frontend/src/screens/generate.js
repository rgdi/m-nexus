/* screens/generate.js — v2.38.1 build study material from a folder.
 *
 * Pick a folder, pick a format, press one button. Everything the
 * generator used is listed underneath, because "made from your notes" is
 * a claim you should be able to check.
 *
 * The mind map is the odd one out: it needs no model, works offline, and
 * cannot invent anything — every leaf is a sentence lifted verbatim from
 * a note. The other three need a provider and say so if there isn't one.
 */

import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";
import { showToast } from "../widgets/toast.js";

const BASE = detectApiBase();

const KINDS = [
  { kind: "summary", label: "Resumen", icon: "📝", blurb: "Estructurado por secciones, con citas." },
  { kind: "flashcards", label: "Tarjetas", icon: "🃏", blurb: "5–15 preguntas respondibles de una frase." },
  { kind: "quiz", label: "Quiz", icon: "✅", blurb: "Opción múltiple con distractores de tus notas." },
  { kind: "mindmap", label: "Mapa mental", icon: "🧠", blurb: "Sin IA: sale de frases literales de tus notas." },
];

let folders = [];
let result = null;
let kind = "summary";
let busy = false;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function renderGenerate(root) {
  root.innerHTML = `
    <section class="screen m-screen gen">
      <div style="padding:calc(var(--m-safe-t) + 18px) 4px 10px">
        <p class="m-eyebrow">A partir de tus notas</p>
        <h1 class="m-display">GENERA<br>ESTUDIO</h1>
      </div>
      <div data-gen-host></div>
    </section>
  `;
  const host = root.querySelector("[data-gen-host]");
  paint(host);

  try {
    const r = await fetch(`${BASE}/api/v1/rag/folders`, { headers: authHeaders() });
    if (r.ok) {
      const d = await r.json();
      folders = d.folders ?? [];
      paint(host);
    }
  } catch { /* offline: the mind map still works once cached */ }
}

function paint(host) {
  host.innerHTML = `
    <div class="gen-folder">
      <label class="gen-lbl" for="gen-folder-sel">Carpeta</label>
      <select class="gen-scope" id="gen-folder-sel" data-gen-scope>
        <option value="">Toda la biblioteca</option>
        ${folders.map((f) => `<option value="${esc(f.id)}">${esc(f.path)} (${f.chunks})</option>`).join("")}
      </select>
    </div>

    <div class="gen-topic">
      <label class="gen-lbl" for="gen-topic-in">Tema (opcional)</label>
      <input class="gen-topic-in" id="gen-topic-in" data-gen-topic
             placeholder="vacío = todo el material" autocomplete="off">
    </div>

    <div class="gen-kinds">
      ${KINDS.map((k) => `
        <button class="gen-kind ${k.kind === kind ? "is-active" : ""}" data-gen-kind="${k.kind}">
          <span class="gen-kind-icon">${k.icon}</span>
          <span class="gen-kind-body">
            <strong>${k.label}</strong>
            <em>${k.blurb}</em>
          </span>
        </button>`).join("")}
    </div>

    <button class="m-btn m-btn--block gen-go" data-gen-run>Generar</button>

    <div data-gen-out></div>
  `;
  wire(host);
  if (result) renderOut(host, result);
}

function wire(host) {
  host.querySelectorAll("[data-gen-kind]").forEach((b) =>
    b.addEventListener("click", () => { kind = b.dataset.genKind; paint(host); }));

  host.querySelector("[data-gen-run]")?.addEventListener("click", () => run(host));
  host.querySelector("[data-gen-out]")?.addEventListener("click", (e) => {
    const a = e.target.closest("[data-gen-save]");
    if (!a) return;
    e.preventDefault();
    saveAsNotes(host, a.dataset.genSave);
  });
}

async function run(host) {
  if (busy) return;
  busy = true;
  const btn = host.querySelector("[data-gen-run]");
  btn.disabled = true;
  btn.textContent = "Generando…";
  const out = host.querySelector("[data-gen-out]");
  out.innerHTML = `<div class="gen-loading">Leyendo tus notas…</div>`;

  try {
    const r = await fetch(`${BASE}/api/v1/resources/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        kind,
        folderId: host.querySelector("[data-gen-scope]")?.value || null,
        topic: host.querySelector("[data-gen-topic]")?.value || "",
        // The mind map is deterministic; asking the other three for an
        // answer without a model would just be a slower way to say so.
        useLlm: kind === "mindmap" ? false : true,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    result = await r.json();
    renderOut(host, result);
  } catch (e) {
    out.innerHTML = `<div class="gen-loading gen-loading--err">No se pudo generar: ${esc(e.message)}</div>`;
    showToast(`Generación: ${e.message}`, "error");
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "Generar";
  }
}

function citesHtml(cites, sources) {
  if (!cites?.length) return "";
  const n = (id) => sources.findIndex((s) => s.chunkId === id) + 1;
  return `<span class="gen-cites">${cites.map((c) => {
    const i = n(c);
    return i > 0 ? `<a class="gen-cite" href="#/notes?id=${encodeURIComponent(sources[i - 1].noteId)}">[${i}]</a>` : "";
  }).join("")}</span>`;
}

function renderOut(host, d) {
  const el = host.querySelector("[data-gen-out]");
  if (!el) return;

  if (!d.sources?.length) {
    el.innerHTML = `
      <div class="m-empty-state">
        <span class="m-emoji">📭</span>
        <h3>No hay material</h3>
        <p>Esa carpeta no tiene notas, o ninguna coincide con el tema.</p>
      </div>`;
    return;
  }

  let body = "";
  if (d.kind === "summary") {
    body = (d.sections ?? []).map((s) => `
      <article class="gen-section">
        <h4>${esc(s.heading)}</h4>
        <div class="gen-prose">${s.body.split(/\n{2,}/).map((p) =>
          `<p>${esc(p).replace(/\[(\d+)\]/g, "[$1]")}</p>`).join("")}</div>
        ${citesHtml(s.cites, d.sources)}
      </article>`).join("");
    if (!body) body = `<p class="gen-none">El modelo no devolvió secciones.</p>`;
  } else if (d.kind === "flashcards") {
    body = (d.cards ?? []).map((c, i) => `
      <div class="gen-card">
        <div class="gen-card-f"><span class="gen-n">${i + 1}</span>${esc(c.front)}</div>
        <div class="gen-card-b">${esc(c.back)}</div>
        ${citesHtml(c.cites, d.sources)}
      </div>`).join("");
    if (!body) body = `<p class="gen-none">No se pudieron extraer tarjetas.</p>`;
  } else if (d.kind === "quiz") {
    body = (d.quiz ?? []).map((q, i) => `
      <div class="gen-q">
        <div class="gen-q-head"><span class="gen-n">${i + 1}</span>${esc(q.question)}</div>
        <ul class="gen-q-opts">
          ${q.options.map((o, oi) => `
            <li class="gen-q-opt ${oi === q.correctIndex ? "is-key" : ""}">
              <span>${String.fromCharCode(65 + oi)}</span>${esc(o)}
            </li>`).join("")}
        </ul>
        ${q.explanation ? `<p class="gen-q-why">${esc(q.explanation)}</p>` : ""}
        ${citesHtml(q.cites, d.sources)}
      </div>`).join("");
    if (!body) body = `<p class="gen-none">No se pudo construir el quiz.</p>`;
  } else {
    body = (d.mindmap ?? []).map((n) => `
      <div class="gen-mm-node">
        <h4>${esc(n.label)}</h4>
        <ul>${n.children.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        ${citesHtml(n.cites, d.sources)}
      </div>`).join("");
    if (!body) body = `<p class="gen-none">El material no tiene frases suficientes para un mapa.</p>`;
  }

  const count = d.sections?.length ?? d.cards?.length ?? d.quiz?.length ?? d.mindmap?.length ?? 0;
  const canSave = d.kind !== "mindmap";

  el.innerHTML = `
    <div class="gen-result">
      <div class="gen-result-head">
        <h3>${esc(d.title)}</h3>
        <span class="gen-count">${count} ${count === 1 ? "elemento" : "elementos"}</span>
      </div>
      ${d.llmError ? `<div class="gen-warn">⚠ ${esc(d.llmError)}</div>` : ""}
      ${d.kind === "mindmap" ? `<div class="gen-note">Generado sin IA: cada frase es literal de tus notas.</div>` : ""}
      ${body}
      <div class="gen-sources">
        <details>
          <summary>Generado a partir de ${d.sources.length} ${d.sources.length === 1 ? "pasaje" : "pasajes"}</summary>
          <ul>
            ${d.sources.map((s) => `
              <li>
                <a href="#/notes?id=${encodeURIComponent(s.noteId)}">${esc(s.noteTitle)}</a>
                <em>${esc(s.folderName || "sin carpeta")} · ${esc(s.locator)}</em>
              </li>`).join("")}
          </ul>
        </details>
      </div>
      ${canSave ? `<button class="m-btn m-btn--block gen-save" data-gen-save="${d.kind}">
        Guardar como nota
      </button>` : ""}
    </div>`;
}

/** Turn a generated summary into a real note the user owns. */
async function saveAsNotes(host, k) {
  const d = result;
  if (!d) return;
  const text =
    k === "flashcards"
      ? (d.cards ?? []).map((c) => `**${c.front}**\n${c.back}`).join("\n\n---\n\n")
      : (d.sections ?? []).map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n");
  if (!text.trim()) { showToast("No hay nada que guardar", "error"); return; }
  try {
    const r = await fetch(`${BASE}/api/v1/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        title: d.title || "Generado",
        body: text,
        folderId: host.querySelector("[data-gen-scope]")?.value || null,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    showToast("Guardado como nota");
  } catch (e) {
    showToast(`No se pudo guardar: ${e.message}`, "error");
  }
}
