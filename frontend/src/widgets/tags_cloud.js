/* ============================================================
 * tags_cloud.js — extrae hashtags (#tag) del body de la nota y
 * los muestra como pills clickables. Click = filtro por tag.
 * v1.9.1 — auto-tagging desde el body.
 * ============================================================ */

const TAG_RE = /(?:^|\s)#([\p{L}0-9_\-]+)/gu;
const TAG_KEY = "mnexus.activeTag";

export function extractTags(body) {
  const m = (body || "").matchAll(TAG_RE);
  const tags = new Set();
  for (const match of m) tags.add(match[1].toLowerCase());
  return [...tags];
}

export function getActiveTag() {
  return localStorage.getItem(TAG_KEY) || "";
}

export function setActiveTag(t) {
  try { localStorage.setItem(TAG_KEY, t || ""); } catch {}
}

/**
 * renderTagsInline — inyecta tags dentro del text-layer en línea.
 * Cada #tag se reemplaza por un <a class="tl-tag"> que navega al filtro.
 */
export function injectTagsInline(layer) {
  if (!layer) return;
  const tags = extractTags(layer.innerHTML);
  if (tags.length === 0) return;
  // reemplazar #tag en el texto
  for (const t of tags) {
    const re = new RegExp(`#${escapeRe(t)}\\b`, "gi");
    layer.innerHTML = layer.innerHTML.replace(re, `<a class="tl-tag" data-tag="${escapeAttr(t)}">#${escapeHtml(t)}</a>`);
  }
}

/**
 * renderTagsCloud — sidebar de tags con counts. Click = filter.
 */
export async function renderTagsCloud(rootEl) {
  const notes = await (window.__mnexusNoteList?.() ?? Promise.resolve([]));
  const counts = new Map();
  for (const n of notes) {
    for (const t of extractTags(n.body)) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const active = getActiveTag();
  if (sorted.length === 0) {
    rootEl.innerHTML = `<div class="muted small" style="padding: var(--s-3)">No tags yet. Add #your-tag to note bodies.</div>`;
    return;
  }
  rootEl.innerHTML = `
    <div class="tags-cloud">
      ${active ? `<button class="tag-pill clear" data-tag="">✕ Clear</button>` : ""}
      ${sorted.map(([t, c]) => `<button class="tag-pill ${t === active ? "active" : ""}" data-tag="${escapeAttr(t)}">#${escapeHtml(t)} <span class="cnt">${c}</span></button>`).join("")}
    </div>
  `;
  rootEl.querySelectorAll(".tag-pill").forEach((b) => {
    b.addEventListener("click", () => {
      const t = b.dataset.tag;
      setActiveTag(t);
      window.dispatchEvent(new CustomEvent("tags:change", { detail: { tag: t } }));
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
