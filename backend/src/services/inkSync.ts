// inkSync.ts — dos dispositivos, la misma nota, al mismo tiempo.
//
// v2.38.11
//
// El problema real no es enviar los trazos: es qué pasa cuando los dos
// dispositivos estavam offline y los dos escribieron.
//
// La respuesta depende de qué se esté sincronizando:
//
//   TEXTO   hay CRDT de secuencia con tombstones. Insertar "ab" y "bc"
//            en el mismo sitio da "abc", no una de las dos. Funciona.
//
//   TINTA   dos trazos que se cruzan NO son un conflicto: son dos
//            trazos y se ven los dos. Intentar fusionarlos en uno sería
//            inventarse unos puntos que nadie escribió. La única
//            colisión real es el MISMO trazo, y para eso está el seq.
//
//   BORRADO el borrado gana si su seq es mayor que la última
//            modificación. Si no, un trazo borrado en la tablet
//            reaparece porque el portátil lo tenía en caché, y eso es
//            perder trabajo sin avisar.
//
// Aquí no hay servidor de WebSocket —Fastify y este despliegue no lo
// traen de serie y añadirlo ahora sería lo bastante frágil—, así que
// el transporte es longepolling: el cliente manda lo que tiene y pide
// lo que no, y el servidor responde con lo que le falta. Es peor que un
// push y es honesto: no finge estar en tiempo real, tiene una ventana.
//
// Cuando haya WebSocket, esto es el mismo contrato con otro transporte:
// los dos hablan el mismo `merge` y devuelven el mismo `report`.

import { mergeStrokes, inkHash, type InkDoc, type Stroke, type MergeReport } from "./ink.js";
import { readCollection, writeCollection } from "./userStore.js";
import { logOp } from "../utils/log.js";

const STORE = "ink.json";

export interface InkPush {
  docId: string;
  /** Lo que este dispositivo ha creado o cambiado. */
  strokes: Stroke[];
  /** Su reloj lógico, para que el servidor sepa qué es más nuevo. */
  seq: number;
  deviceId: string;
}

export interface InkPull {
  docId: string;
  /** Reloj que el cliente tenía la última vez. 0 = desde cero. */
  since: number;
}

export interface InkSyncResponse {
  docId: string;
  /** Lo que el servidor tiene y el cliente no. */
  incoming: Stroke[];
  /** Hash del estado del servidor, para detectar divergencia. */
  hash: string;
  /** Reloj del servidor. El cliente lo guarda como `since`. */
  seq: number;
  report: MergeReport;
  /** Presencia: qué dispositivos han escrito y cuándo. */
  presence: { deviceId: string; lastAt: number; strokes: number }[];
  /** Si el cliente.subió algo más viejo que el servidor, se dice. */
  diverged: boolean;
}

const PRESENCE_TTL = 90_000;

async function load(sub: string, docId: string): Promise<InkDoc> {
  const all = await readCollection<Record<string, InkDoc>>(sub, STORE, {});
  return all[docId] ?? { id: docId, updatedAt: 0, pages: [] };
}

async function save(sub: string, doc: InkDoc): Promise<void> {
  const all = await readCollection<Record<string, InkDoc>>(sub, STORE, {});
  all[doc.id] = doc;
  await writeCollection(sub, STORE, all);
}

function pageOf(doc: InkDoc, page: number) {
  let p = doc.pages[page];
  if (!p) {
    p = { background: { kind: "blank" }, strokes: [] };
    doc.pages[page] = p;
  }
  return p;
}

/** Fusiona un empuje del cliente y devuelve lo que el cliente necesita. */
export async function pushInk(sub: string, push: InkPush): Promise<InkSyncResponse> {
  const t0 = Date.now();
  const doc = await load(sub, push.docId);

  let added = 0, updated = 0, removed = 0, diverged = false;
  const conflicts: MergeReport["conflicts"] = [];

  for (const pageNo of new Set(push.strokes.map((s) => s.page))) {
    const page = pageOf(doc, pageNo);
    const incoming = push.strokes.filter((s) => s.page === pageNo);
    const { strokes, report } = mergeStrokes(page.strokes, incoming);
    page.strokes = strokes;
    added += report.added;
    updated += report.updated;
    removed += report.removed;
    conflicts.push(...report.conflicts);
    if (report.conflicts.some((c) => c.winner === "local")) diverged = true;
  }

  doc.updatedAt = Date.now();
  await save(sub, doc);

  logOp("ink", "push", true, {
    doc: push.docId, device: push.deviceId, sent: push.strokes.length,
    added, updated, removed, ms: Date.now() - t0,
  });

  // Presencia: quién ha escrito y hace cuánto.
  const all = await readCollection<Record<string, unknown>>(sub, "ink-presence.json", {});
  const seen = new Map<string, number>();
  for (const d of Object.keys(all)) seen.set(d, Number(all[d]) || 0);
  seen.set(push.deviceId, Date.now());
  await writeCollection(sub, "ink-presence.json", Object.fromEntries(seen));

  const presence = [...seen.entries()]
    .map(([deviceId, lastAt]) => ({ deviceId, lastAt, strokes: push.deviceId === deviceId ? push.strokes.length : 0 }))
    .filter((p) => Date.now() - p.lastAt < PRESENCE_TTL)
    .sort((a, b) => b.lastAt - a.lastAt);

  return {
    docId: push.docId,
    incoming: [],
    hash: inkHash(doc),
    seq: push.seq,
    report: { added, updated, removed, conflicts },
    presence,
    diverged,
  };
}

/** Qué tiene el servidor que el cliente no. */
export async function pullInk(sub: string, pull: InkPull): Promise<InkSyncResponse> {
  const doc = await load(sub, pull.docId);
  const all = await readCollection<Record<string, number>>(sub, "ink-presence.json", {});
  const presence = Object.entries(all)
    .map(([deviceId, lastAt]) => ({ deviceId, lastAt: Number(lastAt), strokes: 0 }))
    .filter((p) => Date.now() - p.lastAt < PRESENCE_TTL)
    .sort((a, b) => b.lastAt - a.lastAt);

  return {
    docId: pull.docId,
    incoming: doc.pages.flatMap((p) => p.strokes).filter((s) => s.seq > pull.since),
    hash: inkHash(doc),
    seq: doc.pages.flatMap((p) => p.strokes).reduce((a, s) => Math.max(a, s.seq), 0),
    report: { added: 0, updated: 0, removed: 0, conflicts: [] },
    presence,
    diverged: false,
  };
}

/** El documento entero, para abrirlo en otro dispositivo. */
export async function getInk(sub: string, docId: string): Promise<InkDoc> {
  return load(sub, docId);
}
