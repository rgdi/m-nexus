// ink_pad.js — la superficie de escritura.
//
// v2.38.14
//
// Lo mínimo para escribir a mano y que sirva:
//
//   · Pointer Events, que es lo único que da presión de verdad. Un
//     dedo llega con pointerType "touch" y p = -1; un lápiz llega con
//     "pen" y p entre 0 y 1. No se pregunta: se mira.
//   · Cuando no hay presión, la velocidad hace de sustituto, que es lo
//     mejor que se puede sacar del dedo.
//   · El trazo se guarda en fracciones de página, no en píxeles, para
//     que lo que se escribe en la tablet se vea igual en el portátil.
//   · El borrador parte el trazo, no deshace el último.
//   · undo apila de verdad: borra el último trazo entero.
//
// Lo que NO hace, y conviene saber: no reconoce formas, no endulza los
// trazos, no hace rectificación. Eso es lo que hacen las apps de dibujo
// de verdad y es un trabajo de meses. Lo que hay aquí escribe fino.
//
// Un detalle que importa más de lo que parece: el canvas se dibuja a
// la resolución del dispositivo, no a la del CSS, o en un iPad con
// retina el trazo sale borroso justo en el aparato para el que existe.

import { escapeHtml } from "../services/safe.js";

// v2.38.15 — dos paletas, no una.
//
// Estos colores eran los de una superficie oscura. Sobre una hoja de
// PDF —blanca— un lapiz #e8e8ef es practicamente invisible: se
// escribia a mano y no se veía nada. `ton` decide cual de las dos.
const PALETTES = {
  dark: {
    pen: { color: "#e8e8ef", width: 0.0028, alpha: 1, icon: "✎" },
    marker: { color: "#a855f7", width: 0.005, alpha: 0.75, icon: "🖍" },
    highlighter: { color: "#facc15", width: 0.012, alpha: 0.32, icon: "▬" },
    eraser: { color: "#000", width: 0.018, alpha: 1, icon: "⌫" },
  },
  // Sobre papel: tinta oscura y un resaltador que no tapa el texto.
  light: {
    pen: { color: "#111827", width: 0.004, alpha: 1, icon: "✎" },
    marker: { color: "#7c3aed", width: 0.005, alpha: 0.85, icon: "🖍" },
    highlighter: { color: "#fde047", width: 0.012, alpha: 0.42, icon: "▬" },
    eraser: { color: "#fff", width: 0.018, alpha: 1, icon: "⌫" },
  },
};

const TOOLS = PALETTES.dark;
export const INK_TOOLS = TOOLS;
export const INK_PALETTES = PALETTES;

let device = "d";
let seq = 0;
const undoStack = [];
const redoStack = [];

/**
 * Monta la superficie. Devuelve la API para poder usarla desde fuera:
 * quién escribe, cargar trazos, y vaciar.
 */
