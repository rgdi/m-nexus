/* ============================================================
 * cross_verify_panel.js — UI para el cruce notas↔grabaciones.
 * v1.5.6 — muestra huecos y cobertura por asignatura.
 * ============================================================ */

const PANEL_STYLE = `
.cv-panel { max-width: 720px; }
.cv-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: var(--s-4); }
.cv-stat { background: var(--bg-sunken); border-radius: 12px; padding: 12px; text-align: center; }
.cv-stat .v { font-size: 24px; font-weight: 800; }
.cv-stat .l { font-size: 12px; color: var(--fg-muted); }
.cv-stat .v.good { color: var(--good); }
.cv-stat .v.warn { color: #d97706; }
.cv-stat .v.bad { color: #dc2626; }
.cv-list { margin-top: var(--s-4); display: flex; flex-direction: column; gap: 8px; max-height: 40vh; overflow-y: auto; }
.cv-item { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-elevated); display: flex; gap: 10px; align-items: flex-start; }
.cv-item .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; flex-shrink: 0; }
.cv-item.missing-notes .badge { background: rgba(220,38,38,0.15); color: #dc2626; }
.cv-item.incomplete .badge { background: rgba(217,119,6,0.15); color: #d97706; }
.cv-item.ok .badge { background: rgba(34,197,94,0.15); color: #16a34a; }
.cv-item .msg { flex: 1; font-size: 13px; }
.cv-item .time { font-size: 11px; color: var(--fg-muted); }
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
  scrim.querySelector('[data-act="close"]').addEventListener("click", () => scrim.remove());
  scrim.addEventListener("click", (e) => { if (e.target === scrim) scrim.remove(); });

  try {
    const r = await fetch("http://localhost:4100/api/v1/cross-verify");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const missing = data.gaps.filter((g) => g.type === "missing-notes").length;
    const incomplete = data.gaps.filter((g) => g.type === "incomplete").length;
    const ok = data.gaps.filter((g) => g.type === "ok").length;
    const coverageCls = data.coveragePct >= 80 ? "good" : data.coveragePct >= 50 ? "warn" : "bad";
    scrim.querySelector(".sheet").innerHTML = `
      <div class="sheet-header">
        <h3>📊 Cross-verify (notas ↔ grabaciones)</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div class="muted small">Cruza notas recientes con grabaciones por hora y asignatura (±30 min).</div>
      <div class="cv-summary">
        <div class="cv-stat"><div class="v ${coverageCls}">${data.coveragePct}%</div><div class="l">Cobertura</div></div>
        <div class="cv-stat"><div class="v">${data.totalRecordings}</div><div class="l">Grabaciones</div></div>
        <div class="cv-stat"><div class="v">${data.totalNotes}</div><div class="l">Notas</div></div>
      </div>
      <div class="cv-list">
        ${data.gaps.length === 0 ? `<div class="empty"><div class="em-title">Sin datos aún</div><div>Graba algo en una clase para empezar.</div></div>` : ""}
        ${data.gaps.map((g) => `
          <div class="cv-item ${g.type}">
            <span class="badge">${g.type}</span>
            <div class="msg">${escapeHtml(g.message)}</div>
            <div class="time">${new Date(g.timestamp).toLocaleString()}</div>
          </div>
        `).join("")}
      </div>
      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn" data-act="close">Cerrar</button>
      </div>
    `;
    scrim.querySelector('[data-act="close"]').addEventListener("click", () => scrim.remove());
  } catch (e) {
    scrim.querySelector(".muted.small").textContent = `Error: ${e.message}`;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
