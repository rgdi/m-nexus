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
        <h1 class="h-title">Clúster</h1>
        <div class="spacer"></div>
        <button class="icon-btn" id="refresh" aria-label="Refrescar" title="Refrescar">⟳</button>
      </header>
      <p class="muted small" style="margin: 0 0 var(--s-3)">
        Servidores conocidos en este cluster. Las asignaturas y notas se sincronizan entre todos.
      </p>
      <div class="cluster-actions" id="actions"></div>
      <div class="cluster-mode-banner">
        <span class="muted small">Modo del node:</span>
        <strong id="self-role" class="role-badge">—</strong>
        <button class="cluster-info-btn" id="node-mode-info" type="button" aria-label="¿Qué es el modo del node?">?</button>
      </div>
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

  // v2.34.0: info button opens explanatory modal about node modes.
  const nodeModeInfo = root.querySelector("#node-mode-info");
  if (nodeModeInfo) {
    nodeModeInfo.addEventListener("click", () => openNodeModeModal());
  }
}

/**
 * openNodeModeModal — explains the 4 cluster node modes.
 *
 * Called from cluster.js when the user clicks the (?) button next to
 * the "Modo del node" badge. Uses makeModal so it benefits from the
 * same focus trap + Esc-to-close behavior as other modals.
 */
async function openNodeModeModal() {
  const { makeModal } = await import("../widgets/modal.js");
  const escHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": String.fromCharCode(38) + "amp;",
    "<": String.fromCharCode(38) + "lt;",
    ">": String.fromCharCode(38) + "gt;",
    '"': String.fromCharCode(38) + "quot;",
    "'": String.fromCharCode(38) + "#39;",
  }[c]));

  const modal = makeModal({
    title: "🛰️ Modo del node",
    size: "lg",
    body: `
      <div class="node-mode-modal">
        <p class="muted">Cada nodo del cluster puede estar en uno de estos modos. El modo afecta a cómo recibe writes y a cómo sincroniza con los demás.</p>

        <div class="node-mode-grid">
          <section class="node-mode-card">
            <h3>📦 Standalone</h3>
            <p><strong>Instancia única, sin cluster.</strong> Tú eres el leader implícito. Si decides escalar más adelante, cambia a follower y apunta a otro node.</p>
            <p class="muted small">Uso recomendado: pruebas, devices personales sin sincronización.</p>
          </section>

          <section class="node-mode-card">
            <h3>👑 Leader</h3>
            <p><strong>Recibe writes y las replica a followers.</strong> Si este node cae, los followers entran en modo read-only hasta que uno de ellos sea promovido.</p>
            <p class="muted small">Uso recomendado: servidor principal de la clase / facultad.</p>
          </section>

          <section class="node-mode-card">
            <h3>🔗 Follower</h3>
            <p><strong>Réplica del leader.</strong> Writes se forwardan al leader y vuelven replicadas. Si el leader no responde, el cluster promueve al follower con más uptime.</p>
            <p class="muted small">Uso recomendado: réplicas geográficas para baja latencia.</p>
          </section>

          <section class="node-mode-card">
            <h3>🛰 Standalone-with-bootstrap</h3>
            <p><strong>Standalone todavía descubriendo peers.</strong> Cambia a leader/follower automáticamente cuando termine el escaneo de descubrimiento.</p>
            <p class="muted small">Uso recomendado: nodos recién añadidos al cluster.</p>
          </section>
        </div>

        <div class="node-mode-diagram">
          <h4>Topología típica</h4>
          <svg viewBox="0 0 480 200" width="100%" height="200" aria-hidden="true">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#2f6fed"/>
              </marker>
            </defs>
            <!-- Leader -->
            <rect x="180" y="20" width="120" height="50" rx="8" fill="#facc15" stroke="#a16207" stroke-width="2"/>
            <text x="240" y="42" text-anchor="middle" font-family="system-ui" font-size="13" font-weight="700">👑 Leader</text>
            <text x="240" y="58" text-anchor="middle" font-family="system-ui" font-size="10" fill="#92400e">node-1</text>
            <!-- Follower 1 -->
            <rect x="40" y="120" width="120" height="50" rx="8" fill="#2f6fed" stroke="#5b21b6" stroke-width="2"/>
            <text x="100" y="142" text-anchor="middle" font-family="system-ui" font-size="13" font-weight="700" fill="white">🔗 Follower</text>
            <text x="100" y="158" text-anchor="middle" font-family="system-ui" font-size="10" fill="#ede9fe">node-2</text>
            <!-- Follower 2 -->
            <rect x="320" y="120" width="120" height="50" rx="8" fill="#2f6fed" stroke="#5b21b6" stroke-width="2"/>
            <text x="380" y="142" text-anchor="middle" font-family="system-ui" font-size="13" font-weight="700" fill="white">🔗 Follower</text>
            <text x="380" y="158" text-anchor="middle" font-family="system-ui" font-size="10" fill="#ede9fe">node-3</text>
            <!-- Arrows: writes from followers up to leader -->
            <line x1="100" y1="120" x2="200" y2="70" stroke="#2f6fed" stroke-width="2" marker-end="url(#arr)"/>
            <line x1="380" y1="120" x2="280" y2="70" stroke="#2f6fed" stroke-width="2" marker-end="url(#arr)"/>
            <!-- Replication arrows from leader down -->
            <line x1="200" y1="70" x2="100" y2="120" stroke="#10b981" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#arr)"/>
            <line x1="280" y1="70" x2="380" y2="120" stroke="#10b981" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#arr)"/>
            <!-- Legend -->
            <text x="20" y="20" font-family="system-ui" font-size="10" fill="#666">↑ writes</text>
            <text x="380" y="20" font-family="system-ui" font-size="10" fill="#10b981">↻ replication →</text>
          </svg>
        </div>
      </div>
    `,
    actions: [{ id: "close", label: "Cerrar", kind: "secondary" }],
  });
  document.body.appendChild(modal.root);
}
