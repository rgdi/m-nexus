/* ============================================================
 * widgets/modal.js — modal genérico minimalista.
 *
 * v2.25.0 — admite dos formas de uso:
 *
 * 1. HTML plano (legacy):
 *    const { scrim, close } = makeModal(html, { className: "..." });
 *
 * 2. API estructurada (v2.25):
 *    const m = makeModal({
 *      title: "Título",
 *      body: "<p>contenido</p>",
 *      actions: [{ label: "OK", kind: "primary", value: true }],
 *    });
 *    document.body.appendChild(m.root);
 *    m.close(true); // resuelve con `value` del action, o false si cancel
 * ============================================================ */

export function makeModal(arg1, arg2 = {}) {
  // API estructurada
  if (typeof arg1 === "object" && arg1 !== null && ("body" in arg1 || "title" in arg1 || "actions" in arg1)) {
    return makeModalStructured(arg1);
  }
  // API legacy
  return makeModalHtml(arg1, arg2);
}

function makeModalHtml(html, opts = {}) {
  const scrim = document.createElement("div");
  scrim.className = opts.className || "scrim";
  scrim.innerHTML = html;
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
    if (e.target.closest("[data-close]")) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey);
  return { root: scrim, scrim, close };
}

function makeModalStructured({ title = "", body = "", actions = [], className = "scrim" }) {
  const scrim = document.createElement("div");
  scrim.className = className;
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  scrim.setAttribute("aria-label", title || "Dialog");
  scrim.innerHTML = `
    <div class="modal-card">
      ${title ? `<header class="modal-head"><h2 class="modal-title">${escapeHtml(title)}</h2></header>` : ""}
      <div class="modal-body">${body}</div>
      ${actions.length
        ? `<footer class="modal-foot">${actions
            .map(
              (a, i) =>
                `<button class="btn ${a.kind ? "btn-" + a.kind : "btn-secondary"}" data-action="${i}">${escapeHtml(a.label)}</button>`,
            )
            .join("")}</footer>`
        : ""}
    </div>
  `;
  let closed = false;
  let clickedValue;
  const close = (value) => {
    if (closed) return;
    closed = true;
    clickedValue = value;
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  scrim.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      const idx = parseInt(btn.dataset.action, 10);
      close(actions[idx]?.value ?? true);
      return;
    }
    if (e.target === scrim) close(false);
    if (e.target.closest("[data-close]")) close(false);
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(false);
    }
  };
  document.addEventListener("keydown", onKey);
  return { root: scrim, scrim, close, getValue: () => clickedValue };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
