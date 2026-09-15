/* ============================================================
 * sync_client.js — WebSocket client para E2E sync v2.0.6.
 *
 * Conecta a ws://localhost:4100/ws/sync y escucha broadcasts.
 * Cuando llega un cambio de otro dispositivo, actualiza el cache
 * local y dispara un evento 'sync:incoming' para que las screens
 * se refresquen.
 * ============================================================ */

const CLIENT_ID_KEY = "mnexus.sync.clientId";

let ws = null;
let reconnectTimer = null;
const listeners = new Set();

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function connectSync() {
  if (ws && ws.readyState !== WebSocket.CLOSED) return ws;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.hostname;
  const url = `${proto}//${host}:4100/ws/sync`;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleReconnect();
    return null;
  }
  ws.onopen = () => {
    console.log("[sync] connected:", url);
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.resourceId === "hello") {
        // initial hello from server — store clientId
        if (msg.data?.clientId) {
          localStorage.setItem(CLIENT_ID_KEY, msg.data.clientId);
        }
        // hydrate from history
        if (Array.isArray(msg.data?.history)) {
          for (const m of msg.data.history) fireIncoming(m);
        }
        return;
      }
      // ignore our own messages (origin match)
      if (msg.origin === getClientId()) return;
      fireIncoming(msg);
    } catch {}
  };
  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    if (ws) ws.close();
  };
  return ws;
}

function fireIncoming(msg) {
  for (const l of listeners) l(msg);
  document.dispatchEvent(new CustomEvent("sync:incoming", { detail: msg }));
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectSync, 3000);
}

export function onSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publishChange(type, op, resourceId, data = null) {
  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type, op, resourceId, data,
    origin: getClientId(),
    ts: Date.now(),
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
  // also publish via REST (server will broadcast)
  fetch("http://localhost:4100/api/v1/sync/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  }).catch(() => {});
}
