/* ============================================================
 * graph_3d.js — Graph view 3D con backlinks [[wikilinks]] + @book/ref.
 * v2.1.5 — render con three.js (CDN) en un canvas overlay.
 * - Nodes = notes, refs (books), concepts (tags)
 * - Edges = wikilinks, bookrefs, shared tags
 * - Layout = force-directed simple (semantic heuristic)
 * - Interacción: drag con orbit camera, click node = navigate.
 * ============================================================ */

let styleMounted = false;
let activeOverlay = null;

const STYLE = `
.graph-3d-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 200;
  display: flex; flex-direction: column;
}
.graph-3d-overlay canvas { display: block; flex: 1; }
.graph-3d-toolbar {
  height: 56px; padding: 0 16px; background: var(--bg-elevated, #fff);
  display: flex; align-items: center; gap: 12px; border-top: 1px solid var(--border);
}
.graph-3d-toolbar h3 { margin: 0; font-size: 16px; }
.graph-3d-legend { color: var(--fg-muted, #666); font-size: 12px; margin-left: auto; }
.graph-3d-legend span { display: inline-block; margin-right: 12px; }
.graph-3d-legend i {
  display: inline-block; width: 10px; height: 10px;
  border-radius: 50%; margin-right: 4px; vertical-align: middle;
}
`;

/**
 * openGraph3D — abre el overlay 3D de un vault.
 */
export async function openGraph3D(notes) {
  if (!styleMounted) {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    styleMounted = true;
  }
  if (window.__THREE_LOADED__) {
    return renderGraph(notes);
  }
  // load three from CDN
  await loadThree();
  window.__THREE_LOADED__ = true;
  renderGraph(notes);
}

function loadThree() {
  return new Promise((resolve, reject) => {
    if (window.THREE) return resolve();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function renderGraph(notes) {
  const scrim = document.createElement("div");
  scrim.className = "graph-3d-overlay";
  scrim.innerHTML = `
    <canvas id="graph-canvas"></canvas>
    <div class="graph-3d-toolbar">
      <h3>🕸 3D Graph (${notes.length} notes)</h3>
      <span class="graph-3d-legend">
        <span><i style="background:#5b8def"></i>Note</span>
        <span><i style="background:#f59e0b"></i>Book ref</span>
        <span><i style="background:#10b981"></i>Tag</span>
      </span>
      <button class="btn small" data-act="close">✕ Close</button>
    </div>
  `;
  document.body.appendChild(scrim);
  activeOverlay = scrim;
  scrim.querySelector('[data-act="close"]').addEventListener("click", () => {
    if (anim) cancelAnimationFrame(anim);
    scrim.remove();
    activeOverlay = null;
  });

  // Build graph data
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  function nodeOf(id, label, type, color) {
    if (nodeMap.has(id)) return nodeMap.get(id);
    const n = { id, label, type, color, x: Math.random() * 400 - 200, y: Math.random() * 300 - 150, z: Math.random() * 300 - 150, vx: 0, vy: 0, vz: 0 };
    nodes.push(n);
    nodeMap.set(id, n);
    return n;
  }
  for (const n of notes) {
    const titleKey = `n:${n.title}`;
    const noteNode = nodeOf(titleKey, n.title || "(untitled)", "note", "#5b8def");
    // wikilinks [[X]] → edge
    const wikiMatches = (n.body || "").match(/\[\[([^\]]+)\]\]/g) || [];
    for (const wm of wikiMatches) {
      const target = wm.replace(/\[\[|\]\]/g, "");
      nodeOf(`n:${target}`, target, "note", "#5b8def");
      edges.push({ a: titleKey, b: `n:${target}`, kind: "wiki" });
    }
    // bookref @book/ref → book node
    const bookMatches = (n.body || "").match(/@([\w\-\/]+)/g) || [];
    for (const bm of bookMatches) {
      const ref = bm.slice(1);
      nodeOf(`b:${ref}`, ref, "book", "#f59e0b");
      edges.push({ a: titleKey, b: `b:${ref}`, kind: "book" });
    }
    // tags → shared tag nodes
    const tags = n.tags || [];
    for (const t of tags) {
      nodeOf(`t:${t}`, `#${t}`, "tag", "#10b981");
      edges.push({ a: titleKey, b: `t:${t}`, kind: "tag" });
    }
  }

  // Setup three.js
  const THREE = window.THREE;
  const canvas = scrim.querySelector("#graph-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight - 56);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / (window.innerHeight - 56), 0.1, 2000);
  camera.position.set(0, 0, 600);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(100, 200, 100);
  scene.add(dirLight);

  // Spheres for nodes
  const sphereGeo = new THREE.SphereGeometry(8, 16, 16);
  const nodes3d = new Map();
  for (const node of nodes) {
    const mat = new THREE.MeshBasicMaterial({ color: node.color });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.set(node.x, node.y, node.z);
    scene.add(mesh);
    nodes3d.set(node.id, mesh);
  }
  // Lines for edges
  const edgesGroup = new THREE.Group();
  scene.add(edgesGroup);
  for (const edge of edges) {
    const a = nodeMap.get(edge.a);
    const b = nodeMap.get(edge.b);
    if (!a || !b) continue;
    const mat = new THREE.LineBasicMaterial({
      color: edge.kind === "wiki" ? 0x5b8def : edge.kind === "book" ? 0xf59e0b : 0x10b981,
      opacity: 0.3, transparent: true,
    });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ]);
    edgesGroup.add(new THREE.Line(lineGeo, mat));
  }

  // Force-directed layout in update loop
  let anim = null;
  function step() {
    // Simple repulsion + attraction
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
        const force = 2500 / (dist * dist);
        a.vx += (dx / dist) * force * 0.001;
        a.vy += (dy / dist) * force * 0.001;
        a.vz += (dz / dist) * force * 0.001;
        b.vx -= (dx / dist) * force * 0.001;
        b.vy -= (dy / dist) * force * 0.001;
        b.vz -= (dz / dist) * force * 0.001;
      }
    }
    for (const e of edges) {
      const a = nodeMap.get(e.a), b = nodeMap.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
      const ideal = 120;
      const force = (dist - ideal) * 0.001;
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      a.vz += (dz / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= (dy / dist) * force;
      b.vz -= (dz / dist) * force;
    }
    for (const node of nodes) {
      node.vx *= 0.92; node.vy *= 0.92; node.vz *= 0.92;
      node.x += node.vx; node.y += node.vy; node.z += node.vz;
      const mesh = nodes3d.get(node.id);
      if (mesh) mesh.position.set(node.x, node.y, node.z);
    }
    // Rotate lines to new positions (cheap)
    edgesGroup.children = [];
    for (const edge of edges) {
      const a = nodeMap.get(edge.a);
      const b = nodeMap.get(edge.b);
      if (!a || !b) continue;
      const mat = new THREE.LineBasicMaterial({
        color: edge.kind === "wiki" ? 0x5b8def : edge.kind === "book" ? 0xf59e0b : 0x10b981,
        opacity: 0.3, transparent: true,
      });
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, a.y, a.z),
        new THREE.Vector3(b.x, b.y, b.z),
      ]);
      edgesGroup.add(new THREE.Line(lineGeo, mat));
    }
    camera.position.x = 0 + Math.sin(Date.now() * 0.0003) * 100;
    camera.position.z = 600 + Math.cos(Date.now() * 0.0003) * 100;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    anim = requestAnimationFrame(step);
  }
  step();

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight - 56);
    camera.aspect = window.innerWidth / (window.innerHeight - 56);
    camera.updateProjectionMatrix();
  });
}
