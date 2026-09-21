// screens/cluster.js — admin view for multi-server cluster.
//
// v2.23.3: shows live peer list with region, role, version, uptime.
// Lets the admin promote/demote this node and force a heartbeat.
//
// Mounted from main.js when location.hash === "#/cluster".

import { connectCluster, onClusterPeers, getCurrentPeer } from "../services/cluster_client.js";

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function roleBadge(role) {
  if (role === "leader") return `<span class="role-badge role-leader">leader</span>`;
  return `<span class="role-badge role-worker">worker</span>`;
}

function peerRow(peer, isSelf) {
  const lastSeen = new Date(peer.lastSeen).toLocaleString();
  const age = Math.max(0, Math.floor((Date.now() - peer.lastSeen) / 1000));
  // Singletons: backend returns lastSeen = startedAt (no heartbeat), so
  // we can't rely on age alone. If the only peer is self, status is alive
  // and age is treated as uptime.
  const totalPeers = (window.MNEXUS_PEERS || []).length;
  const statusClass = totalPeers === 1 && isSelf
    ? "alive"
    : (age > 60 ? "dead" : age > 30 ? "stale" : "alive");
  const ageLabel = totalPeers === 1 && isSelf ? "uptime" : "since";
  return `
    <div class="cluster-peer ${isSelf ? "is-self" : ""}" data-id="${escapeHtml(peer.id)}">
      <div class="cp-id">
        <code>${escapeHtml(peer.id)}</code>
        ${isSelf ? `<span class="role-badge self">este nodo</span>` : ""}
      </div>
      <div class="cp-meta">
        <span>${escapeHtml(peer.host)}:${peer.port}</span>
        <span>${escapeHtml(peer.region)}</span>
        ${roleBadge(peer.role)}
        <span>v${escapeHtml(peer.version)}</span>
      </div>
      <div class="cp-cap">
        ${(peer.capabilities || []).map((c) => `<span class="cap-pill">${escapeHtml(c)}</span>`).join(" ")}
      </div>
      <div class="cp-health status-${statusClass}" title="Última vez visto: ${lastSeen}">
        ${statusClass === "alive" ? "● en línea" : statusClass === "stale" ? "⏳ degradado" : "✗ sin respuesta"}
        · ${ageLabel} ${age}s
      </div>
    </div>
  `;
}

export async function renderCluster(root) {
  connectCluster();
  const selfId = getCurrentPeer()?.id;

  root.innerHTML = `
    <div class="screen cluster-screen">
      <header class="screen-header">
        <button class="icon-btn" id="back" aria-label="Volver">←</button>
        <h1 class="h-title">Cluster</h1>
        <div class="spacer"></div>
        <button class="icon-btn" id="refresh" aria-label="Refrescar" title="Refrescar">⟳</button>
      </header>
      <p class="muted small" style="margin: 0 0 var(--s-3)">
        Servidores conocidos en este cluster. Las asignaturas y notas se sincronizan entre todos.
      </p>
      <div class="cluster-actions" id="actions"></div>
      <div class="cluster-list" id="peer-list" aria-live="polite">
        Cargando…
      </div>
    </div>
  `;

  $("#back").addEventListener("click", () => { location.hash = ""; });

  function rerender(payload) {
    const list = $("#peer-list");
    if (!payload.peers || payload.peers.length === 0) {
      list.innerHTML = `<p class="muted center">Sin peers conocidos. Esta instancia es el único nodo del cluster.</p>`;
      return;
    }
    const sorted = [...payload.peers].sort((a, b) => (a.id === selfId ? -1 : a.host.localeCompare(b.host)));
    list.innerHTML = sorted.map((p) => peerRow(p, p.id === selfId)).join("");
    list.setAttribute("aria-busy", payload.stale ? "true" : "false");
  }

  onClusterPeers(rerender);

  $("#refresh").addEventListener("click", () => {
    $("#peer-list").innerHTML = `<p class="muted center">Recargando…</p>`;
    // Trigger an immediate poll by reconnecting the cluster (cheap).
    import("../services/cluster_client.js").then((m) => {
      m.connectCluster();
    });
  });
}
