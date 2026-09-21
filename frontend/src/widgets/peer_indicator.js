// widgets/peer_indicator.js — small pill in the top-right showing
// which node answered. Click to expand.
//
// v2.23.3: green = current node, yellow = fallback, red = all peers down.

import { connectCluster, onClusterPeers, getCurrentPeer, getPeerByRegion } from "../services/cluster_client.js";

const COLORS = {
  alive: "#1d7d54",
  stale: "#c26612",
  dead: "#c83e30",
  unknown: "#6f7682",
};

function makePill(node) {
  const pill = document.createElement("button");
  pill.className = "peer-pill";
  pill.setAttribute("aria-label", "Estado del servidor");
  pill.setAttribute("aria-expanded", "false");
  const dot = document.createElement("span");
  dot.className = "peer-dot";
  const text = document.createElement("span");
  text.className = "peer-text";
  pill.appendChild(dot);
  pill.appendChild(text);
  return { pill, dot, text };
}

let mounted = false;
let pillEls = null;
let overlayEls = null;

function setState({ peers, stale, error }) {
  if (!pillEls) return;
  const self = getCurrentPeer() || (peers && peers[0]);
  let color = COLORS.unknown;
  let text = "·";
  if (error && (!peers || peers.length === 0)) {
    color = COLORS.dead;
    text = "offline";
  } else if (self) {
    if (stale) {
      color = COLORS.stale;
      text = `${self.host} degradado`;
    } else {
      color = COLORS.alive;
      text = `${self.region} · ${self.host}:${self.port}`;
    }
  }
  pillEls.dot.style.background = color;
  pillEls.text.textContent = text;
}

function renderOverlay(peers) {
  if (!overlayEls) return;
  const self = peers[0];
  const others = peers.slice(1);
  overlayEls.list.innerHTML = peers.map((p) => {
    const isSelf = p === self;
    const age = Math.max(0, Math.floor((Date.now() - p.lastSeen) / 1000));
    const status = age > 60 ? "down" : age > 30 ? "warn" : "ok";
    return `
      <li class="cluster-item status-${status}">
        <span class="ci-dot" aria-hidden="true"></span>
        <div class="ci-body">
          <div class="ci-title">${isSelf ? "✓ " : ""}${escape(p.host)}:${p.port}</div>
          <div class="ci-sub">${escape(p.region)} · v${escape(p.version)} · role ${escape(p.role)}</div>
        </div>
      </li>
    `;
  }).join("");
}

function escape(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

export function mountPeerIndicator() {
  if (mounted) return;
  mounted = true;
  connectCluster();

  const root = document.body;
  const { pill, dot, text } = makePill();
  const overlay = document.createElement("div");
  overlay.className = "peer-overlay";
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-label", "Cluster de servidores");
  overlay.innerHTML = `
    <header class="po-head">
      <strong>Servidor actual</strong>
      <button class="icon-btn" id="po-close" aria-label="Cerrar">✕</button>
    </header>
    <ul class="cluster-list-mini" id="po-list"></ul>
    <footer class="po-foot muted">
      <a href="#/cluster" id="po-manage">Administrar cluster →</a>
    </footer>
  `;
  root.appendChild(pill);
  root.appendChild(overlay);
  pillEls = { pill, dot, text, overlay };
  overlayEls = { overlay, list: overlay.querySelector("#po-list") };

  pill.addEventListener("click", () => {
    const open = overlay.classList.toggle("open");
    pill.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && window.MNEXUS_PEERS) renderOverlay(window.MNEXUS_PEERS);
  });
  overlay.querySelector("#po-close").addEventListener("click", () => {
    overlay.classList.remove("open");
    pill.setAttribute("aria-expanded", "false");
  });
  overlay.querySelector("#po-manage").addEventListener("click", () => {
    overlay.classList.remove("open");
    pill.setAttribute("aria-expanded", "false");
  });
  // ESC closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) {
      overlay.classList.remove("open");
      pill.setAttribute("aria-expanded", "false");
    }
  });
  // Click outside closes
  document.addEventListener("click", (e) => {
    if (!overlay.contains(e.target) && !pill.contains(e.target) && overlay.classList.contains("open")) {
      overlay.classList.remove("open");
      pill.setAttribute("aria-expanded", "false");
    }
  });

  onClusterPeers((data) => {
    setState(data);
    if (overlay.classList.contains("open")) renderOverlay(data.peers);
  });
}
