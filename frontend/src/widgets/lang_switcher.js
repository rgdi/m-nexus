/* ============================================================
 * lang_switcher.js — small floating language picker.
 * v1.3.0 — click to cycle through es/en/pt, or long-press for menu.
 * ============================================================ */

import { i18n } from "../services/i18n.js";

let mounted = false;

export function mountLangSwitcher() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;

  const btn = document.createElement("button");
  btn.className = "lang-switcher";
  btn.setAttribute("aria-label", "Change language");
  btn.id = "lang-switcher";
  document.body.appendChild(btn);

  const render = () => {
    const lang = i18n.lang;
    const flag = i18n.languages().find(l => l.code === lang)?.flag ?? "🌐";
    btn.innerHTML = `<span class="flag">${flag}</span><span class="code">${lang.toUpperCase()}</span>`;
  };
  render();

  btn.addEventListener("click", () => {
    const langs = i18n.languages();
    const i = langs.findIndex(l => l.code === i18n.lang);
    const next = langs[(i + 1) % langs.length];
    i18n.setLang(next.code);
    render();
  });

  // Long-press → full menu
  let pressTimer;
  btn.addEventListener("pointerdown", () => {
    pressTimer = setTimeout(() => openLangMenu(btn), 600);
  });
  btn.addEventListener("pointerup", () => clearTimeout(pressTimer));
  btn.addEventListener("pointerleave", () => clearTimeout(pressTimer));

  // v1.3.0: re-render on language change from anywhere
  i18n.subscribe(render);
}

function openLangMenu(anchor) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `
    <div class="sheet" style="max-width: 360px">
      <div class="sheet-header">
        <h3>${i18n.t("settings.language")}</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div class="col gap-2">
        ${i18n.languages().map(l => `
          <button class="lang-option ${l.code === i18n.lang ? "active" : ""}" data-lang="${l.code}">
            <span class="flag">${l.flag}</span>
            <span class="name">${l.name}</span>
            ${l.code === i18n.lang ? '<span class="check">✓</span>' : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.querySelector('[data-act="close"]').addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll(".lang-option").forEach((b) => {
    b.addEventListener("click", () => {
      i18n.setLang(b.dataset.lang);
      close();
    });
  });
}
