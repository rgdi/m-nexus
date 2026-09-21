/* ============================================================
 * three_d_viewer.js — visor 3D con hotspots/billboard/callouts.
 * v1.5.3 — replica el comportamiento de un visor 3D genérico (GLB viewer).
 *
 * Técnicas implementadas:
 *  - Screen-space projection: 3D→2D en cada frame
 *  - Billboard: el label siempre mira al usuario
 *  - Callouts: líneas guía dinámicas que conectan pin↔label
 *
 * Si three.js falla o no está disponible, fallback a placeholder 2D.
 * ============================================================ */

const HOTSPOT_STYLE = `
.three-d-viewer {
  position: fixed !important;
  top: 10vh !important;
  left: 10vw !important;
  width: 80vw !important;
  height: 70vh;
  max-width: 1200px;
  z-index: 220 !important;
  border: 2px solid #555;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  background: linear-gradient(135deg, #1a2030, #0d1117);
  border-radius: 12px;
  overflow: hidden;
  cursor: grab;
}
.three-d-viewer:active { cursor: grabbing; }
.three-d-canvas { width: 100%; height: 100%; display: block; }
.three-d-overlay { position: absolute; inset: 0; pointer-events: none; }
.three-d-hotspot {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}
.three-d-hotspot .pin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent, #5a67d8);
  border: 2px solid white;
  box-shadow: 0 0 0 4px rgba(90,103,216,0.3);
  transition: transform 200ms;
}
.three-d-hotspot:hover .pin { transform: scale(1.4); }
.three-d-hotspot .callout {
  position: absolute;
  left: 20px;
  top: -10px;
  background: rgba(15,17,21,0.9);
  color: white;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.three-d-hotspot .line {
  position: absolute;
  left: 8px;
  top: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, white, transparent);
  pointer-events: none;
}
/* v2.6.0: bottom hint + close button (no more rotL/rotR/reset — drag does it) */
.three-d-hint {
  position: absolute;
  bottom: 12px;
  left: 12px;
  padding: 6px 12px;
  background: rgba(15,17,21,0.75);
  color: rgba(255,255,255,0.7);
  font-size: 12px;
  border-radius: 8px;
  pointer-events: none;
  backdrop-filter: blur(8px);
}
.three-d-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(15,17,21,0.85);
  color: white;
  border: 1px solid rgba(255,255,255,0.15);
  font-size: 18px;
  cursor: pointer;
  z-index: 10;
  backdrop-filter: blur(8px);
  transition: background 150ms;
}
.three-d-close:hover { background: rgba(40,44,52,0.95); }
.three-d-controls { display: none !important; } /* v2.6.0: removed — drag does the rotation */
.three-d-no-three {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.7);
  flex-direction: column;
  gap: 8px;
}
`;

/**
 * open3DViewer — abre un visor 3D dentro del contenedor root.
 * @param root HTMLElement donde insertar el visor
 * @param hotspots Array<{ id, x, y, z, label }>
 * @param modelType 'cube' | 'sphere' | 'bone' (sin assets externos)
 */
