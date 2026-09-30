// ink.ts — la tinta como vector, no como imagen.
//
// v2.38.11
//
// La idea es de rnote, reimplementada aquí. No es una ideatrivial:
//
//   Si guardas un handwriting como PNG, no puedes mover un trazo sin
//   volver a dibujarlo, no puedes cambiar el grosor de lo que ya está
//   escrito, y dos dispositivos queshows a distinta resolución
//   muestran cosas distintas. Si lo guardas como vector, el trazo se
//   puede mover, colorear, borrar por segmentos y se ve igual en
//   cualquier pantalla.
//
// Eso es lo que hace que "escribe en la tablet, míralo en el portátil"
// sea lo mismo y no dos versiones.
//
// Un trazo:
//
//   { id, seq, autor, tool, color, width, puntos: [{x,y,p,t}], bbox }
//
//   x,y  en unidades de página, 0..1, no en píxeles: así el mismo
//        trazo encaja igual en un móvil de 390 y en uno de 1440
//   p    presión 0..1. Viene vacía cuando el puntero no la da —el dedo
//        no la da, y un stylus sí— y entonces se usa la velocidad
//   t    milisegundos desde el inicio del trazo, para la relectura y
//        para ordenar trazos que llegan desordenados
//
// Sobre el conflicto: dos trazos que se solapan NO son un conflicto.
// Son dos trazos, y se ven los dos. Lo que no puede pasar es que un
// trazo se modifique a la vez en dos sitios, y para eso está el
// `seq`: el que tenga el seq mayor gana, y el otro se descarta. Es la
// misma regla de LWW que ya usa el resto, pero aplicada a un trazo
// entero en lugar de a un caracter.

import { createHash } from "node:crypto";

export type Tool = "pen" | "marker" | "highlighter" | "eraser";

export interface InkPoint {
  /** 0..1 dentro de la página. */
  x: number;
  y: number;
  /** Presión 0..1. -1 cuando el dispositivo no la da. */
  p: number;
  /** ms desde el inicio del trazo. */
  t: number;
}

