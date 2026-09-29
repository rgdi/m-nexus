/* appbar.js — la barra superior del móvil.
 *
 * v2.38.2. Durante varias versiones existió una hoja de estilos completa
 * para `.m-appbar` —fixed, con blur, backdrop y 56px— que nunca llegó a
 * montarse, mientras el layout reservaba esos 56px de padding. El
 * resultado era un bloque de negro en lo alto de *todas* las pantallas y
 * ninguna chrome consistente: cada pantalla inventaba su propia cabecera
 * con su propio tamaño de letra y su propio tratamiento.
 *
 * Esta barra se monta una vez, fuera de #app, así que sobrevive a los
 * re-render de cada ruta. Es dueña del espacio superior: las pantallas ya
 * no calculan su propio padding.
 */

import { i18n } from "../services/i18n.js";

/** Título de cada ruta. Sin esto, la barra tendría que adivinar. */
const TITLES = {
  overview: "appbar.overview",
  calendar: "appbar.calendar",
  subjects: "appbar.subjects",
  notes: "appbar.notes",
  todos: "appbar.todos",
  capture: "appbar.capture",
  rag: "appbar.rag",
  generate: "appbar.generate",
  study: "appbar.study",
  progress: "appbar.progress",
  mood: "appbar.mood",
  journal: "appbar.journal",
  ai: "appbar.tutor",
  occlusion: "appbar.occlusion",
  pdf: "appbar.pdf",
  kg: "appbar.kg",
  cluster: "appbar.cluster",
  settings: "appbar.settings",
  v232: "appbar.insights",
};

/** Rutas con chrome propio: si la pantalla dibuja su título, repetirlo
 *  arriba es ruido, no orientación. */
const NO_TITLE = new Set(["login"]);

let el = null;
let current = "";

function ensure() {
  if (el) return el;
  el = document.createElement("header");
  el.className = "m-appbar";
  el.setAttribute("data-appbar", "");
  el.innerHTML = `
    <button class="m-appbar-back" data-appbar-back type="button" aria-label="Atrás" hidden>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <h1 class="m-appbar-title" data-appbar-title></h1>
    <span class="m-appbar-spacer"></span>
  `;
  document.body.appendChild(el);

  el.querySelector("[data-appbar-back]").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.hash = "#/overview";
  });

  // La línea inferior solo aparece cuando hay contenido debajo: una
  // separ permanente sobre el vacío es otra línea de nada.
  const onScroll = () => el.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  return el;
}

export function mountAppbar(route) {
  const bar = ensure();
  if (!bar.isConnected) document.body.appendChild(bar);

  const key = TITLES[route];
  const title = key ? i18n.t(key) : "";
  if (route === current && bar.dataset.route === route) return;

  current = route;
  bar.dataset.route = route;

  const show = !!title && !NO_TITLE.has(route);
  bar.classList.toggle("is-hidden", !show);
  const t = bar.querySelector("[data-appbar-title]");
  if (t) t.textContent = title;

  // Atrás sólo tiene sentido si hay a dónde volver.
  const back = bar.querySelector("[data-appbar-back]");
  if (back) back.hidden = history.length <= 1;

  // Sin separador al entrar en la pantalla.
  bar.classList.toggle("is-scrolled", window.scrollY > 4);
}

export function refreshAppbar() {
  if (!el) return;
  const key = TITLES[el.dataset.route];
  const t = el.querySelector("[data-appbar-title]");
  if (key && t) t.textContent = i18n.t(key);
}
