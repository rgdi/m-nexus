/* ============================================================
 * widgets/kg_graph.js — Knowledge Graph visualization.
 *
 * v2.31.0 — Canvas-based force-directed graph (no external libs).
 *   - Nodos: tamaño proporcional al weight, color por community
 *   - Edges: grosor proporcional al co-occurrence weight
 *   - Drag-to-pan, click node → details panel + neighbours
 *   - Hover tooltip with label + freq
 *   - Search box + rebuild button
 *
 * Stack: vanilla canvas + requestAnimationFrame.
 * ============================================================ */

const API_GRAPH = "/api/v1/kg/graph";
const API_REBUILD = "/api/v1/kg/rebuild";
const API_NEIGHBOURS = "/api/v1/kg/neighbours";
const API_COMMUNITIES = "/api/v1/kg/communities";
const API_SEARCH = "/api/v1/kg/search";

const PALETTE = [
  "#667eea", "#764ba2", "#f093fb", "#4facfe", "#43e97b",
  "#fa709a", "#fee140", "#30cfd0", "#a8edea", "#ff9a9e",
  "#ffecd2", "#fcb69f", "#ff6e7f", "#bfe9ff", "#c2e59c",
];

function hashColor(community) {
  return PALETTE[community % PALETTE.length];
}

/**
 * Mount the KG graph widget into a host element.
 * Returns { refresh, destroy, focusNode }.
 */