export function mountInkPad(host, opts = {}) {
  const {
    strokes: initial = [],
    background = null,
    onChange = () => {},
    readOnly = false,
    // "dark" para la superficie oscura, "light" para el papel de un PDF.
    ton = "dark",
    onStrokeEnd = null,
  } = opts;

  device = opts.deviceId || device;
  seq = opts.startSeq || 0;
  let strokes = initial.map((s) => ({ ...s }));
  let tool = opts.tool || "pen";
  let drawing = null;
  const dirty = new Map();

  host.innerHTML = `
    <div class="ink-toolbar" ${readOnly ? "hidden" : ""}>
      ${Object.entries(TOOLS)
        .map(
          ([k, t]) =>
            `<button class="ink-tool${k === tool ? " is-active" : ""}" data-tool="${k}" title="${k}" aria-label="${k}">${t.icon}</button>`,
        )
        .join("")}
      <span class="ink-spacer"></span>
      <button class="ink-tool" data-undo title="Deshacer" aria-label="Deshacer">↶</button>
      <button class="ink-tool" data-redo title="Rehacer" aria-label="Rehacer">↷</button>
    </div>
    <div class="ink-stage" data-stage>
      <svg class="ink-svg" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="ink-cursor" hidden>⌖</div>
    </div>
    <p class="ink-status" data-status></p>`;

  const stage = host.querySelector("[data-stage]");
  const svg = host.querySelector(".ink-svg");
  const status = host.querySelector("[data-status]");

  const paint = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("width", String(r.width));
    svg.setAttribute("height", String(r.height));
    if (background) {
      svg.innerHTML = `<image href="${escapeHtml(background)}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" />`;
    } else {
      svg.innerHTML = "";
    }
    for (const s of strokes) svg.insertAdjacentHTML("beforeend", `<g fill="none" stroke="${s.color}" stroke-opacity="${s.alpha}" stroke-linecap="round" stroke-linejoin="round">${pathOf(s)}</g>`);
    if (drawing && drawing.points.length > 1) {
      const t = TOOLS[tool];
      const live = { ...drawing, color: t.color, width: t.width, alpha: t.alpha };
      svg.insertAdjacentHTML("beforeend", `<g fill="none" stroke="${t.color}" stroke-opacity="${t.alpha}" stroke-linecap="round" stroke-linejoin="round">${pathOf(live)}</g>`);
    }
  };

  // El borrador parte el trazo en vez de deshacerlo.
  const eraseAt = (x, y, r) => {
    const out = [];
    for (const s of strokes) {
      let run = [];
      for (const p of s.points) {
        if (Math.hypot(p.x - x, p.y - y) <= r) {
          if (run.length) {
            const p = { ...s, id: `${s.id}-e${out.length}`, seq: ++seq, points: run };
            p.bbox = bboxOf(run, s.width);
            out.push(p);
          }
          run = [];
        } else run.push(p);
      }
      if (run.length) {
        const p = { ...s, id: `${s.id}-e${out.length}`, seq: ++seq, points: run };
        p.bbox = bboxOf(run, s.width);
        out.push(p);
      }
    }
    strokes = out;
    onChange(strokes);
  };

  const toLocal = (ev) => {
    const r = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
    };
  };

  // La paleta se resuelve una vez. Con `const TOOLS = PALETTES.dark`
  // fijo, cambiar de tono no cambiaba nada: el lapiz claro se
  // escribia igual sobre el papel.
  const tools = PALETTES[ton] || PALETTES.dark;
  Object.assign(TOOLS, tools);

  if (!readOnly) {
    stage.addEventListener("pointerdown", (ev) => {
      if (!ev.isPrimary) return;
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      const t = TOOLS[tool];
      const p = toLocal(ev);
      if (tool === "eraser") {
        eraseAt(p.x, p.y, t.width * 2);
        drawing = { erasing: true };
        paint();
        return;
      }
      drawing = {
        id: "s-" + Math.random().toString(36).slice(2, 9),
        by: device, seq: ++seq, deleted: 0,
        tool, color: t.color, width: t.width, alpha: t.alpha,
        page: 0, aspect: r0(stage), points: [{ ...p, p: ev.pointerType === "pen" ? ev.pressure : -1, t: 0 }],
        startedAt: performance.now(),
      };
      paint();
    });

    stage.addEventListener("pointermove", (ev) => {
      if (!drawing || drawing.erasing) return;
      ev.preventDefault();
      const p = toLocal(ev);
      const last = drawing.points[drawing.points.length - 1];
      // Filtro: por debajo de medio píxel CSS el trazo ya no se ve y
      // solo engorda el envio. En un móvil eso es la mitad de los puntos.
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.0015) return;
      drawing.points.push({ ...p, p: ev.pointerType === "pen" ? ev.pressure : -1, t: Math.round(performance.now() - drawing.startedAt) });
      paint();
    });

    const end = () => {
      if (!drawing) return;
      if (drawing.erasing) { drawing = null; return; }
      const s = drawing;
      drawing = null;
      if (!s.points.length) return;
      // v2.38.14 — el bbox no es opcional: el servidor lo exige y sin
      // él devolvía 400 y el trazo se perdía en el camino. Se calcula
      // con el margen del grosor, que es lo que ocupa de verdad, y
      // recortado a la página para que no salga por los bordes.
      s.bbox = bboxOf(s.points, s.width);
      strokes.push(s);
      dirty.set(s.id, s);
      undoStack.push(s.id);
      redoStack.length = 0;
      paint();
      onChange(strokes);
      if (onStrokeEnd) onStrokeEnd(s, [...dirty.values()]);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("lostpointercapture", end);
  }

  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tool]");
    if (b) {
      tool = b.dataset.tool;
      host.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("is-active", x === b));
      return;
    }
    if (ev.target.closest("[data-undo]")) {
      const id = undoStack.pop();
      if (!id) return;
      const i = strokes.findIndex((s) => s.id === id);
      if (i >= 0) { redoStack.push(strokes[i]); strokes.splice(i, 1); }
      paint();
      onChange(strokes);
    }
    if (ev.target.closest("[data-redo]")) {
      const s = redoStack.pop();
      if (!s) return;
      strokes.push(s);
      undoStack.push(s.id);
      paint();
      onChange(strokes);
    }
  });

  // El borrador y el lápiz se distinguen sin preguntar: el lápiz se
  // dibuja, el dedo borra si está en modo borrador. Es lo que espera
  // cualquiera que haya usado esto.
  stage.addEventListener("pointerenter", () => {
    if (tool === "eraser") host.querySelector(".ink-cursor").hidden = false;
  });
  stage.addEventListener("pointerleave", () => {
    host.querySelector(".ink-cursor").hidden = true;
  });
  stage.addEventListener("pointermove", (ev) => {
    const c = host.querySelector(".ink-cursor");
    if (!c || c.hidden) return;
    c.style.left = ev.clientX - stage.getBoundingClientRect().left + "px";
    c.style.top = ev.clientY - stage.getBoundingClientRect().top + "px";
  });

  paint();
  const ro = new ResizeObserver(paint);
  ro.observe(stage);

  return {
    get strokes() { return strokes; },
    setTool(t) { tool = t; },
    setBackground(url) { background = url; paint(); },
    /** Trazos nuevos llegados de otro dispositivo. */
    merge(incoming) {
      const known = new Set(strokes.map((s) => s.id));
      let added = 0;
      for (const s of incoming) {
        if (known.has(s.id)) continue;
        if (strokes.some((x) => x.id === s.id && x.seq > s.seq)) continue;
        strokes.push(s);
        added++;
      }
      if (added) { paint(); onChange(strokes); }
      return added;
    },
    clear() { strokes = []; undoStack.length = 0; paint(); onChange(strokes); },
    destroy() { ro.disconnect(); },
  };
}

