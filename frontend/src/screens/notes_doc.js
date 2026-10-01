/**
 * notes_doc.js — la nota como documento.
 *
 * v2.38.16. Sustituye a la pantalla de notas anterior, que era un
 * cuaderno de paginas con un lienzo encima del texto, una barra de
 * doce botones y cinco pestanas laterales. Todo eso seguia ahi, pero
 * costaba mucho saber donde estaba cada cosa.
 *
 * Lo que hay ahora es una sola idea: **la nota es un documento y se
 * edita en el sitio**. Sin paginas si no las pides, sin pestanas si no
 * las necesitas, y los bloques —un modelo 3D, una oclusion— van en
 * medio del texto, donde estan siendo comentados.
 *
 * Decisiones que Explain el porque:
 *
 * - **Editar es escribir, no dibujar.** El textarea se superpone al
 *   texto ya maquetado con la misma tipografia y el mismo ancho, asi
 *   que no da un salto al entrar en edicion. Y el lienzo de tinta, si
 *   el aparato tiene lapiz, va encima: se escribe a mano Y con
 *   teclado, que es lo que se hace de verdad en una tablet.
 *
 * - **La sintaxis se ve como documento, se guarda como texto.** Al
 *   enfocar, `[[Aorta]]` se ve `[[Aorta]]`; al salir, se ve un enlace.
 *   Nunca se edita HTML.
 *
 * - **Sin controles muertos.** Donde no hay lapiz no aparece el
 *   lapiz. Donde no hay-impresora no aparece imprimir. Lo que se ve,
 *   funciona.
 */

import { dataSource } from "../services/dataSource.js";
import { mountInkPad } from "../widgets/ink_pad.js";
import { mountModel3D, MODEL_IDS, MODELOS } from "../widgets/model3d_block.js";
import { device, puedeImprimirConTeclado } from "../services/device.js";
import { extractTags } from "../widgets/tags_cloud.js";
import { showToast } from "../widgets/toast.js";

const state = { selectedId: null };

/* ── utilidades ─────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** ¿Este aparato tiene lapiz? Un movil con el dedo no. */
export function puedeEscribirAMano() {
  const kind = device._values?.kind;
  if (kind !== "tablet" && kind !== "ipad") return false;
  // Ademas del tamano, que diga que reconoce escritura a mano.
  if (navigator.maxTouchPoints > 0) return true;
  return typeof matchMedia === "function"
    ? matchMedia("(any-pointer: coarse)").matches
    : false;
}

