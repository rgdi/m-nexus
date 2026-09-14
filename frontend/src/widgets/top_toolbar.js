/* ============================================================
 * top_toolbar.js — toolbar top-center del notebook (v1.4.0).
 *
 * Replica la del modelo Education Service:
//   - Undo / Redo (izquierda)
//   - Change BG fill (toggle background fill del canvas)
//   - Hide interface elements (esconde/enseña dock + lang switcher)
 * ============================================================ */

import { i18n } from "../services/i18n.js";

const state = {
  bgFill: true,
  uiHidden: false,
};

export function mountTopToolbar() {
  if (document.getElementById("top-toolbar")) return;
  const bar = document.createElement("div");
  bar.id = "top-toolbar";
  bar.className = "top-toolbar";
  bar.innerHTML = `
    <button class="tool-group" data-act="undo" aria-label="Undo">↶</button>
    <button class="tool-group" data-act="redo" aria-label="Redo">↷</button>
    <button class="tool-group" data-act="bg" aria-label="Toggle background">💧</button>
    <button class="tool-group" data-act="hide" aria-label="Hide UI">⛶</button>
  `;
  document.body.appendChild(bar);

  bar.querySelectorAll(".tool-group").forEach((b) => {
    b.addEventListener("click", () => handle(b.dataset.act));
  });
}

function handle(act) {
  if (act === "undo" || act === "redo") {
    document.dispatchEvent(new CustomEvent(`canvas:${act}`));
    return;
  }
  if (act === "bg") {
    state.bgFill = !state.bgFill;
    document.body.classList.toggle("no-bg", !state.bgFill);
    return;
  }
  if (act === "hide") {
    state.uiHidden = !state.uiHidden;
    document.body.classList.toggle("hide-ui", state.uiHidden);
  }
}
