// pdf_annotate.js — el PDF anotado a mano.
//
// v2.38.14
//
// El caso que pediste: escribes en la tablet sobre el PDF, y en el
// portátil —que puede ser una pantalla de 1440 y no de 414— se ve lo
// mismo, con el trazo encima de la página correcta y del tamaño
// correcto.
//
// Eso solo funciona si dos cosas están bien:
//
//   1. El trazo se guarda en fracciones de PÁGINA, no de pantalla. Si
//      se guardara en píxeles, en otra pantalla caería en otro sitio.
//   2. La tinta se ancla a la PÁGINA, no a la posición en el scroll.
//      Al hacer scroll o al saltar a otra página, lo que estaba
//      tapando la pág. 3 sigue tapando la pág. 3.
//
// Por eso aquí la superficie se monta y se desmonta por página, en vez
// de una superficie gigante. Es un poco más de trabajo y es la única
// forma de que la anotación quede pegada a su página.

import { mountInkPad } from "./ink_pad.js";
import { createInkSync, loadInk } from "../services/inkSync.js";

/**
 * Monta el visor con capas de tinta encima de cada página.
 *
 * @param host      dónde
 * @param docId     identificador del documento en la tinta
 * @param getPage   (n) => url de la imagen de la página n, o null
 * @param pageCount cuántas páginas
 */
export function mountPdfAnnotate(host, { docId, getPage, pageCount = 1, onStatus = () => {} }) {
  const padByPage = new Map();
  let ink = null;
  let current = 0;

  host.innerHTML = `
    <div class="pdf-annot" data-annot>
      <div class="pdf-annot-status" data-annot-status>Cargando anotaciones…</div>
      <div class="pdf-annot-pages">
        ${Array.from({ length: pageCount }, (_, i) => `
          <section class="pdf-annot-page" data-page="${i}">
            <div class="pdf-annot-canvas" data-canvas="${i}"></div>
            <div class="pdf-annot-ink" data-ink="${i}"></div>
            <span class="pdf-annot-num">${i + 1}</span>
          </section>`).join("")}
      </div>
    </div>`;

  const status = host.querySelector("[data-annot-status]");

  async function init() {
    const doc = await loadInk(docId);
    const byPage = new Map();
    for (const page of doc.pages || []) {
      for (const s of page.strokes || []) {
        if (!byPage.has(s.page)) byPage.set(s.page, []);
        byPage.get(s.page).push(s);
      }
    }
    ink = createInkSync(docId, {
      onRemote: (incoming) => {
        for (const s of incoming) {
          const arr = byPage.get(s.page) || [];
          if (!arr.some((x) => x.id === s.id)) arr.push(s);
          byPage.set(s.page, arr);
        }
        repaintAll(byPage);
        onStatus("Actualizado desde otro dispositivo");
      },
    });
    ink.start();
    for (let i = 0; i < pageCount; i++) mountPage(i, byPage.get(i) || []);
    status.hidden = true;
  }

  function mountPage(n, strokes) {
    const canvas = host.querySelector(`[data-canvas="${n}"]`);
    const url = getPage ? getPage(n) : null;
    if (url) canvas.innerHTML = `<img src="${url}" alt="Página ${n + 1}" loading="lazy" />`;
    else canvas.innerHTML = `<div class="pdf-annot-vacia">Página ${n + 1}</div>`;

    const target = host.querySelector(`[data-ink="${n}"]`);
    const pad = mountInkPad(target, {
      strokes,
      background: null,
      deviceId: "web",
      onStrokeEnd: (_s, nuevos) => {
        ink?.push(nuevos);
        onStatus("Guardado");
      },
    });
    padByPage.set(n, pad);
  }

  function repaintAll(byPage) {
    for (const [n, pad] of padByPage) pad.merge(byPage.get(n) || []);
  }

  return {
    get page() { return current; },
    goto(n) { current = Math.max(0, Math.min(pageCount - 1, n)); },
    strokes: () => [...padByPage.entries()].flatMap(([n, p]) => p.strokes.map((s) => ({ ...s, page: n }))),
    destroy() { ink?.stop(); for (const p of padByPage.values()) p.destroy(); },
  };
}