const palabras = (t) => (t.trim().match(/[^\s]+/g) || []).length;
const cuando = (ts) => {
  if (!ts) return "";
  const d = Math.floor((Date.now() - ts) / 60000);
  if (d < 1) return "ahora";
  if (d < 60) return `hace ${d} min`;
  const h = Math.floor(d / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `hace ${dd} d`;
  return new Date(ts).toLocaleDateString("es");
};

/* ── los bloques que se meten dentro del texto ─────────────────
 *
 * `{{3d:...}}` y `{{occl:...}}` viven EN EL CUERPO de la nota, no en
 * un campo aparte. Es la unica forma de que se imprima, se exporte y
 * sobreviva a una migracion de cuenta sin tocar el esquema. El
 * usuario nunca escribe la sintaxis: la pone la interfaz.
 */
const RE_3D = /\{\{3d:(\{.*?\})\}\}/g;
const RE_OCCL = /\{\{occl:(\{.*?\})\}\}/g;

// v2.38.20 — `f` es el id del modelo guardado en el dispositivo y `c`
// su crédito. El ARCHIVO no va aquí: pesa, y una nota con un modelo
// dentro tiene que poder viajar por la red, imprimirse y exportarse
// sin arrastrar 12 MB de geometría.
const serializa3D = (s) => JSON.stringify({
  m: s.modelId,
  ...(s.assetId ? { f: s.assetId } : {}),
  ...(s.credit ? { c: s.credit } : {}),
  l: s.labels.map((l) => [l.x, l.y, l.z, l.text]),
  o: s.occlusions.map((o) => [o.x, o.y, o.z, o.w, o.h, o.answer || ""]),
});
const deserializa3D = (raw) => {
  try {
    const d = JSON.parse(raw);
    return {
      modelId: d.m || "corazon",
      assetId: d.f || null,
      credit: d.c || "",
      labels: (d.l || []).map(([x, y, z, text], i) => ({ id: "l" + i, x, y, z, text })),
      occlusions: (d.o || []).map(([x, y, z, w, h, answer], i) =>
        ({ id: "o" + i, x, y, z, w, h, answer, tapped: false })),
    };
  } catch {
    return { modelId: "corazon", assetId: null, credit: "", labels: [], occlusions: [] };
  }
};

/* ── lectura: el cuerpo como documento ─────────────────────── */
function cuerpoLegible(cuerpo) {
  // Los marcadores de bloque no se muestran: se quitan del texto y
  // aparecen mas abajo como lo que son. Enseñar el JSON es como
  // enseñar el codigo de la nota.
  const limpio = String(cuerpo || "")
    .replace(/\{\{3d:\{.*?\}\}\}/g, "")
    .replace(/\{\{occl:\{.*?\}\}\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let html = escapeHtml(limpio);
  html = html.replace(/==(.+?)==/g, '<span class="doc-underline">$1</span>');
  html = html.replace(/!!(.+?)!!/g, '<span class="doc-highlight">$1</span>');
  html = html.replace(/\[\[([^\]]+)\]\]/g,
    (_, n) => `<a class="doc-link" data-link="${escapeHtml(n)}" href="#/notes">${escapeHtml(n)}</a>`);
  html = html.replace(/@([\wÀ-ÿ\/\-\.]+)/g, '<span class="doc-bookref">📖 $1</span>');
  // #etiqueta — se ve como etiqueta, no como un almohadilla suelto.
  html = html.replace(/(^|\s)#([\wÀ-ÿ\-]+)/g, '$1<span class="doc-tag-inline">#$2</span>');
  return html.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

/* ══════════════════════════════════════════════════════════════
 * La pantalla
 * ══════════════════════════════════════════════════════════════ */
export async function renderNotes(root) {
  if (state.selectedId) return abrirNota(root, state.selectedId);
  return abrirLista(root);
}

/* ── lista de notas ─────────────────────────────────────────── */
async function abrirLista(root) {
  const notes = await dataSource.notes.list();
  const folders = await dataSource.folders.list();
  const porCarpeta = new Map();
  for (const f of folders) porCarpeta.set(f.id, f.name);
  const recientes = [...notes]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 60);

  root.innerHTML = `
    <div class="screen doc-list">
      <header class="doc-bar">
        <h1 class="doc-bar-title">Notas</h1>
        <div class="spacer"></div>
        <button class="btn primary" id="doc-new">+ Nueva</button>
      </header>
      <div class="doc-list-wrap">
        <input class="input doc-search" id="doc-search" type="search"
               placeholder="Buscar en tus notas" aria-label="Buscar en tus notas" />
        ${recientes.length === 0 ? `
          <div class="doc-list-empty">
            <div style="font-size:2.4rem">📓</div>
            <p>Aún no hay notas.</p>
            <p class="muted">Crea la primera y empieza a escribir.</p>
          </div>` : `
          <ul class="doc-cards" role="list">
            ${recientes.map((n) => `
              <li>
                <button class="doc-card" data-id="${escapeHtml(n.id)}">
                  <span class="doc-card-title">${escapeHtml(n.title || "Sin título")}</span>
                  <span class="doc-card-snippet">${escapeHtml((n.body || "").replace(/[#*\[\]@]/g, "").slice(0, 120))}</span>
                  <span class="doc-card-meta">
                    ${cuando(n.updatedAt)}
                    ${n.folderId && porCarpeta.get(n.folderId) ? ` · ${escapeHtml(porCarpeta.get(n.folderId))}` : ""}
                    ${palabras(n.body || "")} palabras
                  </span>
                </button>
              </li>`).join("")}
          </ul>`}
      </div>
    </div>
  `;

  root.querySelector("#doc-new").addEventListener("click", async () => {
    const creada = await dataSource.notes.create({
      title: "Sin título", body: "", tags: [], pages: [],
    });
    state.selectedId = creada?.id || creada;
    renderNotes(root);
  });
  root.querySelectorAll(".doc-card").forEach((c) =>
    c.addEventListener("click", () => {
      state.selectedId = c.dataset.id;
      renderNotes(root);
    }));
  const busca = root.querySelector("#doc-search");
  if (busca) {
    busca.addEventListener("input", () => {
      const q = busca.value.trim().toLowerCase();
      root.querySelectorAll(".doc-card").forEach((c) => {
        const t = (c.textContent || "").toLowerCase();
        c.closest("li").style.display = !q || t.includes(q) ? "" : "none";
      });
    });
  }
}

/* ── la nota ────────────────────────────────────────────────── */
async function abrirNota(root, id) {
  const note = await dataSource.notes.get(id);
  if (!note) { state.selectedId = null; return abrirLista(root); }

  const aMano = puedeEscribirAMano();
  const todos = await dataSource.notes.list();

  root.innerHTML = `
    <div class="screen doc-screen" data-a-mano="${aMano ? "1" : "0"}" data-pc="${puedeImprimirConTeclado() ? "1" : "0"}">
      <header class="doc-bar">
        <button class="doc-back" id="doc-back" aria-label="Volver a las notas">‹</button>
        <span class="doc-crumb">Notas</span>
        <div class="spacer"></div>
        <button class="doc-act" id="doc-ai" title="Preguntar a la IA sobre esta nota" aria-label="Preguntar a la IA">✦</button>
        <button class="doc-act" id="doc-more" title="Más opciones" aria-label="Más opciones" aria-haspopup="menu">⋯</button>
      </header>

      <div class="doc-body">
        <article class="doc-paper" id="doc-paper">
          <div class="doc-ink" id="doc-ink" ${aMano ? "" : "hidden"}></div>
          <div class="doc-flow">
            <h1 class="doc-title" id="doc-title" contenteditable="true"
                spellcheck="false" role="textbox" aria-label="Título de la nota"></h1>
            <p class="doc-meta" id="doc-meta"></p>
            <div class="doc-content" id="doc-content"></div>
            <textarea class="doc-editor" id="doc-editor" spellcheck="true"
                      aria-label="Cuerpo de la nota" hidden></textarea>
            <div class="doc-blocks" id="doc-blocks"></div>
            <div class="doc-add-row">
              <button class="doc-add" id="doc-add" aria-haspopup="menu">
                <span aria-hidden="true">＋</span> Añadir bloque
              </button>
            </div>
          </div>
        </article>

        <aside class="doc-rail" id="doc-rail" aria-label="Contexto de la nota"></aside>
      </div>

      <div class="doc-menu" id="doc-menu" role="menu" hidden></div>
    </div>
  `;

  const elTitle = root.querySelector("#doc-title");
  const elMeta = root.querySelector("#doc-meta");
  const elContent = root.querySelector("#doc-content");
  const elEditor = root.querySelector("#doc-editor");
  const elBlocks = root.querySelector("#doc-blocks");
  const elMenu = root.querySelector("#doc-menu");
  let cuerpo = note.body || "";
  let editando = false;

  /* ── pintar ────────────────────────────────────────────────── */
  function pintarMeta() {
    const w = palabras(cuerpo);
    const enlaces = (cuerpo.match(/\[\[[^\]]+\]\]/g) || []).length;
    const bloques = contarBloques(cuerpo);
    elMeta.textContent = [
      `${w} palabra${w === 1 ? "" : "s"}`,
      `${Math.max(1, Math.round(w / 200))} min de lectura`,
      cuando(note.updatedAt),
      enlaces ? `${enlaces} enlace${enlaces === 1 ? "" : "s"}` : null,
      bloques ? `${bloques} bloque${bloques === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ");
  }

  function pintar() {
    elTitle.textContent = note.title || "Sin título";
    elContent.innerHTML = cuerpoLegible(cuerpo) ||
      `<p class="doc-placeholder">Escribe aquí. <code>[[</code> enlaza con otra nota, <code>==así==</code> subraya y <code>!!así!!</code> resalta.</p>`;
    elEditor.value = cuerpo;
    pintarMeta();
    pintarBloques();
    pintarRail();
  }

  /* ── editar: el textarea se pone encima, con la misma tipografía ── */
  function editar() {
    if (editando) return;
    editando = true;
    elEditor.hidden = false;
    elContent.hidden = true;
    elEditor.value = cuerpo;
    elEditor.focus();
    // El cursor al final, que es donde estabas escribiendo.
    const n = elEditor.value.length;
    elEditor.setSelectionRange(n, n);
  }

  function terminarEdicion() {
    if (!editando) return;
    cuerpo = elEditor.value;
    editando = false;
    elEditor.hidden = true;
    elContent.hidden = false;
    pintar();
    guardar();
  }

  let guardarT = null;
  function guardar() {
    clearTimeout(guardarT);
    guardarT = setTimeout(async () => {
      const tags = extractTags(cuerpo);
      await dataSource.notes.update(note.id, { body: cuerpo, title: note.title, tags });
      note.updatedAt = Date.now();
      pintarMeta();
    }, 700);
  }

  elContent.addEventListener("click", (ev) => {
    const link = ev.target.closest("[data-link]");
    if (link) { ev.preventDefault(); irA(link.dataset.link, todos, root); return; }
    editar();
  });
  elContent.addEventListener("dblclick", editar);
  elEditor.addEventListener("blur", terminarEdicion);
  elEditor.addEventListener("input", () => { cuerpo = elEditor.value; guardar(); });
  // El comando de sonar: se guarda y se sale, como en cualquier editor.
  elEditor.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); terminarEdicion(); }
    if (ev.key === "Escape") { ev.preventDefault(); terminarEdicion(); }
  });

  elTitle.addEventListener("blur", async () => {
    note.title = elTitle.textContent.trim() || "Sin título";
    await dataSource.notes.update(note.id, { title: note.title });
    pintarMeta();
  });
  elTitle.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); elTitle.blur(); editar(); }
  });

  root.querySelector("#doc-back").addEventListener("click", () => {
    terminarEdicion();
    state.selectedId = null;
    renderNotes(root);
  });

  /* ── autocompletado de [[ ─────────────────────────────────── */
  elEditor.addEventListener("input", () => {
    cuerpo = elEditor.value;
    const hasta = elEditor.selectionStart;
    const antes = cuerpo.slice(0, hasta);
    const m = antes.match(/\[\[([^\]\[]*)$/);
    cerrarSugerencias(root);
    if (!m) { guardar(); return; }
    const q = m[1].trim().toLowerCase();
    const otros = todos
      .filter((n) => n.id !== note.id)
      .filter((n) => !q || (n.title || "").toLowerCase().includes(q))
      .slice(0, 6);
    if (!otros.length) { guardar(); return; }
    mostrarSugerencias(root, otros, (elegido) => {
      const desde = hasta - m[0].length;
      cuerpo = cuerpo.slice(0, desde) + `[[${elegido.title || "Sin título"}]]` + cuerpo.slice(hasta);
      elEditor.value = cuerpo;
      elEditor.focus();
      elEditor.setSelectionRange(desde + 2 + (elegido.title || "").length + 2,
                                desde + 2 + (elegido.title || "").length + 2);
      cerrarSugerencias(root);
      guardar();
    });
    guardar();
  });

  /* ── bloques: modelo 3D y oclusión ─────────────────────────── */
  function contarBloques(cuerpo) {
    return (cuerpo.match(RE_3D) || []).length + (cuerpo.match(RE_OCCL) || []).length;
  }

  function pintarBloques() {
    elBlocks.innerHTML = "";
    const encontrados = [];
    let m;
    RE_3D.lastIndex = 0;
    while ((m = RE_3D.exec(cuerpo))) encontrados.push({ kind: "3d", raw: m[0], payload: m[1], at: m.index });
    RE_OCCL.lastIndex = 0;
    while ((m = RE_OCCL.exec(cuerpo))) encontrados.push({ kind: "occl", raw: m[0], payload: m[1], at: m.index });
    encontrados.sort((a, b) => a.at - b.at);

    for (const b of encontrados) {
      const card = document.createElement("section");
      card.className = "doc-block";
      elBlocks.appendChild(card);

      if (b.kind === "3d") {
        card.dataset.raw = b.raw;
        const datos = deserializa3D(b.payload);
        card.innerHTML = `<div class="doc-block-head">
            <span class="doc-block-kind">Modelo 3D</span>
            <button class="doc-block-x" title="Quitar el bloque" aria-label="Quitar el bloque">✕</button>
          </div><div class="doc-block-body"></div>`;
        const cuerpoBloque = card.querySelector(".doc-block-body");
        mountModel3D(cuerpoBloque, {
          modelId: datos.modelId,
          assetId: datos.assetId,
          credit: datos.credit,
          labels: datos.labels,
          occlusions: datos.occlusions,
          onChange: (st) => {
            const nuevo = `{{3d:${serializa3D(st)}}}`;
            cuerpo = cuerpo.replace(b.raw, nuevo);
            b.raw = nuevo;
            guardar();
          },
        });
      } else {
        card.dataset.raw = b.raw;
        let d = { image: "", title: "Oclusión" };
        try { d = { ...d, ...JSON.parse(b.payload) }; } catch { /* está mal */ }
        card.innerHTML = `<div class="doc-block-head">
            <span class="doc-block-kind">Oclusión</span>
            <button class="doc-block-x" title="Quitar el bloque" aria-label="Quitar el bloque">✕</button>
          </div>
          <div class="doc-block-body">
            <p class="doc-block-empty">Toca para practicar: tapa una estructura y di cuál es.</p>
          </div>`;
        card.querySelector(".doc-block-body").addEventListener("click", async () => {
          const { openImageOcclusionFromFile } = await import("../widgets/image_occlusion.js");
          openImageOcclusionFromFile(d.image || null, { sourceNoteId: note.id, title: d.title })
            .catch(() => showToast("Elige una imagen para la oclusión", "warn"));
        });
      }
      card.querySelector(".doc-block-x").addEventListener("click", () => {
        cuerpo = cuerpo.replace(b.raw, "");
        guardar();
        pintarBloques();
      });
    }
  }

  /* ── añadir bloques ────────────────────────────────────────── */
  function menuAnadir(ancla) {
    const items = [
      { id: "3d", icon: "🧊", label: "Modelo 3D", hint: "Con etiquetas y oclusión" },
      { id: "occl", icon: "▮", label: "Oclusión", hint: "Practicar sobre una imagen" },
      { id: "texto", icon: "¶", label: "Texto", hint: "Volver a escribir" },
    ];
    elMenu.innerHTML = items.map((i) => `
      <button role="menuitem" data-add="${i.id}">
        <span class="doc-menu-icon" aria-hidden="true">${i.icon}</span>
        <span><strong>${i.label}</strong><small>${i.hint}</small></span>
      </button>`).join("");
    elMenu.hidden = false;
    const r = ancla.getBoundingClientRect();
    elMenu.style.left = `${Math.min(r.left, innerWidth - 260)}px`;
    elMenu.style.top = `${Math.max(8, r.top - elMenu.offsetHeight - 8)}px`;
    elMenu.querySelectorAll("[data-add]").forEach((b) =>
      b.addEventListener("click", async () => {
        elMenu.hidden = true;
        if (b.dataset.add === "texto") { terminarEdicion(); return; }
        if (b.dataset.add === "3d") {
          cuerpo = cuerpo.trimEnd() + `\n\n{{3d:${serializa3D({ modelId: "corazon", labels: [], occlusions: [] })}}}\n\n`;
        } else {
          cuerpo = cuerpo.trimEnd() + `\n\n{{occl:${JSON.stringify({ image: "", title: "Oclusión" })}}}\n\n`;
        }
        guardar();
        pintar();
        requestAnimationFrame(() =>
          elBlocks.querySelector(".doc-block:last-child")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      }));
  }

  root.querySelector("#doc-add").addEventListener("click", (ev) => {
    if (!elMenu.hidden) { elMenu.hidden = true; return; }
    menuAnadir(ev.currentTarget);
  });

  /* ── la columna de contexto ────────────────────────────────── */
  function pintarRail() {
    const rail = root.querySelector("#doc-rail");
    if (!rail) return;
    const salientes = [...cuerpo.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
    const titulo = (note.title || "").toLowerCase();
    const entrantes = todos.filter((n) => n.id !== note.id &&
      [...(n.body || "").matchAll(/\[\[([^\]]+)\]\]/g)].some((m) =>
        m[1].trim().toLowerCase() === titulo ||
        (n.title || "" && titulo.includes((n.title || "").toLowerCase()) && (n.title || "").toLowerCase().length > 3)));

    const tags = extractTags(cuerpo);
    rail.innerHTML = `
      <section class="doc-rail-sec">
        <h2 class="doc-rail-h">Etiquetas</h2>
        ${tags.length
          ? `<div class="doc-tags">${tags.map((t) => `<span class="doc-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : `<p class="doc-rail-empty">Sin etiquetas. Escribe <code>#anatomia</code> en el texto.</p>`}
      </section>
      <section class="doc-rail-sec">
        <h2 class="doc-rail-h">Enlaces</h2>
        ${salientes.length ? `<ul class="doc-rail-list">${salientes.map((t) => `
          <li><button data-link="${escapeHtml(t)}">${escapeHtml(t)}</button></li>`).join("")}</ul>`
          : `<p class="doc-rail-empty">Sin enlaces. Escribe <code>[[</code> dentro de una nota.</p>`}
        ${entrantes.length ? `
          <h2 class="doc-rail-h doc-rail-h--sub">Apuntan aquí</h2>
          <ul class="doc-rail-list">${entrantes.map((n) => `
            <li><button data-goto="${escapeHtml(n.id)}">${escapeHtml(n.title || "Sin título")}</button></li>`).join("")}</ul>` : ""}
      </section>
      <section class="doc-rail-sec">
        <h2 class="doc-rail-h">Bloques</h2>
        <p class="doc-rail-empty">${contarBloques(cuerpo) || "Ninguno todavía."}</p>
      </section>
    `;
    rail.querySelectorAll("[data-link]").forEach((b) =>
      b.addEventListener("click", () => irA(b.dataset.link, todos, root)));
    rail.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", () => { state.selectedId = b.dataset.goto; renderNotes(root); }));
  }

  /* ── menú ⋯ ───────────────────────────────────────────────── */
  root.querySelector("#doc-more").addEventListener("click", () => {
    if (!elMenu.hidden) { elMenu.hidden = true; return; }
    const items = [
      { id: "cards", icon: "🎴", label: "Crear tarjetas", hint: "De esta nota" },
      { id: "pdf", icon: "⬇", label: "Exportar a PDF", hint: "Guardar el documento" },
      { id: "dup", icon: "⧉", label: "Duplicar", hint: "Una copia nueva" },
      { id: "del", icon: "🗑", label: "Borrar la nota", hint: "No se puede deshacer" },
    ];
    elMenu.innerHTML = items.map((i) => `
      <button role="menuitem" data-do="${i.id}">
        <span class="doc-menu-icon" aria-hidden="true">${i.icon}</span>
        <span><strong>${i.label}</strong><small>${i.hint}</small></span>
      </button>`).join("")
      + (puedeImprimirConTeclado()
        ? `<p class="doc-menu-hint">Imprimir: <kbd>Ctrl</kbd>+<kbd>P</kbd></p>`
        : "");
    elMenu.hidden = false;
    const r = root.querySelector("#doc-more").getBoundingClientRect();
    elMenu.style.left = `${Math.max(8, r.right - 260)}px`;
    elMenu.style.top = `${r.bottom + 8}px`;
    elMenu.querySelectorAll("[data-do]").forEach((b) =>
      b.addEventListener("click", async () => {
        elMenu.hidden = true;
        if (b.dataset.do === "del") {
          if (!confirm(`¿Borrar «${note.title || "Sin título"}»?`)) return;
          await dataSource.notes.remove(note.id);
          state.selectedId = null;
          renderNotes(root);
        } else if (b.dataset.do === "dup") {
          await dataSource.notes.create({
            title: `${note.title || "Sin título"} (copia)`, body: cuerpo,
            tags: note.tags || [], subject: note.subject, pages: note.pages || [],
          });
          showToast("Nota duplicada", "ok");
        } else if (b.dataset.do === "pdf") {
          const { downloadNoteAsPDF } = await import("../widgets/pdf_export.js");
          downloadNoteAsPDF({ ...note, body: cuerpo });
        } else if (b.dataset.do === "cards") {
          const { authHeaders } = await import("../services/auth.js");
          const { detectApiBase } = await import("../services/api_base.js");
          const r = await fetch(
            `${detectApiBase()}/api/v1/notes/${note.id}/extract-flashcards`,
            { method: "POST", headers: authHeaders() });
          if (!r.ok) { showToast(`No se pudieron crear: ${r.status}`, "warn"); return; }
          const d = await r.json();
          const n = Array.isArray(d) ? d.length : (d.cards?.length ?? d.created ?? 0);
          showToast(n ? `Creadas ${n} tarjetas` : "No encontré nada que convertir", n ? "ok" : "warn");
        }
      }));
  });
  document.addEventListener("click", (ev) => {
    if (elMenu && !elMenu.hidden && !elMenu.contains(ev.target) &&
        !ev.target.closest("#doc-more") && !ev.target.closest("#doc-add")) {
      elMenu.hidden = true;
    }
  }, { once: true });

  root.querySelector("#doc-ai").addEventListener("click", async () => {
    // openAITutor() no recibe argumentos: el contexto se pasa aparte,
    // con setAIContext. Es el mismo camino que usaba la pantalla
    // anterior, para que el tutor siga leyendo la nota abierta.
    const { openAITutor, setAIContext } = await import("../widgets/ai_tutor.js");
    setAIContext({ subject: note.subject, note: { id: note.id, title: note.title, body: cuerpo } });
    openAITutor();
  });

  /* ── handwriting: solo si hay lápiz, y siempre se puede teclear ── */
  let pad = null;
  if (aMano) {
    pad = mountInkPad(root.querySelector("#doc-ink"), {
      deviceId: "doc",
      onStrokeEnd: async (_s, nuevos) => {
        const pages = note.pages || [];
        pages[0] = pages[0] || { strokes: [], placeholders: [] };
        pages[0].strokes.push(...nuevos);
        await dataSource.notes.update(note.id, { pages });
      },
    });
  }

  /* ── Ctrl+P, solo en PC ────────────────────────────────────── */
  if (puedeImprimirConTeclado()) {
    const onKey = async (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      if (String(ev.key).toLowerCase() !== "p") return;
      if (document.querySelector(".scrim, dialog[open]")) return;
      ev.preventDefault();
      const { printNote } = await import("./notes.js");
      await printNote({ ...note, body: cuerpo });
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("mnexus:route", () => document.removeEventListener("keydown", onKey), { once: true });
  }

  pintar();
  // Al entrar, el titulo editable ya es el sitio donde se empieza a
  // escribir. Una nota se abre para escribir en ella, no para mirarla.
  if (!(note.body || "").trim() && !(note.title || "").trim()) elTitle.focus();
}

function contarMarcadores(cuerpo, re) { return (cuerpo.match(re) || []).length; }
const contarBloques = (c) => contarMarcadores(c, RE_3D) + contarMarcadores(c, RE_OCCL);

/* ── navegación por wikilink ────────────────────────────────── */
async function irA(titulo, todos, root) {
  const norm = (s) => (s || "").trim().toLowerCase();
  const destino =
    todos.find((n) => norm(n.title) === norm(titulo)) ||
    todos.find((n) => norm(n.title).includes(norm(titulo)));
  if (!destino) { showToast(`No hay ninguna nota llamada «${titulo}»`, "warn"); return; }
  state.selectedId = destino.id;
  renderNotes(root);
}

/* ── el menú de sugerencias de [[ ───────────────────────────── */
let sugHost = null;
function cerrarSugerencias(root) { sugHost?.remove(); sugHost = null; }

function mostrarSugerencias(root, notas, alElegir) {
  cerrarSugerencias(root);
  sugHost = document.createElement("div");
  sugHost.className = "doc-suggest";
  sugHost.setAttribute("role", "listbox");
  sugHost.innerHTML = notas.map((n, i) => `
    <button role="option" aria-selected="${i === 0}" data-i="${i}">
      <strong>${escapeHtml(n.title || "Sin título")}</strong>
      <small>${escapeHtml((n.body || "").slice(0, 60))}</small>
    </button>`).join("");
  document.body.appendChild(sugHost);
  const r = document.querySelector("#doc-editor")?.getBoundingClientRect();
  if (r) {
    sugHost.style.left = `${Math.min(r.left, innerWidth - 300)}px`;
    sugHost.style.top = `${Math.min(r.top + 26, innerHeight - sugHost.offsetHeight - 12)}px`;
  }
  sugHost.querySelectorAll("[data-i]").forEach((b) =>
    b.addEventListener("mousedown", (ev) => {
      ev.preventDefault();          // si no, el textarea pierde el foco
      alElegir(notas[Number(b.dataset.i)]);
    }));
}

export default renderNotes;
