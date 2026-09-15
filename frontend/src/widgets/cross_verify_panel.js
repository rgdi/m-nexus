/* ============================================================
 * cross_verify_panel.js — UI para el cruce notas↔grabaciones.
 * v1.5.6 — muestra huecos y cobertura por asignatura.
 * v1.6.2 — items con timestamp exacto (mmss) + click → jump a la nota/grabación.
 * v1.6.3 — book-ref items: jump-to-part con highlight temporal.
 * ============================================================ */

const PANEL_STYLE = `
.cv-panel { max-width: 760px; }
.cv-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: var(--s-4); }
.cv-stat { background: var(--bg-sunken); border-radius: 12px; padding: 12px; text-align: center; }
.cv-stat .v { font-size: 24px; font-weight: 800; }
.cv-stat .l { font-size: 12px; color: var(--fg-muted); }
.cv-stat .v.good { color: var(--good); }
.cv-stat .v.warn { color: #d97706; }
.cv-stat .v.bad { color: #dc2626; }
.cv-list { margin-top: var(--s-4); display: flex; flex-direction: column; gap: 8px; max-height: 45vh; overflow-y: auto; }
.cv-item {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  display: flex;
  gap: 12px;
  align-items: center;
}
.cv-item .badge {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  flex-shrink: 0;
  font-weight: 600;
}
.cv-item.missing-notes .badge { background: rgba(220,38,38,0.15); color: #dc2626; }
.cv-item.incomplete .badge { background: rgba(217,119,6,0.15); color: #d97706; }
.cv-item.ok .badge { background: rgba(34,197,94,0.15); color: #16a34a; }
.cv-item.book-ref .badge { background: rgba(140,92,246,0.15); color: #8c5cf6; }
.cv-item .body { flex: 1; min-width: 0; }
.cv-item .msg { font-size: 13px; }
.cv-item .ts {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  background: rgba(90,103,216,0.12);
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cv-item .ts:hover { background: rgba(90,103,216,0.25); }
.cv-item .ts::before { content: "▶"; font-size: 9px; }
.cv-item .ref-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  background: rgba(140,92,246,0.15);
  color: #8c5cf6;
  padding: 2px 8px;
  border-radius: 6px;
  margin-left: 4px;
}
.cv-item .sub { font-size: 11px; color: var(--fg-muted); margin-top: 2px; }
`;

export async function openCrossVerifyPanel(root) {
  if (!document.getElementById("cv-styles")) {
    const s = document.createElement("style");
    s.id = "cv-styles";
    s.textContent = PANEL_STYLE;
    document.head.appendChild(s);
  }
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet cv-panel">
    <div class="sheet-header">
      <h3>📊 Cross-verify (notas ↔ grabaciones)</h3>
      <button class="btn icon" data-act="close">✕</button>
    </div>
    <div class="muted small">Cargando…</div>
  </div>`;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.dataset.act === "close") close(); });

  try {
    const r = await fetch("http://localhost:4100/api/v1/cross-verify");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const missing = data.gaps.filter((g) => g.type === "missing-notes").length;
    const incomplete = data.gaps.filter((g) => g.type === "incomplete").length;
    const ok = data.gaps.filter((g) => g.type === "ok").length;
    const bookRefs = data.gaps.filter((g) => g.type === "book-ref").length;
    const coverageCls = data.coveragePct >= 80 ? "good" : data.coveragePct >= 50 ? "warn" : "bad";
    scrim.querySelector(".sheet").innerHTML = `
      <div class="sheet-header">
        <h3>📊 Cross-verify (notas ↔ grabaciones)</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div class="muted small">Tap a timestamp to jump to the exact minute in the recording (Apple Music style).</div>
      <div class="cv-summary">
        <div class="cv-stat"><div class="v ${coverageCls}">${data.coveragePct}%</div><div class="l">Coverage</div></div>
        <div class="cv-stat"><div class="v">${data.totalRecordings}</div><div class="l">Recordings</div></div>
        <div class="cv-stat"><div class="v">${data.totalNotes}</div><div class="l">Notes</div></div>
      </div>
      <div class="cv-list">
        ${data.gaps.length === 0 ? `<div class="empty"><div class="em-title">Sin datos aún</div><div>Graba algo en una clase para empezar.</div></div>` : ""}
        ${data.gaps.map((g) => renderGap(g)).join("")}
      </div>
      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn" data-act="close">Cerrar</button>
      </div>
    `;
    scrim.querySelector('[data-act="close"]').addEventListener("click", close);
    // wire jump buttons
    scrim.querySelectorAll("[data-jump]").forEach((b) => {
      b.addEventListener("click", () => {
        const url = b.dataset.jump;
        if (url) {
          // v1.6.3: dispatch event para que notes.js reciba el id
          const noteId = url.match(/^#\/notes\/([^?]+)/)?.[1];
          if (noteId) {
            document.dispatchEvent(new CustomEvent("notes:open", { detail: { id: noteId } }));
          }
          location.hash = url;
          close();
        }
      });
    });
  } catch (e) {
    scrim.querySelector(".muted.small").textContent = `Error: ${e.message}`;
  }
}

function renderGap(g) {
  const ts = g.timestampFormatted ? `<button class="ts" data-jump="${escapeAttr(g.jumpUrl || "#/notes")}" title="Jump to ${g.timestampFormatted}">${g.timestampFormatted}</button>` : "";
  const ref = g.bookRef ? `<span class="ref-tag">@${escapeHtml(g.bookRef)}</span>` : "";
  return `
    <div class="cv-item ${g.type}">
      <span class="badge">${g.type}</span>
      <div class="body">
        <div class="msg">${escapeHtml(g.message)}${ref}</div>
        <div class="sub">${new Date(g.timestamp).toLocaleString()}</div>
      </div>
      ${ts}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}
