/* ============================================================
 * cluster_client.js — multi-server peer registry client.
 *
 * v2.23.3: poll /api/v1/cluster/peers every 15 s, expose
 * window.MNEXUS_PEERS for the UI + emit 'cluster:peers' events.
 *
 * Single-node default: backend returns just [self], so the
 * indicator is still useful (it confirms which node answered).
 *
 * v2.23.3 bugfix: use detectApiBase() so that origin-less requests
 * route to the backend at :4100 (not to the static frontend).
 * ============================================================ */

import { detectApiBase } from "./api_base.js";

const POLL_INTERVAL = 15000;

let timerId = null;
let lastPeers = [];
const subscribers = new Set();

async function fetchPeers() {
  try {
    const auth = (window.MNEXUS_AUTH || {}).getAccessToken?.();
    const headers = auth ? { Authorization: `Bearer ${auth}` } : {};
    const base = detectApiBase();
    const r = await fetch(`${base}/api/v1/cluster/peers`, { headers, cache: "no-store" });
    if (!r.ok) throw new Error(`peers ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.peers)) throw new Error("peers shape");
    return j.peers;
  } catch (e) {
    if (lastPeers.length > 0) {
      for (const fn of subscribers) fn({ peers: lastPeers, stale: true, error: e.message });
    } else {
      for (const fn of subscribers) fn({ peers: [], stale: true, error: e.message });
    }
    return null;
  }
}

async function tick() {
  const peers = await fetchPeers();
  if (!peers) return;
  lastPeers = peers;
  window.MNEXUS_PEERS = peers;
  for (const fn of subscribers) fn({ peers, stale: false, error: null });
}

export function connectCluster() {
  if (timerId) return;
  tick();
  timerId = setInterval(tick, POLL_INTERVAL);
}

export function disconnectCluster() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

export function getCurrentPeer() {
  return lastPeers[0] ?? null;
}

export function getPeerByRegion(region) {
  return lastPeers.find((p) => p.region === region) ?? null;
}

export function onClusterPeers(fn) {
  subscribers.add(fn);
  if (lastPeers.length > 0) {
    try { fn({ peers: lastPeers, stale: false, error: null }); } catch {}
  }
  return () => subscribers.delete(fn);
}