export function mountKgGraph(host, opts = {}) {
  const onSelect = opts.onSelect ?? (() => {});

  host.innerHTML = `
    <section class="kg-graph" aria-labelledby="kg-title">
      <header class="kg-header">
        <h2 id="kg-title">🕸️ Knowledge Graph</h2>
        <div class="kg-toolbar">
          <input class="kg-search" type="search" placeholder="Buscar entidad…" aria-label="Buscar entidad">
          <button class="kg-btn" data-action="rebuild" type="button">🔄 Reconstruir</button>
        </div>
      </header>

      <div class="kg-stats">
        <span data-stat="nodes">0 nodos</span>
        <span data-stat="edges">0 aristas</span>
        <span data-stat="communities">0 comunidades</span>
        <span data-stat="docs">0 documentos</span>
      </div>

      <div class="kg-canvas-wrap">
        <canvas class="kg-canvas" data-canvas aria-label="Visualización del grafo de conocimiento"></canvas>
        <div class="kg-tooltip" data-tooltip role="tooltip" hidden></div>
      </div>

      <aside class="kg-detail" data-detail aria-live="polite">
        <p class="kg-empty">Selecciona un nodo para ver detalles y entidades vecinas.</p>
      </aside>
    </section>
  `;

  const canvas = host.querySelector("[data-canvas]");
  const ctx = canvas.getContext("2d");
  const tooltip = host.querySelector("[data-tooltip]");
  const detail = host.querySelector("[data-detail]");
  const searchInput = host.querySelector(".kg-search");
  const statNodes = host.querySelector("[data-stat='nodes']");
  const statEdges = host.querySelector("[data-stat='edges']");
  const statCommunities = host.querySelector("[data-stat='communities']");
  const statDocs = host.querySelector("[data-stat='docs']");
  const rebuildBtn = host.querySelector('[data-action="rebuild"]');

  let graph = { nodes: [], edges: [], documents: [], totalDocs: 0 };
  let positions = new Map();
  let velocities = new Map();
  let selectedId = null;
  let hoveredId = null;
  let scale = 1;
  let pan = { x: 0, y: 0 };
  let drag = null; // { kind: 'pan'|'node', startX, startY, nodeId? }
  let width = 800;
  let height = 500;
  let rafId = null;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(320, rect.width);
    height = Math.max(360, rect.height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function layoutInit() {
    positions.clear();
    velocities.clear();
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const angle = (i / graph.nodes.length) * Math.PI * 2;
      const radius = 120 + Math.random() * 80;
      positions.set(n.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
      velocities.set(n.id, { x: 0, y: 0 });
    }
  }

  function step() {
    if (graph.nodes.length === 0) {
      draw();
      return;
    }
    const cx = width / 2;
    const cy = height / 2;
    // Repulsion (Coulomb-like)
    for (let i = 0; i < graph.nodes.length; i++) {
      const a = graph.nodes[i];
      const pa = positions.get(a.id);
      let fx = 0, fy = 0;
      for (let j = 0; j < graph.nodes.length; j++) {
        if (i === j) continue;
        const b = graph.nodes[j];
        const pb = positions.get(b.id);
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = Math.max(50, dx * dx + dy * dy);
        const f = 800 / d2;
        fx += (dx / Math.sqrt(d2)) * f;
        fy += (dy / Math.sqrt(d2)) * f;
      }
      // Attraction along edges (Hooke-like)
      for (const e of graph.edges) {
        let other;
        if (e.source === a.id) other = e.target;
        else if (e.target === a.id) other = e.source;
        else continue;
        const po = positions.get(other);
        if (!po) continue;
        const dx = po.x - pa.x;
        const dy = po.y - pa.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 60 + e.weight * 20;
        const k = 0.05;
        fx += (dx / d) * (d - target) * k;
        fy += (dy / d) * (d - target) * k;
      }
      // Gravity toward center
      fx += (cx - pa.x) * 0.002;
      fy += (cy - pa.y) * 0.002;

      const v = velocities.get(a.id);
      v.x = (v.x + fx * 0.5) * 0.85; // damping
      v.y = (v.y + fy * 0.5) * 0.85;
      if (drag?.kind === "node" && drag.nodeId === a.id) {
        v.x = 0;
        v.y = 0;
      }
    }
    for (const n of graph.nodes) {
      const p = positions.get(n.id);
      const v = velocities.get(n.id);
      if (drag?.kind === "node" && drag.nodeId === n.id) continue;
      p.x += v.x;
      p.y += v.y;
      p.x = Math.max(20, Math.min(width - 20, p.x));
      p.y = Math.max(20, Math.min(height - 20, p.y));
    }
    draw();
    rafId = requestAnimationFrame(step);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    // Pan + scale
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    // Edges
    for (const e of graph.edges) {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) continue;
      const isHighlighted = selectedId && (e.source === selectedId || e.target === selectedId);
      ctx.lineWidth = Math.min(4, 0.5 + e.weight * 0.8) / scale;
      ctx.strokeStyle = isHighlighted
        ? "rgba(102, 234, 132, 0.9)"
        : "rgba(120, 120, 120, 0.25)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Nodes
    for (const n of graph.nodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      const r = nodeRadius(n);
      const isHovered = hoveredId === n.id;
      const isSelected = selectedId === n.id;
      const color = hashColor(n.community);
      // Halo for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }
      // Body
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHovered || isSelected ? color : `${color}cc`;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
      // Label
      ctx.fillStyle = "#1a1a1a";
      ctx.font = `${Math.max(10, 10 / scale)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(n.label.slice(0, 18), p.x, p.y + r + 3);
    }

    ctx.restore();
  }

  function nodeRadius(n) {
    return 4 + Math.min(20, Math.log2(1 + n.weight));
  }

  function hitNode(x, y) {
    // Reverse pan + scale
    const lx = (x - pan.x) / scale;
    const ly = (y - pan.y) / scale;
    for (const n of graph.nodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      const dx = lx - p.x;
      const dy = ly - p.y;
      const r = nodeRadius(n);
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  // ===== Events =====
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (drag) {
      if (drag.kind === "pan") {
        pan.x += e.movementX;
        pan.y += e.movementY;
      } else if (drag.kind === "node") {
        const p = positions.get(drag.nodeId);
        if (p) {
          p.x = (x - pan.x) / scale;
          p.y = (y - pan.y) / scale;
        }
      }
      return;
    }
    const hit = hitNode(x, y);
    hoveredId = hit?.id ?? null;
    if (hit) {
      tooltip.hidden = false;
      tooltip.style.left = `${e.clientX - rect.left + 12}px`;
      tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      tooltip.innerHTML = `<strong>${escapeHtml(hit.label)}</strong><br><span class="kg-tip-meta">freq ${hit.freq} · community ${hit.community} · weight ${hit.weight}</span>`;
    } else {
      tooltip.hidden = true;
    }
  }

  function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitNode(x, y);
    if (hit) {
      drag = { kind: "node", nodeId: hit.id, startX: x, startY: y };
      selectNode(hit.id);
    } else {
      drag = { kind: "pan", startX: x, startY: y };
    }
  }

  function onMouseUp() {
    drag = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(3, scale * delta));
    pan.x = x - (x - pan.x) * (newScale / scale);
    pan.y = y - (y - pan.y) * (newScale / scale);
    scale = newScale;
  }

  function onClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitNode(x, y);
    if (hit) selectNode(hit.id);
  }

  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onClick);

  async function selectNode(id) {
    selectedId = id;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    onSelect(node);
    detail.innerHTML = `
      <h3>${escapeHtml(node.label)}</h3>
      <dl class="kg-detail-meta">
        <dt>Frecuencia</dt><dd>${node.freq}</dd>
        <dt>Weight</dt><dd>${node.weight}</dd>
        <dt>Comunidad</dt><dd>#${node.community}</dd>
      </dl>
      <p class="kg-detail-loading">Cargando vecinos…</p>
    `;
    try {
      const r = await fetch(`${API_NEIGHBOURS}/${encodeURIComponent(id)}?hops=1`);
      const sub = await r.json();
      const connected = sub.edges
        .map((e) => e.source === id ? graph.nodes.find((n) => n.id === e.target) : graph.nodes.find((n) => n.id === e.source))
        .filter(Boolean)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 10);
      detail.innerHTML = `
        <h3>${escapeHtml(node.label)}</h3>
        <dl class="kg-detail-meta">
          <dt>Frecuencia</dt><dd>${node.freq}</dd>
          <dt>Weight</dt><dd>${node.weight}</dd>
          <dt>Comunidad</dt><dd>#${node.community}</dd>
        </dl>
        <h4>Conectado con (${connected.length})</h4>
        <ul class="kg-detail-list">
          ${connected.map((c) => `<li><span class="kg-detail-dot" style="background:${hashColor(c.community)}"></span>${escapeHtml(c.label)} <small>(w=${c.weight})</small></li>`).join("")}
        </ul>
      `;
    } catch (err) {
      detail.innerHTML = `<p class="kg-error">Error: ${escapeHtml(err.message)}</p>`;
    }
  }

  // ===== Search =====
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) return;
    searchTimer = setTimeout(async () => {
      try {
        const r = await fetch(`${API_SEARCH}?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        if (data.results.length > 0) {
          // Focus on the top result
          selectNode(data.results[0].id);
        }
      } catch (e) {
        // ignore
      }
    }, 200);
  });

  rebuildBtn.addEventListener("click", async () => {
    rebuildBtn.disabled = true;
    rebuildBtn.textContent = "⏳ Construyendo…";
    try {
      const r = await fetch(API_REBUILD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docs: SAMPLE_CORPUS,
          minFreq: 1,
          maxNgram: 2,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error("rebuild failed");
      await refresh();
    } catch (e) {
      showToast(`❌ Error: ${e.message}`, true);
    } finally {
      rebuildBtn.disabled = false;
      rebuildBtn.textContent = "🔄 Reconstruir";
    }
  });

  async function refresh() {
    try {
      const r = await fetch(API_GRAPH);
      graph = await r.json();
      statNodes.textContent = `${graph.nodes.length} nodos`;
      statEdges.textContent = `${graph.edges.length} aristas`;
      statDocs.textContent = `${graph.totalDocs ?? graph.documents.length} documentos`;
      const cR = await fetch(API_COMMUNITIES);
      const cData = await cR.json();
      statCommunities.textContent = `${cData.communities?.length ?? 0} comunidades`;
      layoutInit();
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  resize();
  refresh();
  rafId = requestAnimationFrame(step);

  return {
    refresh,
    destroy() {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("click", onClick);
      host.innerHTML = "";
    },
    focusNode: selectNode,
  };
}

const SAMPLE_CORPUS = [
  { id: "n1", type: "note", title: "Corazón", text: "El corazón es un músculo que bombea sangre. La aorta sale del ventrículo izquierdo y lleva sangre oxigenada al cuerpo. La arteria pulmonar lleva sangre desoxigenada a los pulmones. Las válvulas tricúspide y mitral controlan el flujo." },
  { id: "n2", type: "note", title: "Aparato respiratorio", text: "Los pulmones reciben sangre de la arteria pulmonar. El intercambio gaseoso ocurre en los alvéolos. La tráquea se ramifica en bronquios y bronquiolos. El diafragma es el músculo principal de la inspiración." },
  { id: "n3", type: "note", title: "Sistema nervioso", text: "El cerebro controla el cuerpo. El cerebelo coordina el equilibrio. El bulbo raquídeo regula la respiración y el ritmo cardíaco. Las neuronas se comunican mediante sinapsis y neurotransmisores." },
  { id: "n4", type: "note", title: "Riñón", text: "El riñón filtra la sangre y produce orina. La nefrona es la unidad funcional del riñón. Los túbulos renales reabsorben agua y electrolitos." },
  { id: "c1", type: "card", text: "¿Qué estructura lleva sangre del ventrículo izquierdo al cuerpo? La aorta" },
  { id: "c2", type: "card", text: "¿Dónde ocurre el intercambio gaseoso? En los alvéolos pulmonares" },
  { id: "c3", type: "card", text: "¿Cuál es la unidad funcional del riñón? La nefrona" },
  { id: "j1", type: "journal", text: "Hoy estudié anatomía del corazón y aparato respiratorio. La aorta y la arteria pulmonar son grandes vasos. Los alvéolos son fundamentales para la respiración." },
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".kg-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "kg-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("kg-toast--error", isError);
  t.textContent = msg;
  t.classList.add("kg-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("kg-toast--show"), 2500);
}