export async function open3DViewer(rootOrOpts, hotspotsArg, modelType = "bone") {
  // Support both signatures: (root, hotspots) and (opts) for backwards compat
  let root, hotspots, onHotspotClick;
  if (rootOrOpts && rootOrOpts.nodeType === 1) {
    root = rootOrOpts;
    hotspots = hotspotsArg || [];
  } else {
    const opts = rootOrOpts || {};
    root = opts.root || document.body;
    hotspots = opts.hotspots || [];
    onHotspotClick = opts.onHotspotClick;
    modelType = opts.modelType || modelType;
  }
  if (!document.getElementById("three-d-viewer-styles")) {
    const style = document.createElement("style");
    style.id = "three-d-viewer-styles";
    style.textContent = HOTSPOT_STYLE;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  container.className = "three-d-viewer";
  container.innerHTML = `
    <canvas class="three-d-canvas"></canvas>
    <div class="three-d-overlay"></div>
    <div class="three-d-hint">Drag to rotate · Long-press to add label</div>
    <button class="three-d-close" data-act="close" title="Close">✕</button>
  `;
  root.appendChild(container);

  // Cargar three.js dinámicamente (CDN fallback, sin npm install)
  let THREE;
  try {
    THREE = await loadThree();
  } catch {
    container.innerHTML = `<div class="three-d-no-three">
      <div style="font-size: 48px">📦</div>
      <div>3D viewer (three.js no disponible)</div>
    </div>`;
    return;
  }

  const canvas = container.querySelector(".three-d-canvas");
  const overlay = container.querySelector(".three-d-overlay");
  const rect = () => container.getBoundingClientRect();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(rect().width, rect().height);
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, rect().width / rect().height, 0.1, 1000);
  camera.position.set(0, 0, 5);

  // Modelo: primitiva (sin assets externos)
  let model;
  // v2.10.0: support GLB/GLTF loading via modelUrl.
  // Falls back to procedural geometry if no URL provided.
  if (modelType && typeof modelType === "object" && modelType.url) {
    try {
      const { GLTFLoader } = await import(
        "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js"
      ).catch(() => ({}));
      if (GLTFLoader && GLTFLoader.GLTFLoader) {
        const loader = new GLTFLoader.GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
          loader.load(
            modelType.url,
            (g) => resolve(g),
            undefined,
            (e) => reject(e),
          );
        });
        model = gltf.scene;
        // Auto-center & scale
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2.5 / maxDim;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
      } else {
        throw new Error("GLTFLoader not available");
      }
    } catch (e) {
      console.warn("[3d] GLB load failed, falling back to procedural:", e?.message || e);
      model = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshPhongMaterial({ color: 0xef4444, shininess: 80 }),
      );
    }
  } else if (modelType === "cube") {
    model = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshPhongMaterial({ color: 0x8c5cf6, shininess: 80 }),
    );
  } else if (modelType === "sphere") {
    model = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 64, 64),
      new THREE.MeshPhongMaterial({ color: 0x56c4e6, shininess: 100 }),
    );
  } else if (typeof modelType === "string" && modelType.endsWith(".glb")) {
    // Legacy: modelType passed as URL string
    try {
      const { GLTFLoader } = await import(
        "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js"
      ).catch(() => ({}));
      if (GLTFLoader && GLTFLoader.GLTFLoader) {
        const loader = new GLTFLoader.GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
          loader.load(modelType, resolve, undefined, reject);
        });
        model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2.5 / maxDim;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
      } else {
        throw new Error("GLTFLoader not available");
      }
    } catch (e) {
      console.warn("[3d] GLB load failed, falling back:", e?.message || e);
      model = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshPhongMaterial({ color: 0xef4444, shininess: 80 }),
      );
    }
  } else {
    // "bone" — cilindro estilizado
    model = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 2.5, 16),
      new THREE.MeshPhongMaterial({ color: 0xf5e6d3, shininess: 30 }),
    );
  }
  scene.add(model);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 3, 3);
  scene.add(dirLight);

  // Estado rotación
  let rotY = 0;
  let rotX = 0;
  let drag = null;
  let longPressTimer = null;
  let longPressTriggered = false;
  const LONG_PRESS_MS = 500;

  // v2.6.0: touch/mouse interactions — drag to rotate, long-press to add label
  canvas.addEventListener("pointerdown", (e) => {
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      addLabelAt(e.clientX, e.clientY);
    }, LONG_PRESS_MS);
    drag = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    // If moved more than 8px, cancel long-press (it's a drag, not a tap)
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 8) {
      clearTimeout(longPressTimer);
      rotY = drag.ry + dx * 0.01;
      rotX = Math.max(-1.2, Math.min(1.2, drag.rx - dy * 0.01));
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    clearTimeout(longPressTimer);
    if (!longPressTriggered && drag) {
      // Treat as click — nothing happens unless they long-pressed
    }
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => {
    clearTimeout(longPressTimer);
    drag = null;
  });

  // Close button
  container.querySelector('[data-act="close"]').addEventListener("click", () => {
    container.remove();
  });

  // v2.6.0: add hotspot by tapping on the model.
  // Uses raycaster against the model, then converts world point to local coords.
  // If the tap misses the model (background), we use the screen ray against a plane
  // through the model center (fallback so labels can still be placed).
  const raycaster = new THREE.Raycaster();
  const localPoint = new THREE.Vector3();

  function screenToModel(x, y) {
    const r = rect();
    const ndcX = ((x - r.left) / r.width) * 2 - 1;
    const ndcY = -((y - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    // First try: hit the actual model
    const hits = raycaster.intersectObject(model, false);
    if (hits.length > 0) {
      const world = hits[0].point.clone();
      model.worldToLocal(world);
      return world;
    }
    // Fallback: intersect with a plane perpendicular to camera at the model center
    const plane = new THREE.Plane(camera.getWorldDirection(new THREE.Vector3()).negate(), 0);
    const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, out)) {
      model.worldToLocal(out);
      return out;
    }
    return null;
  }

  function addLabelAt(clientX, clientY) {
    const local = screenToModel(clientX, clientY);
    if (!local) return;
    const label = prompt("Label name:", "") || "";
    if (!label.trim()) return;
    hotspots.push({
      id: "h-" + Date.now(),
      x: local.x, y: local.y, z: local.z,
      label: label.trim(),
    });
  }

  // v2.7.1: context menu for existing hotspots (edit label / delete)
  let menuEl = null;
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }
  function showHotspotMenu(pinEl, h) {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "three-d-menu";
    menuEl.innerHTML = `
      <button data-act="edit">✏️ Edit label</button>
      <button data-act="del">🗑️ Delete</button>
    `;
    const r = pinEl.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    menuEl.style.left = `${r.left - cr.left}px`;
    menuEl.style.top = `${r.bottom - cr.top + 6}px`;
    menuEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "edit") {
        const next = prompt("Label name:", h.label || "");
        if (next !== null && next.trim()) h.label = next.trim();
      } else if (act === "del") {
        hotspots = hotspots.filter((x) => x.id !== h.id);
      }
      closeMenu();
    });
    container.appendChild(menuEl);
    // Close on outside click
    setTimeout(() => {
      const onDoc = (ev) => {
        if (menuEl && !menuEl.contains(ev.target)) {
          closeMenu();
          document.removeEventListener("click", onDoc, true);
        }
      };
      document.addEventListener("click", onDoc, true);
    }, 0);
  }

  // Render loop con proyección de hotspots (v1.5.3 técnica core)
  const tmpVec = new THREE.Vector3();
  function animate() {
    requestAnimationFrame(animate);
    model.rotation.y = rotY;
    model.rotation.x = rotX;
    renderer.render(scene, camera);

    // Proyectar cada hotspot (3D → 2D)
    overlay.innerHTML = "";
    for (const h of hotspots) {
      tmpVec.set(h.x, h.y, h.z);
      model.localToWorld(tmpVec);
      tmpVec.project(camera);
      const x = (tmpVec.x + 1) / 2 * rect().width;
      const y = (-tmpVec.y + 1) / 2 * rect().height;
      const visible = tmpVec.z < 1; // detrás de cámara

      const pin = document.createElement("div");
      pin.className = "three-d-hotspot";
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
      pin.style.opacity = visible ? "1" : "0.3";
      pin.dataset.id = h.id;
      pin.innerHTML = `
        <div class="pin"></div>
        <div class="line" style="height: 30px"></div>
        <div class="callout">${escapeHtml(h.label || h.id || "")}</div>
      `;
      pin.title = h.label || "";
      // v2.7.1: click on hotspot → context menu (edit/delete).
      // v2.9.x: if caller passed onHotspotClick, invoke that instead.
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onHotspotClick === "function") {
          onHotspotClick(h);
        } else {
          showHotspotMenu(pin, h);
        }
      });
      overlay.appendChild(pin);
    }
  }
  animate();

  // Resize
  const ro = new ResizeObserver(() => {
    const r = rect();
    renderer.setSize(r.width, r.height);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  // Esc to close
  const escHandler = (e) => {
    if (e.key === "Escape") {
      container.remove();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function loadThree() {
  return new Promise((resolve, reject) => {
    if (window.THREE) return resolve(window.THREE);
    const s = document.createElement("script");
    s.src = "https://unpkg.com/three@0.158.0/build/three.min.js";
    s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error("THREE undefined")));
    s.onerror = () => reject(new Error("three.js failed to load"));
    document.head.appendChild(s);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