export interface Stroke {
  id: string;
  /** Del dispositivo que lo creó. */
  by: string;
  /** Reloj lógico del autor. El mayor gana. */
  seq: number;
  /** Reloj lógico al que se borró, o 0 si sigue vivo. */
  deleted: number;
  tool: Tool;
  color: string;
  width: number;
  /** Opacidad, para el highlighter. */
  alpha: number;
  points: InkPoint[];
  /** Página a la que se ancla. */
  page: number;
  /** Tamaño normalizado del papel: para saber si cabe. */
  aspect: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface InkPage {
  /** Lo que hay debajo: una nota, una página de PDF, una imagen. */
  background: { kind: "blank" | "note" | "pdf" | "image"; ref?: string; page?: number };
  strokes: Stroke[];
}

export interface InkDoc {
  id: string;
  updatedAt: number;
  pages: InkPage[];
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

/** Simplificación de Ramer-Douglas-Peucker. Un dedo genera 200 puntos
 *  por trazo y no los necesitas todos: quita los que no cambian la
 *  forma. Es la diferencia entre un trazo de 4KB y uno de 1KB. */
export function simplify(points: InkPoint[], tolerance = 0.0016): InkPoint[] {
  if (points.length < 3) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

export function bboxOf(points: InkPoint[], width: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  // El margen del grosor puede sacar la caja por el borde de la
  // página. Se recorta: una caja negativa se dibuja fuera y el
  // renderizador la descarta o la pinta donde no es.
  const pad = width / 2;
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return {
    x,
    y,
    w: Math.min(1, x1 + pad) - x,
    h: Math.min(1, y1 + pad) - y,
  };
}

/** Qué grosor usar en cada punto cuando el dispositivo no da presión.
 *
 *  Un dedo no tiene presión, así que la velocidad es lo único que hay:
 *  rápido es fino, despacio es gordo. Es lo que hacen los editores de
 *  nota y no es un truco, es lo mejor que se puede sacar del dedo. */
export function widthForSpeed(from: InkPoint, to: InkPoint, base: number): number {
  const dt = Math.max(1, to.t - from.t);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  // v2.38.11 — el factor estaba mal calibrado: multiplicaba por 0.55
  // esperando píxeles. En fracciones de página un trazo normal va a
  // 0.001/ms, así que el factor salía siempre a 1 y la velocidad no
  // hacía nada. 500 es el que convierte 0.001/ms en una caída de 0.45.
  const speed = dist / dt; // fracción de página por ms
  const factor = Math.max(0.35, Math.min(1.4, 1 - speed * 500));
  return base * factor;
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

export function newStroke(opts: {
  id?: string;
  by: string;
  seq: number;
  tool: Tool;
  color: string;
  width: number;
  alpha?: number;
  page: number;
  aspect: number;
}): Stroke {
  return {
    id: opts.id ?? "s-" + Math.random().toString(36).slice(2, 10),
    by: opts.by,
    seq: opts.seq,
    deleted: 0,
    tool: opts.tool,
    color: opts.color,
    width: opts.width,
    alpha: opts.alpha ?? (opts.tool === "highlighter" ? 0.32 : opts.tool === "marker" ? 0.6 : 1),
    points: [],
    page: opts.page,
    aspect: opts.aspect,
    bbox: { x: 0, y: 0, w: 0, h: 0 },
  };
}

export function finishStroke(s: Stroke, tolerance = 0.0016): Stroke {
  s.points = simplify(s.points, tolerance);
  s.bbox = bboxOf(s.points, s.width);
  return s;
}

// ---------------------------------------------------------------------------
// Fusión: la parte que hace que dos dispositivos puedan dibujar a la vez
// ---------------------------------------------------------------------------

export interface MergeReport {
  added: number;
  updated: number;
  removed: number;
  /** Trazos que ha rechazado por conflicto, para poder decirlo. */
  conflicts: { id: string; winner: "local" | "remote" }[];
}

/**
 * Fusiona trazos sueltos. Es una unión por id con LWW sobre `seq`.
 *
 * Reglas:
 *   · id nuevo            → entra
 *   · mismo id, seq mayor → gana el de seq mayor
 *   · mismo id y seq igual → da igual el color y quien no cambia
 *   · borrado (deleted)   → un borrado con seq mayor que la última
 *     modificación gana, y el trazo desaparece para siempre
 *
 * La última regla es la importante: es la que impide que un trazo
 * borrado en la tablet reaparezca porque el portátil lo tenía en caché.
 */
export function mergeStrokes(local: Stroke[], incoming: Stroke[]): { strokes: Stroke[]; report: MergeReport } {
  const byId = new Map<string, Stroke>();
  for (const s of local) byId.set(s.id, s);
  const report: MergeReport = { added: 0, updated: 0, removed: 0, conflicts: [] };

  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      report.added++;
      continue;
    }
    // v2.38.11 — el borrado es un tombstone con reloj propio, y NADIE
    // lo resucita. Antes, una modificacion posterior con seq mas alto
    //Than el borrado lo traia de vuelta: en la tablet se borraba un
    // trazo y en el portatil, que tenia la version vieja en cache,
    // aparecía otra vez. Es perder trabajo sin avisar.
    const borrado = Math.max(cur.deleted, inc.deleted);
    if (borrado > 0 && borrado >= Math.max(cur.seq, inc.seq)) {
      byId.delete(inc.id);
      if (cur.deleted < inc.deleted) {
        report.removed++;
        report.conflicts.push({ id: inc.id, winner: "remote" });
      }
      continue;
    }
    if (inc.seq > cur.seq) {
      byId.set(inc.id, inc);
      report.updated++;
      report.conflicts.push({ id: inc.id, winner: "remote" });
      continue;
    }
    // Mismo seq y mismo estado: la más antigua gana, para que dos
    // dispositivos que convergen lleguen al mismo sitio.
    if (inc.seq === cur.seq && !cur.deleted) byId.set(inc.id, inc);
  }

  return { strokes: [...byId.values()].sort((a, b) => a.page - b.page || a.seq - b.seq), report };
}

export function eraseAt(strokes: Stroke[], x: number, y: number, radius: number, seq: number): Stroke[] {
  // El borrador parte el trazo en trozos, como un borrador de verdad:
  // no deshace medio trazo, lo que hace es quitar lo que pilla.
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (s.tool === "eraser") { out.push(s); continue; }
    // Un solo trozo significa que la mancha no ha caido en nada: el
    // trazo sigue entero. Antes aqui se empujaba un array de puntos
    // donde se esperaba un trazo, y el borrador rompia al borrar.
    const segments = splitAtPoint(s, x, y, radius);
    if (segments.length === 1 && segments[0].length === s.points.length) { out.push(s); continue; }
    let piece = 0;
    for (const seg of segments) {
      if (seg.length === 0) continue;
      const clone: Stroke = {
        ...s,
        id: `${s.id}-e${piece++}`,
        seq,
        points: seg,
        bbox: bboxOf(seg, s.width),
      };
      out.push(clone);
    }
  }
  return out;
}

/** Parte un trazo en los trozos que quedan fuera de una mancha. */
export function splitAtPoint(s: Stroke, cx: number, cy: number, r: number): InkPoint[][] {
  const out: InkPoint[][] = [];
  let current: InkPoint[] = [];
  for (const p of s.points) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d <= r) {
      if (current.length) { out.push(current); current = []; }
    } else {
      current.push(p);
    }
  }
  if (current.length) out.push(current);
  return out.length ? out : [[]];
}

