// model_store.js — dónde vive un modelo 3D que tú has abierto.
//
// v2.38.20 lo puso en IndexedDB: mejor que nada, pero el archivo
// vivía SOLO en ese navegador. Abres un modelo en el portátil, no lo
// tienes en la tablet, y la nota se ve rota en la tablet.
//
// v2.38.21 — ahora hay dos sitios, y uno manda:
//
//   1. **El servidor**, en el directorio del usuario. Es la fuente
//      buena: se sube una vez y llega a todos los dispositivos, con
//      cuenta o sin ella.
//   2. **IndexedDB**, como caché. Para no bajar 12 MB cada vez que
//      abres la nota, y para que funcione sin red.
//
// Al abrir un modelo: primero IndexedDB; si no está, se pide al
// servidor y se cachea. Al elegir uno nuevo: se sube y se cachea.
//
// ── Lo que no sirve, y por qué ────────────────────────────────────
//
// - **localStorage con base64**, como los adjuntos. Un .glb de 12 MB
//   son 16 MB de base64, y la cuota son 5. En el segundo modelo te
//   comía la cuota entera de la aplicación: notas, ajustes y el resto
//   de adjuntos. Los adjuntos de texto siguen así porque son
//   pequeños; un modelo no.
//
// - **Guardarlo solo en el navegador**, que es lo que había. Barato y
//   inútil en cuanto cambias de aparato, que es justo cuando lo
//   necesitas para estudiar.
//
// La subida va por el endpoint propio de modelos, no por el de trozos
// de `upload.ts`: aquel no ata la sesión a ningún usuario y deja el
// archivo en un directorio compartido.

import { authHeaders } from "./auth.js";
import { detectApiBase } from "./api_base.js";

const DB = "mnexus-models";
const STORE = "modelos";
const VERSION = 1;

let promesaDB = null;

function abrir() {
  if (promesaDB) return promesaDB;
  promesaDB = new Promise((ok, ko) => {
    if (typeof indexedDB === "undefined") { ko(new Error("sin IndexedDB")); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => ok(req.result);
    // Se aborta a proposito: si IndexedDB no abre, `promesaDB` queda en
    // null y el siguiente intento lo vuelve a intentar. Dejar el
    // rechazo cacheado dejaría el boton muerto para siempre.
    req.onerror = () => { promesaDB = null; ko(req.error || new Error("IndexedDB no abre")); };
  });
  return promesaDB;
}

function tx(modo, fn) {
  return abrir().then((db) => new Promise((ok, ko) => {
    const t = db.transaction(STORE, modo);
    const s = t.objectStore(STORE);
    let res;
    try { res = fn(s); } catch (e) { ko(e); return; }
    t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error("transacción anulada"));
  }));
}

/* ── caché local ────────────────────────────────────────────────── */

/** Guarda el archivo en este dispositivo. */
export async function guardarEnCache({ id, nombre, blob, credito = "" }) {
  await tx("readwrite", (s) => s.put({
    id, nombre, credito, blob, bytes: blob.size, cacheadoAt: Date.now(),
  }));
  return id;
}

export async function leerDeCache(id) {
  if (!id) return null;
  try { return await tx("readonly", (s) => s.get(id)); }
  catch { return null; }
}

export async function urlDeCache(id) {
  const reg = await leerDeCache(id);
  if (!reg || !reg.blob) return null;
  return URL.createObjectURL(reg.blob);
}

export async function borrarDeCache(id) {
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* nada */ }
}

export async function listarCache() {
  try {
    const todos = await tx("readonly", (s) => s.getAll());
    return (todos || []).map(({ id, nombre, bytes, cacheadoAt }) =>
      ({ id, nombre, bytes, cacheadoAt }));
  } catch { return []; }
}

/* ── el servidor ────────────────────────────────────────────────── */

const API = () => `${detectApiBase()}/api/v1/models`;

async function pedir(ruta, opciones = {}) {
  const r = await fetch(API() + ruta, { ...opciones, headers: authHeaders() });
  if (!r.ok) {
    let detalle = "";
    try { detalle = (await r.json())?.error || ""; } catch { /* cuerpo no json */ }
    const e = new Error(detalle || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r;
}

/** Sube el archivo. Devuelve el registro del servidor, id incluido. */
export async function subirModelo({ nombre, blob, credito = "" }) {
  const fd = new FormData();
  fd.append("file", new Blob([blob], { type: "model/gltf-binary" }), nombre || "modelo.glb");
  if (credito) fd.append("credit", credito);
  const r = await fetch(API() + "/upload", {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(cuerpo.error || `HTTP ${r.status}`);
    e.status = r.status;
    e.limite = cuerpo.max || null;
    throw e;
  }
  return cuerpo;
}

/**
 * Lo que hay en el servidor, para este usuario.
 *
 * v2.38.21 — el fallo se devuelve en vez de tragárselo. Antes devolvía
 * una lista vacía y quien la miraba veía "no tienes modelos", que es
 * una verdad: la de verdad, que es "no se pudo preguntar", no lo era.
 */
export async function listarServidor() {
  try {
    // `pedir` devuelve la Response, no el cuerpo. Sin este `.json()` la
    // lista llegaba como una Response y `d.models` era undefined: la
    // pantalla decía "no tienes modelos" cuando lo que pasaba es que
    // nadie había preguntado.
    const r = await pedir("");
    return await r.json();
  } catch (e) {
    return { models: [], used: 0, max: 0, error: String(e.message || e) };
  }
}

/**
 * El archivo de un modelo, de donde toque.
 *
 * Primero la caché —que es lo que hace que abrir una nota no baje 12 MB
 * cada vez— y si no está, el servidor, y se cachea para la próxima.
 *
 * Devuelve `{ url, deCache }`, o `null` si no se puede en ninguna parte.
 */
export async function urlDeModelo(id) {
  if (!id) return null;
  const enCache = await urlDeCache(id);
  if (enCache) return { url: enCache, deCache: true };

  let r;
  try {
    r = await pedir("/" + encodeURIComponent(id));
  } catch {
    return null;
  }
  const blob = await r.blob();
  const nombre = r.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/)?.[1] || id;
  await guardarEnCache({ id, nombre, blob, credito: "" }).catch(() => {});
  const url = URL.createObjectURL(blob);
  return { url, deCache: false, nombre };
}

/** Sube y deja en caché: el camino de "acabo de elegir un archivo". */
export async function subirYCachear({ nombre, blob, credito = "" }) {
  const rec = await subirModelo({ nombre, blob, credito });
  await guardarEnCache({
    id: rec.id, nombre: rec.name || nombre, blob, credito: rec.credit || credito,
  });
  return rec;
}

export async function borrarModelo(id) {
  await borrarDeCache(id).catch(() => {});
  try { await pedir("/" + encodeURIComponent(id), { method: "DELETE" }); }
  catch { /* que se quede en la caché si el servidor no lo pudo borrar */ }
}
