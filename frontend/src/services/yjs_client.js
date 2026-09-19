// yjs_client.js — Cliente Yjs nativo (sin y-websocket) para CRDT de notas (v2.16.0).
//
// Usa Yjs vía CDN (mismo patrón que three_d_viewer.js usa three.js). El backend
// expone un WS endpoint con el protocolo Yjs "sync-step" básico:
//   - Al conectar, el servidor envía `Y.encodeStateAsUpdate(room.doc)` (binario).
//   - El cliente envía updates binarios (= lo que devuelve `Y.encodeUpdate`).
//   - El servidor reenvía el update a todos los demás clientes del mismo room.
//
// Nota: no usamos la convención completa de y-websocket (no hay handshake
// sync-step-1/2), porque el backend solo necesita el "fire and forget" de
// updates binarios. Para la primera conexión el server manda el estado inicial.
//
// Esto es un reemplazo del CRDT casero (sync_v2.ts v2.15.0) usando el Yjs oficial
// para documentos grandes. Para documentos pequeños, el CRDT casero sigue siendo
// útil (sync_v2.ts mantiene mensajes JSON para todos los recursos no-nota).

let _Y = null;
let Y_LOADING = null;

async function loadY() {
  if (_Y) return _Y;
  if (Y_LOADING) return Y_LOADING;
  Y_LOADING = (async () => {
    const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/yjs@13.6.32/+esm");
    _Y = mod;
    return mod;
  })();
  return Y_LOADING;
}

/**
 * Connects to /api/v1/crdt/ws/:notePath and returns a Yjs client wrapper:
 *   - doc: the Yjs document (shared with the room)
 *   - close(): closes the WS
 *   - onStatus(cb): fires 'connected' / 'disconnected' / 'syncing' / 'synced'
 */
export async function connectYjsRoom(notePath, opts = {}) {
  const Y = await loadY();
  const doc = new Y.Doc();
  const wsProtocol = opts.useHttps
    ? "wss"
    : location.protocol === "https:"
    ? "wss"
    : "ws";
  const wsHost = opts.host || location.hostname;
  const wsUrl = `${wsProtocol}://${wsHost}:4100/api/v1/crdt/ws/${encodeURIComponent(notePath)}`;

  const statusListeners = new Set();
  const emit = (status) => {
    for (const l of statusListeners) l(status);
  };

  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    emit("error");
    throw new Error(`Yjs: WebSocket construct failed: ${e?.message || e}`);
  }
  ws.binaryType = "arraybuffer";

  // Buffer updates while WS is not yet open.
  const pendingUpdates = [];

  ws.addEventListener("open", () => {
    emit("syncing");
  });

  ws.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!(data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(data);
    // Yjs sync step 1 messages from server start with 0 (sync step 1)
    // and 1 (sync step 2). We accept everything as a state update.
    try {
      Y.applyUpdate(doc, bytes, "remote");
      emit("synced");
    } catch (e) {
      console.warn("[yjs_client] applyUpdate failed:", e);
    }
  });

  ws.addEventListener("close", () => emit("disconnected"));
  ws.addEventListener("error", () => emit("error"));

  // Broadcast local updates to server.
  doc.on("update", (update, origin) => {
    if (origin === "remote") return; // don't echo back
    if (ws.readyState !== WebSocket.OPEN) {
      pendingUpdates.push(update);
      return;
    }
    try {
      ws.send(update);
    } catch (e) {
      console.warn("[yjs_client] send failed:", e);
    }
  });

  // Drain pending once WS opens.
  ws.addEventListener("open", () => {
    while (pendingUpdates.length) {
      try { ws.send(pendingUpdates.shift()); } catch {}
    }
  });

  function close() {
    try { ws.close(); } catch {}
    doc.destroy();
  }
  function onStatus(cb) {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  }

  return { doc, close, onStatus, ws };
}

/** Get or create a Y.Array or Y.Text under a path on the doc. */
export function getYText(doc, name) {
  return doc.getText(name);
}
export function getYArray(doc, name) {
  return doc.getArray(name);
}
export function getYMap(doc, name) {
  return doc.getMap(name);
}

export async function isYjsAvailable() {
  try {
    await loadY();
    return true;
  } catch {
    return false;
  }
}
