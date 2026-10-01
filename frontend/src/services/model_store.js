/**
 * model_store.js — dónde vive un modelo 3D que tú has abierto.
 *
 * v2.38.20. Un `.glb` de un cuerpo entero pesa entre 5 y 40 MB.
 *
 * La primera versión lo guardaba como un `objectURL` en memoria, que
 * dura lo que dura la pestaña: al recargar la nota, el modelo se
 * apagaba y volvía al de ejemplo sin decir por qué.
 *
 * Lo que NO sirve, y se intentó primero:
 *
 * - **localStorage con base64**, como se guardan los adjuntos. Un .glb
 *   de 12 MB son 16 MB de base64, y la cuota son 5. En el segundo
 *   modelo te comía la cuota entera de la aplicación: las notas, los
 *   ajustes y el resto de adjuntos. Los adjuntos de texto siguen así
 *   porque son pequeños; un modelo no.
 * - **Subirlo al servidor.** El endpoint de subida por trozos existe y
 *   acepta hasta 500 MB, pero **no hay ninguna ruta que sirva lo
 *   subido**: no se puede volver a pedir. Montar ese camino —subir,
 *   servir con autenticación, limpiar, sincronizar entre dispositivos—
 *   es trabajo de producto, no un parche. Está anotado en el TODO.
 *
 * IndexedDB sí: almacena el `Blob` tal cual, sin base64 y sin
 * multiplicar por un tercio el tamaño, y aguanta de sobra.
 *
 * Alcance: **este dispositivo y este navegador**. No se sincroniza entre
 * dispositivos. Es lo que hay, y se dice.
 */

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
    // Se aborta a proposito: si IndexedDB no abre, `promesaDB` queda
    // en null y el siguiente intento lo vuelve a intentar. Dejar el
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

/** Guarda el archivo. Devuelve el id con el que quedarse guardado. */
export async function guardarModelo({ nombre, blob, credito = "" }) {
  const id = "mdl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  await tx("readwrite", (s) => s.put({
    id, nombre, credito, blob, bytes: blob.size, guardadoAt: Date.now(),
  }));
  return id;
}

/** Devuelve el registro, o null si este dispositivo no lo tiene. */
export async function leerModelo(id) {
  if (!id) return null;
  try { return await tx("readonly", (s) => s.get(id)); }
  catch { return null; }
}

/** Una URL de objeto para el visor. La que sea, no importa cuál. */
export async function urlDeModelo(id) {
  const reg = await leerModelo(id);
  if (!reg || !reg.blob) return null;
  return URL.createObjectURL(reg.blob);
}

export async function borrarModelo(id) {
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* nada que hacer */ }
}

/** Los modelos guardados en este dispositivo, para la lista. */
export async function listarModelos() {
  try {
    const todos = await tx("readonly", (s) => s.getAll());
    return (todos || [])
      .map(({ id, nombre, bytes, guardadoAt }) => ({ id, nombre, bytes, guardadoAt }))
      .sort((a, b) => b.guardadoAt - a.guardadoAt);
  } catch { return []; }
}

/** Los que ocupan sitio, para poder dizerlo en voz alta. */
export async function espacioUsado() {
  const l = await listarModelos();
  return l.reduce((n, m) => n + (m.bytes || 0), 0);
}