/** La caja que ocupa el trazo, con el margen del grosor y sin salirse. */
function bboxOf(points, width) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = width / 2;
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(1, x1 + pad) - x, h: Math.min(1, y1 + pad) - y };
}

const r0 = (el) => {
  const r = el.getBoundingClientRect();
  return r.height ? r.width / r.height : 0.7;
};

/** Un trazo a path SVG, agrupando por grosor parecido. */
function pathOf(s) {
  if (!s.points.length) return "";
  if (s.points.length === 1) return `<path d="M ${s.points[0].x} ${s.points[0].y} L ${s.points[0].x + 0.0001} ${s.points[0].y}" stroke-width="${s.width.toFixed(4)}"/>`;
  const at = (p, from) => (p.p >= 0 ? p.p * s.width : speedWidth(from ?? p, p, s.width));
  const groups = [];
  let cur = [s.points[0]];
  for (let i = 1; i < s.points.length; i++) {
    const p = s.points[i];
    const w = at(p, cur[cur.length - 1]);
    if (cur.length > 1 && Math.abs(w - at(cur[0], cur[0])) / s.width > 0.1) {
      groups.push(cur);
      cur = [p];
    } else cur.push(p);
  }
  groups.push(cur);
  return groups
    .map((g) => {
      const d = g.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
      const mid = g[Math.floor(g.length / 2)];
      const w = mid.p >= 0 ? mid.p * s.width : s.width * 0.7;
      return `<path d="${d}" stroke-width="${w.toFixed(4)}"/>`;
    })
    .join("");
}

/** Sin presión, la velocidad hace de sustituto. */
function speedWidth(from, to, base) {
  const dt = Math.max(1, to.t - from.t);
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  // v2.38.15 — el suelo era 0.35 y el trazo rapido se rompia en
  // puntos. Escribir deprisa tiene que salir mas fino, no partido:
  // por debajo de la mitad el segmento desaparece y la linea parece
  // una serie de rayas sueltas.
  return base * Math.max(0.5, Math.min(1.4, 1 - (d / dt) * 500));
}
