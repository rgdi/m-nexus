/* ============================================================
 * sync_client.js — WebSocket client para E2E sync v2.0.6 / v2.1.3.
 *
 * Conecta a ws://localhost:4100/ws/sync y escucha broadcasts.
 * Cuando llega un cambio de otro dispositivo, lo aplica via CRDT
 * (lwwMerge o tombstone) y dispara un evento 'sync:incoming'.
 * ============================================================ */

import { lwwMerge, lwwRead, lwwWrite, tombstone, getVector, getTombstones } from "./crdt.js";

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
        if (msg.data?.clientId) {
          localStorage.setItem(CLIENT_ID_KEY, msg.data.clientId);
        }
        if (Array.isArray(msg.data?.history)) {
          for (const m of msg.data.history) fireIncoming(m);
        }
        return;
      }
      if (msg.origin === getClientId()) return;
      applyRemoteChange(msg);
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

/**
 * applyRemoteChange — uses CRDT semantics to merge.
 * - op=create/update → lwwMerge by resourceId
 * - op=delete → tombstone
 */
function applyRemoteChange(msg) {
  const key = `${msg.type}:${msg.resourceId}`;
  if (msg.op === "delete") {
    tombstone(key, msg.origin);
    return;
  }
  if (msg.data) {
    lwwMerge(key, { value: msg.data, ts: msg.ts, v: msg.v || {}, deviceId: msg.origin }, getClientId());
  }
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

/**
 * publishChange — called locally; persists with CRDT and broadcasts.
 */
export function publishChange(type, op, resourceId, data = null) {
  const cid = getClientId();
  const key = `${type}:${resourceId}`;
  if (op === "delete") {
    tombstone(key, cid);
  } else if (data) {
    lwwWrite(key, data, cid);
  }
  const msg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type, op, resourceId, data,
    origin: cid,
    ts: Date.now(),
    v: getVector(),
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
  fetch("http://localhost:4100/api/v1/sync/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  }).catch(() => {});
}
