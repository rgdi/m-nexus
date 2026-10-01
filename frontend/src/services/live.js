// live.js — el canal en tiempo real, del lado del cliente.
//
// v2.38.14
//
// El servidor ya avisa cuando algo cambia. Esto es lo que hace que eso
// llegue a la pantalla.
//
// Sin esto, el móvil y el portátil muestran dos verdades: el servidor va
// bien, pero cada uno enseña la foto que tenía al abrirse. Es el fallo
// más difícil de detectar de todos, porque todo parece funcionar.
//
// Lo que hace, y en orden:
//
//   1. Se suscribe al canal del servidor.
//   2. Recuerda la última revisión que ha visto.
//   3. Cuando llega una revisión distinta, dice "esto ha cambiado" y
//      quien lo ha pedido recarga. No recarga por su cuenta: hay cinco
//      sitios que tienen que saber de sus cambios y cada uno sabe qué
//      recargar. Una recarga global en medio de una escritura borra lo
//      que el usuario está escribiendo.
//   4. Si se cae, vuelve solo. El navegador reintenta, pero el
//      EventSource no recuerda por dónde iba, así que se abre con la
//      última revisión conocida y el servidor le pasa lo perdido.
//
// Decisión: NO se recarga automáticamente. Se avisa. El motivo es que
// un recargón automático en mitad de una edición destruye el trabajo,
// que es peor que mostrar algo un segundo más viejo. Quien quiera el
// comportamiento automático se lo suscribe a mano.

import { detectApiBase } from "./api_base.js";
import { authHeaders } from "./auth.js";

/** El token que el canal necesita. */
function accessToken() {
  return (
    sessionStorage.getItem("mnexus.auth.access") ||
    localStorage.getItem("mnexus.auth.access") ||
    ""
  );
}

let source = null;
let revision = 0;
let reconnectTimer = null;
let attempts = 0;

const listeners = new Set();
// `gap` a true significa: hay cambios que este cliente no va a poder
// recuperar del canal porque ya no están en el historial. La app lo
// tiene que honor, no esconderlo.
const state = {
  connected: false, revision: 0, lastEventAt: 0, account: null,
  gap: false, serverRevision: 0, lastSyncedAt: 0,
};

/** Alguien que quiere enterarse. Devuelve la función para dejar de oír. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function liveState() {
  return { ...state };
}

/** La revisión que tenemos. Para guardarla al abrir una pantalla. */
export function localRevision() {
  return revision;
}

export function startLive() {
  if (source) return;
  if (typeof EventSource === "undefined") return;
  connect();
}

function connect() {
  const base = detectApiBase();
  // v2.38.14 — el token va en la query porque EventSource no sabe
  // mandar cabeceras. Sin esto el canal abría sin identidad y no
  // llegaba nada nunca, y seemed que funcionara porque el "hola" sí
  // llegaba.
  const tok = accessToken();
  if (!tok) return;
  const q = new URLSearchParams({ token: tok });
  if (revision) q.set("since", String(revision));
  const url = `${base}/api/v1/stream?${q}`;
  let es;
  try {
    es = new EventSource(url, { withCredentials: false });
  } catch {
    scheduleReconnect();
    return;
  }
  source = es;

  es.addEventListener("hello", (ev) => {
    let d = {};
    try { d = JSON.parse(ev.data); } catch {}
    state.connected = true;
    state.account = d.account ?? null;
    // v2.38.19 — aquí ya NO se adopta la revisión que manda el
    // servidor. Antes sí, y era el agujero entero: al reconectar, el
    // `hello` subía `revision` a la actual, y los eventos perdidos que
    // venían justo después llegaban "viejos" y se descartaban. Es
    // decir: reconectar garantizaba perder lo perdido.
    //
    // Ahora la referencia es la que el cliente dice tener. El backlog
    // la sube evento a evento, y el `synced` final la fija.
    if (typeof d.revision === "number") {
      revision = Math.max(revision, d.revision);
      state.revision = revision;
    }
    // `truncated`: el hueco es más grande que el historial guardado.
    // No hay nada que recuperar, así que hay que decirlo —quien
    // escucha decide si recarga, y una recarga a ciegas en mitad de
    // una escritura borra el trabajo.
    state.gap = !!d.truncated;
    state.serverRevision = typeof d.current === "number" ? d.current : revision;
    attempts = 0;
    if (state.gap) {
      for (const fn of listeners) {
        try { fn({ revision, collection: null, by: null, gap: true }); }
        catch { /* un oyente roto no para a los demás */ }
      }
    }
  });

  // Cierre de la sincronización: ya se ha entregado todo lo que había.
  es.addEventListener("synced", (ev) => {
    let d = {};
    try { d = JSON.parse(ev.data); } catch {}
    if (typeof d.revision === "number") {
      revision = d.revision;
      state.revision = revision;
    }
    state.serverRevision = revision;
    state.lastSyncedAt = Date.now();
  });

  es.addEventListener("change", (ev) => {
    let d = {};
    try { d = JSON.parse(ev.data); } catch {}
    state.lastEventAt = Date.now();
    // Un mensaje viejo no es un cambio: llega igual después de
    // reconectar, y avisar por él sería recargar sin motivo.
    if (typeof d.revision === "number") {
      if (d.revision <= revision) return;
      revision = d.revision;
      state.revision = revision;
    }
    for (const fn of listeners) {
      try { fn({ revision, collection: d.collection ?? null, by: d.by ?? null }); }
      catch { /* un oyente roto no para a los demás */ }
    }
  });

  es.onerror = () => {
    // readyState CLOSED significa que se acabó del todo: el EventSource
    // no reintenta solo en ese caso, y es justo el que nos interesa
    // cubrir cuando la app vuelve del segundo plano en un móvil.
    state.connected = false;
    try { es.close(); } catch {}
    source = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  // Espera creciente con tope. Un backend que no está no se reintenta
  // cada segundo: eso es lo que deja la batería seca en un móvil.
  attempts++;
  const wait = Math.min(30000, 1000 * Math.pow(1.6, Math.min(attempts, 8)));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, wait);
}

export function stopLive() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (source) { try { source.close(); } catch {} source = null; }
  state.connected = false;
  attempts = 0;
}

/**
 * Comprobar al abrir la app si lo que tenemos es lo último.
 *
 * El canal puede no haberse conectado nunca —el móvil刚从 segundo
 * plano, la red ha ido y vuelto— y sin esta comprobación el usuario
 * abre la app y ve datos viejos sin enterarse.
 */
export async function checkRevision() {
  try {
    const r = await fetch(`${detectApiBase()}/api/v1/accounts/revision`, {
      headers: authHeaders(),
    });
    if (!r.ok) return { stale: false, revision };
    const d = await r.json();
    if (typeof d.revision === "number" && d.revision > revision) {
      revision = d.revision;
      state.revision = revision;
      return { stale: true, revision, gap: state.gap };
    }
    return { stale: false, revision, gap: state.gap };
  } catch {
    return { stale: false, revision };
  }
}