// ---------------------------------------------------------------------------
// Representación SVG: lo que se guarda y lo que se puede exportar
// ---------------------------------------------------------------------------

/**
 * Dibuja un trazo como path SVG con anchura variable.
 *
 * La anchura variable es lo que hace que un handwriting parezca hecho a
 * mano y no con un rotulador de grosor fijo. Se agrupan los puntos
 * consecutivos con presión parecida y se hace un trazo por grupo, con
 * `stroke-linecap: round` para que las uniones no se vean.
 */
export function strokeToPath(s: Stroke): string {
  if (s.points.length === 0) return "";
  if (s.points.length === 1) {
    const p = s.points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.0001} ${p.y}`;
  }

  // v2.38.11 — la tolerancia es RELATIVA al grosor del pincel. Con una
  // absoluta, 0.18 contra grosores de 0.004, nunca se separaba nada:
  // un trazo con la presión subiendo y bajando salía entero con un
  // solo grosor, que es exactamente lo contrario de lo que se quiere.
  const groupTolerance = 0.1;
  const rel = (w: number) => w / (s.width || 1e-6);
  const groups: InkPoint[][] = [];
  let cur: InkPoint[] = [s.points[0]];
  const widthAt = (p: InkPoint, from?: InkPoint) =>
    p.p >= 0 ? p.p * s.width : widthForSpeed(from ?? p, p, s.width);

  for (let i = 1; i < s.points.length; i++) {
    const p = s.points[i];
    const w = widthAt(p, cur[cur.length - 1]);
    // v2.38.11 — se compara contra el grosor con el que se ABRIO el
    // grupo, no contra el punto anterior. Contra el anterior, una
    // presión que sube despacio nunca supera el umbral —cada salto
    // individual es pequeño— y el trazo entero sale con un solo
    // grosor, que es justo lo que se queria evitar.
    const wAbierto = widthAt(cur[0], cur[0]);
    if (cur.length > 1 && Math.abs(rel(w) - rel(wAbierto)) > groupTolerance) {
      groups.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length) groups.push(cur);

  return groups
    .filter((g) => g.length > 0)
    .map((g) => {
      const d = g
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ");
      const mid = g[Math.floor(g.length / 2)];
      const w = mid.p >= 0 ? mid.p * s.width : s.width * 0.7;
      return `<path d="${d}" stroke-width="${(w * 2000).toFixed(1)}"/>`;
    })
    .join("");
}

export function toSvg(doc: InkDoc, opts: { background?: string } = {}): string {
  const parts = doc.pages.map((page, i) => {
    const strokes = page.strokes
      .map((s) => `<g fill="none" stroke="${s.color}" stroke-opacity="${s.alpha}" stroke-linecap="round" stroke-linejoin="round">${strokeToPath(s)}</g>`)
      .join("");
    return `<g data-page="${i}">${strokes}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"${opts.background ? ` style="background:${opts.background}"` : ""}>${parts.join("")}</svg>`;
}

/** Huella del documento, para saber si dos dispositivos lo tienen igual. */
export function inkHash(doc: InkDoc): string {
  const parts = doc.pages.flatMap((p) => p.strokes.map((s) => `${s.id}:${s.seq}:${s.deleted}`));
  return createHash("sha1").update(parts.sort().join("|")).digest("hex").slice(0, 16);
}
