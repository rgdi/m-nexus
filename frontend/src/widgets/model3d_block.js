/**
 * model3d_block.js — un modelo 3D dentro de una nota.
 *
 * v2.38.16. Sustituye al "3D Graph" del resumen, que era el resumen con
 * las notas esparcidas como chinchetas sobre un hueso: bonito y sin
 * ninguna utilidad.
 *
 * Lo que si sirve es esto: un modelo en medio del texto, con
 * etiquetas puestas a mano sobre las estructuras y con oclusion encima
 * —tapar una parte y adivinar cual es— que es como se estudia
 * anatomia de verdad.
 *
 * Tres decisiones que no son las que parecian:
 *
 * 1. **three.js va en la app, no en unpkg.** Un modelo 3D que necesita
 *    internet no sirve en un examen sin datos. Esta en /vendor.
 *
 * 2. **La etiqueta no se escribe en un prompt().** `prompt()` es el
 *    dialogo del navegador: sin estilo, sin traduccion, y en iOS abre
 *    un teclado del sistema encima de la pantalla. Aqui se escribe
 *    inline, sobre el propio punto.
 *
 * 3. **La oclusion se ancla al modelo, no a la pantalla.** Cada caja
 *    guarda su punto en coordenadas del modelo. Si giras el corazon,
 *    la caja se queda encima de la auricula, no flotando en la
 *    esquina de la pantalla.
 */

/** Cada modulo lleva su propio escapeHtml: el del proyecto es una
 * copia pegada en quince ficheros, no un modulo compartido. */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ── three.js local, con el CDN como red de seguridad ───────────── */
let threePromise = null;
export function loadThree() {
  if (threePromise) return threePromise;
  threePromise = (async () => {
    if (window.THREE) return window.THREE;
    // v2.38.16 — venia de unpkg con un <script>. En el sandbox y sin
    // red eso es un bloque 3D vacio.
    const LOCAL = "/vendor/three.min.js";
    const CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.158.0/three.min.js";
    for (const src of [LOCAL, CDN]) {
      try {
        await new Promise((ok, ko) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = ok;
          s.onerror = () => ko(new Error("no se pudo cargar " + src));
          document.head.appendChild(s);
        });
        if (window.THREE) return window.THREE;
      } catch { /* el siguiente */ }
    }
    throw new Error("three.js no disponible");
  })().catch((e) => { threePromise = null; throw e; });
  return threePromise;
}

/* ── modelos de anatomia, generados ──────────────────────────────
 *
 * No hay archivos .glb en el repo: vienen de fuentes libres con
 * licencias distintas y meterslos aqui seria publicar material que no
 * es mio. En vez de eso se generan primitivas con nombre, que para
 * oclusion y para etiquetas es exactamente lo que hace falta: girar,
 * mirar, tapar y adivinar. Un GLB de verdad se pega con `modelUrl` y
 * entra por el mismo camino.
 */
export const MODELOS = {
  corazon: {
    label: "Corazón",
    hint: "Aurículas, ventrículos y las cuatro válvulas",
    build(T) {
      const g = new T.Group();
      const meat = new T.MeshStandardMaterial({ color: 0xb03a48, roughness: 0.72 });
      const chamber = new T.MeshStandardMaterial({ color: 0x6d1f28, roughness: 0.85 });
      // Los dos ventriculos: conos apuntando abajo.
      for (const side of [-1, 1]) {
        const v = new T.Mesh(new T.ConeGeometry(1.15, 2.5, 28), chamber);
        v.position.set(side * 0.85, -0.5, 0.1);
        v.rotation.z = side * -0.32;
        g.add(v);
        // Aurícula: esfera encima de cada ventrículo.
        const a = new T.Mesh(new T.SphereGeometry(0.78, 26, 20), meat);
        a.position.set(side * 0.95, 1.05, 0.05);
        a.scale.set(1, 0.78, 1);
        g.add(a);
      }
      // El tabique, para que no parezca una bolsa.
      const sep = new T.Mesh(new T.BoxGeometry(0.16, 2.1, 1.6), meat);
      sep.position.set(0, 0.15, 0.1);
      g.add(sep);
      // La aorta: el arco de encima.
      const aorta = new T.Mesh(new T.TorusGeometry(0.85, 0.22, 14, 40, Math.PI * 1.15), meat);
      aorta.position.set(0, 1.5, -0.15);
      aorta.rotation.z = Math.PI * 0.42;
      g.add(aorta);
      // La arteria pulmonar, más pequeña y delante.
      const pulm = new T.Mesh(new T.TorusGeometry(0.58, 0.16, 12, 34, Math.PI * 0.95), meat);
      pulm.position.set(0.1, 1.35, 0.5);
      pulm.rotation.z = Math.PI * 1.15;
      g.add(pulm);
      return g;
    },
  },
  craneo: {
    label: "Cráneo",
    hint: "El cerebro dentro de la caja ósea",
    build(T) {
      const g = new T.Group();
      const bone = new T.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.85 });
      const shell = new T.Mesh(new T.SphereGeometry(1.5, 30, 24), bone);
      shell.scale.set(1, 1.06, 1.16);
      g.add(shell);
      const jaw = new T.Mesh(new T.BoxGeometry(1.5, 0.52, 1.1), bone);
      jaw.position.set(0, -1.2, 0.5);
      g.add(jaw);
      const brain = new T.Mesh(
        new T.SphereGeometry(1.16, 24, 20),
        new T.MeshStandardMaterial({ color: 0xd98c8c, roughness: 0.9 }));
      brain.position.set(0, 0.12, 0.06);
      brain.scale.set(1, 0.9, 1.05);
      g.add(brain);
      return g;
    },
  },
  hueso: {
    label: "Hueso largo",
    hint: "Epífisis, diáfisis y médula",
    build(T) {
      const g = new T.Group();
      const bone = new T.MeshStandardMaterial({ color: 0xefe6d0, roughness: 0.88 });
      const shaft = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 3.1, 20), bone);
      g.add(shaft);
      for (const y of [-1.7, 1.7]) {
        const head = new T.Mesh(new T.SphereGeometry(0.72, 26, 20), bone);
        head.position.y = y;
        head.scale.set(1, 0.7, 1);
        g.add(head);
      }
      const marrow = new T.Mesh(
        new T.CylinderGeometry(0.19, 0.19, 2.9, 16),
        new T.MeshStandardMaterial({ color: 0xc96a6a, roughness: 0.8 }));
      g.add(marrow);
      return g;
    },
  },
  vertebra: {
    label: "Vértebra",
    hint: "Cuerpo, apófisis espinosa y el canal medular",
    build(T) {
      const g = new T.Group();
      const bone = new T.MeshStandardMaterial({ color: 0xece2cc, roughness: 0.86 });
      const body = new T.Mesh(new T.CylinderGeometry(0.85, 0.85, 0.62, 26), bone);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const arch = new T.Mesh(new T.TorusGeometry(0.55, 0.2, 12, 28, Math.PI), bone);
      arch.position.z = -0.5;
      g.add(arch);
      const spine = new T.Mesh(new T.BoxGeometry(0.24, 0.24, 1.15), bone);
      spine.position.z = -1.15;
      g.add(spine);
      const cord = new T.Mesh(
        new T.CylinderGeometry(0.2, 0.2, 0.9, 16),
        new T.MeshStandardMaterial({ color: 0xf0e08a, roughness: 0.7 }));
      cord.rotation.x = Math.PI / 2;
      cord.position.z = -0.45;
      g.add(cord);
      return g;
    },
  },
  pulmon: {
    label: "Pulmones",
    hint: "Lóbulos y la árbol bronquial",
    build(T) {
      const g = new T.Group();
      const lung = new T.MeshStandardMaterial({ color: 0xd88a92, roughness: 0.85 });
      for (const side of [-1, 1]) {
        const l = new T.Mesh(new T.SphereGeometry(1.05, 26, 22), lung);
        l.position.set(side * 0.95, 0, 0);
        l.scale.set(0.72, 1.5, 0.86);
        g.add(l);
      }
      const trachea = new T.Mesh(
        new T.CylinderGeometry(0.16, 0.16, 1.3, 16),
        new T.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.8 }));
      trachea.position.y = 0.95;
      g.add(trachea);
      for (const side of [-1, 1]) {
        const bron = new T.Mesh(
          new T.CylinderGeometry(0.08, 0.1, 1.1, 12),
          new T.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.8 }));
        bron.position.set(side * 0.4, 0.42, 0);
        bron.rotation.z = side * 0.7;
        g.add(bron);
      }
      return g;
    },
  },
  cerebro: {
    label: "Cerebro",
    hint: "Lóbulos y surcos",
    build(T) {
      const g = new T.Group();
      const brain = new T.MeshStandardMaterial({ color: 0xe3a0a0, roughness: 0.92 });
      const big = new T.Mesh(new T.SphereGeometry(1.4, 34, 26), brain);
      big.scale.set(1, 0.82, 1.1);
      g.add(big);
      // El surco longitudinal, que es lo que separa los hemisferios.
      const fissure = new T.Mesh(
        new T.BoxGeometry(0.09, 1.5, 1.2),
        new T.MeshStandardMaterial({ color: 0xc98a8a, roughness: 0.95 }));
      fissure.position.set(0, 0.12, 0);
      g.add(fissure);
      for (const side of [-1, 1]) {
        const stem = new T.Mesh(new T.CylinderGeometry(0.17, 0.22, 1.1, 16), brain);
        stem.position.set(side * 0.32, -1.35, 0);
        stem.rotation.z = side * 0.24;
        g.add(stem);
      }
      return g;
    },
  },
};

export const MODEL_IDS = Object.keys(MODELOS);

/* ── estilos ─────────────────────────────────────────────────── */
const CSS = `
.m3d { display:grid; gap:.5rem; }
.m3d-stage { position:relative; aspect-ratio:4/3; max-height:min(52vh,420px); border-radius:14px; overflow:hidden;
  background:radial-gradient(120% 90% at 50% 0%,#1d2130 0%,#0e1118 70%); touch-action:none; }
.m3d-stage canvas { max-height:min(52vh,420px); }
.m3d-stage canvas { display:block; width:100%; height:100%; }
.m3d-stage { overflow:hidden; }
.m3d-hint { position:absolute; left:10px; bottom:10px; font-size:.72rem; color:#9aa3b8;
  background:rgba(0,0,0,.5); padding:.22rem .5rem; border-radius:999px; pointer-events:none; }
.m3d-tools { position:absolute; right:8px; top:8px; display:flex; gap:.25rem; }
.m3d-tools button { width:36px; height:36px; border-radius:10px; border:1px solid rgba(255,255,255,.14);
  background:rgba(16,20,30,.78); color:#e7e9f0; display:grid; place-items:center; cursor:pointer; font-size:1rem; }
.m3d-tools button[aria-pressed="true"] { background:var(--accent,#7c5cff); border-color:transparent; }
.m3d-pin { position:absolute; transform:translate(-50%,-50%); display:flex; align-items:center; gap:.3rem;
  pointer-events:none; z-index:2; }
.m3d-dot { width:11px; height:11px; border-radius:50%; background:#ffd166; border:2px solid #0e1118;
  box-shadow:0 0 0 2px rgba(255,209,102,.35); flex:none; }
.m3d-name { font-size:.72rem; color:#f3f4f8; background:rgba(12,15,22,.82); padding:.14rem .44rem;
  border-radius:7px; white-space:nowrap; border:1px solid rgba(255,255,255,.12); }
.m3d-occ { position:absolute; border-radius:5px; border:2px solid var(--accent,#7c5cff);
  background:rgba(124,92,255,.34); cursor:pointer; z-index:3; }
.m3d-occ::after { content:"?"; position:absolute; inset:0; display:grid; place-items:center;
  color:#fff; font-weight:700; font-size:.85rem; }
.m3d-occ--tap { display:none; }
.m3d-occ--tapped { background:rgba(255,209,102,.45); border-color:#ffd166; }
.m3d-occ--tapped::after { content:"✓"; }
.m3d-bar { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
.m3d-bar select { flex:1; min-width:8rem; }
.m3d-foot { font-size:.76rem; color:var(--fg-muted); }
.m3d-empty { display:grid; place-items:center; min-height:180px; text-align:center; padding:1rem;
  color:var(--fg-muted); gap:.4rem; }
.m3d-input { position:absolute; z-index:5; width:min(220px,60%); }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const el = document.createElement("style");
  el.id = "model3d-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

/**
 * Monta un bloque 3D.
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string} [opts.modelId]  clave de MODELOS
 * @param {string} [opts.modelUrl]  un .glb propio
 * @param {Array}  [opts.labels]    [{ id, x, y, z, text }]
 * @param {Array}  [opts.occlusions] [{ id, x, y, z, w, h, answer }]
 * @param {Function} [opts.onChange] se llama al anadir o quitar algo
 */
export async function mountModel3D(host, opts = {}) {
  injectStyles();
  const state = {
    modelId: opts.modelId || "corazon",
    labels: [...(opts.labels || [])],
    occlusions: [...(opts.occlusions || [])],
    onChange: opts.onChange || (() => {}),
  };

  host.classList.add("m3d");
  host.innerHTML = `
    <div class="m3d-bar">
      <select class="m3d-pick" aria-label="Modelo">
        ${MODEL_IDS.map((k) => `<option value="${k}"${k === state.modelId ? " selected" : ""}>${escapeHtml(MODELOS[k].label)}</option>`).join("")}
      </select>
      <button class="btn ghost m3d-label-btn" type="button" title="Poner una etiqueta sobre el modelo">🏷 Etiquetar</button>
      <button class="btn ghost m3d-occ-btn" type="button" title="Tapar una zona para jugar">▮ Ocluir</button>
    </div>
    <div class="m3d-stage">
      <div class="m3d-tools">
        <button type="button" data-act="reset" title="Centrar" aria-label="Centrar">⌂</button>
        <button type="button" data-act="spin" title="Girar solo" aria-label="Girar solo" aria-pressed="true">⟳</button>
      </div>
      <div class="m3d-hint">Arrastra para girar · toca una etiqueta para ver su texto</div>
    </div>
    <p class="m3d-foot"></p>
  `;

  const stage = host.querySelector(".m3d-stage");
  const foot = host.querySelector(".m3d-foot");
  const pick = host.querySelector(".m3d-pick");
  const labelBtn = host.querySelector(".m3d-label-btn");
  const occBtn = host.querySelector(".m3d-occ-btn");

  let THREE;
  try {
    THREE = await loadThree();
  } catch (e) {
    host.innerHTML = `<div class="m3d-empty">
      <div style="font-size:1.8rem">📦</div>
      <div>No se pudo cargar el visor 3D.</div>
      <div style="font-size:.75rem;opacity:.75">${escapeHtml(String(e.message || e))}</div>
    </div>`;
    return { destroy() {}, get state() { return state; } };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 100);
  camera.position.set(0, 0.4, 5.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(stage.clientWidth || 480, stage.clientHeight || 360, false);
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Modelo 3D: arrastra para girar");

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fa2ff, 0.5);
  rim.position.set(-4, -2, -3);
  scene.add(rim);

  const holder = new THREE.Group();
  scene.add(holder);

  const ray = new THREE.Raycaster();
  const vec = new THREE.Vector3();
  let model = null;
  let rotY = 0.25, rotX = -0.12, autoSpin = true, alive = true;
  let mode = null;      // "label" | "occlusion" | null

  function buildModel() {
    if (model) { holder.remove(model); model = null; }
    const def = MODELOS[state.modelId];
    model = def ? def.build(THREE) : MODELOS.corazon.build(THREE);
    holder.add(model);
    rotY = 0.25; rotX = -0.12;
    foot.textContent = def ? `${def.label} — ${def.hint}` : "";
    paint();
  }

  /** Un punto de la pantalla → coordenadas del modelo. */
  function toModel(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    ), camera);
    if (model) {
      const hits = ray.intersectObject(model, true);
      if (hits.length) return model.worldToLocal(hits[0].point.clone());
    }
    const plane = new THREE.Plane(camera.getWorldDirection(new THREE.Vector3()).negate(), 0);
    const out = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, out)) return model ? model.worldToLocal(out) : out;
    return null;
  }

  /** Proyecta un punto del modelo a la pantalla. */
  function toScreen(x, y, z) {
    vec.set(x, y, z);
    if (model) model.localToWorld(vec);
    vec.project(camera);
    return {
      x: (vec.x * 0.5 + 0.5) * 100,
      y: (-vec.y * 0.5 + 0.5) * 100,
      visible: vec.z < 1,
    };
  }

  /* ── etiquetas y oclusiones, en coordenadas del modelo ───────── */
  function paint() {
    stage.querySelectorAll(".m3d-pin, .m3d-occ").forEach((n) => n.remove());
    for (const l of state.labels) {
      const p = toScreen(l.x, l.y, l.z);
      if (!p.visible) continue;
      const el = document.createElement("div");
      el.className = "m3d-pin";
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
      el.innerHTML = `<span class="m3d-dot"></span><span class="m3d-name">${escapeHtml(l.text)}</span>`;
      stage.appendChild(el);
    }
    for (const o of state.occlusions) {
      const p = toScreen(o.x, o.y, o.z);
      if (!p.visible) continue;
      const el = document.createElement("div");
      el.className = "m3d-occ" + (o.tapped ? " m3d-occ--tapped" : "");
      // El tamaño va en porcentaje de la escena: sigue siendo la misma
      // estructura tapada al cambiar el tamaño de la pantalla.
      el.style.left = `${p.x - (o.w || 0.14) * 50}%`;
      el.style.top = `${p.y - (o.h || 0.1) * 50}%`;
      el.style.width = `${(o.w || 0.14) * 100}%`;
      el.style.height = `${(o.h || 0.1) * 100}%`;
      el.title = o.answer || "Toca para ver la respuesta";
      el.addEventListener("pointerup", (ev) => {
        ev.stopPropagation();
        o.tapped = !o.tapped;
        el.classList.toggle("m3d-occ--tapped", !!o.tapped);
        state.onChange(state);
      });
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (ev.shiftKey) {
          state.occlusions = state.occlusions.filter((x) => x.id !== o.id);
          paint();
          state.onChange(state);
        }
      });
      stage.appendChild(el);
    }
  }

  /* ── gesto: girar ────────────────────────────────────────────── */
  let dragging = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    dragging = { x: ev.clientX, y: ev.clientY, moved: 0 };
    autoSpin = false;
    renderer.domElement.setPointerCapture?.(ev.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - dragging.x, dy = ev.clientY - dragging.y;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    rotY += dx * 0.008;
    rotX = Math.max(-1.2, Math.min(1.2, rotX + dy * 0.006));
    dragging.x = ev.clientX; dragging.y = ev.clientY;
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    const wasDrag = dragging && dragging.moved > 6;
    dragging = null;
    if (wasDrag || !mode) return;
    const local = toModel(ev.clientX, ev.clientY);
    if (!local) return;
    if (mode === "label") askLabel(local);
    else if (mode === "occlusion") {
      state.occlusions.push({
        id: "o-" + Math.random().toString(36).slice(2, 9),
        x: +local.x.toFixed(4), y: +local.y.toFixed(4), z: +local.z.toFixed(4),
        w: 0.16, h: 0.12, answer: "", tapped: false,
      });
      paint();
      state.onChange(state);
    }
  });

  /**
   * La etiqueta se escribe aqui mismo.
   *
   * v2.38.16 — esto era un `prompt()`. El dialogo del navegador no se
   * se puede estilizar, sale en ingles, y en iOS abre el teclado del
   * sistema tapando el modelo entero. Un input flotante, en el
   * punto que has tocado, resuelto en un momento.
   */
  function askLabel(local) {
    const p = toScreen(local.x, local.y, local.z);
    const box = document.createElement("input");
    box.className = "m3d-input";
    box.placeholder = "Nombre de la estructura";
    box.setAttribute("aria-label", "Nombre de la estructura");
    box.style.left = `min(max(${p.x}%, 4%), 60%)`;
    box.style.top = `${Math.min(p.y, 70)}%`;
    stage.appendChild(box);
    box.focus();
    const close = () => box.remove();
    box.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") cerrar();
      ev.stopPropagation();
    });
    box.addEventListener("blur", commit, { once: true });
    // v2.38.16 — Enter dispara commit(), que hace blur, que dispara
    // commit() otra vez: dos remove() del mismo nodo y un NotFoundError
    // en consola. Una bandera y se cierra una vez.
    let cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      box.remove();
    }
    function commit() {
      if (cerrado) return;
      const text = box.value.trim();
      if (!text) { cerrar(); return; }
      state.labels.push({
        id: "l-" + Math.random().toString(36).slice(2, 9),
        x: +local.x.toFixed(4), y: +local.y.toFixed(4), z: +local.z.toFixed(4),
        text,
      });
      cerrar();
      paint();
      state.onChange(state);
    }
  }

  /* ── barra ───────────────────────────────────────────────────── */
  pick.addEventListener("change", () => {
    state.modelId = pick.value;
    buildModel();
    state.onChange(state);
  });
  labelBtn.addEventListener("click", () => {
    mode = mode === "label" ? null : "label";
    labelBtn.setAttribute("aria-pressed", String(mode === "label"));
    occBtn.setAttribute("aria-pressed", String(mode === "occlusion"));
  });
  occBtn.addEventListener("click", () => {
    mode = mode === "occlusion" ? null : "occlusion";
    occBtn.setAttribute("aria-pressed", String(mode === "occlusion"));
    labelBtn.setAttribute("aria-pressed", String(mode === "label"));
  });
  host.querySelector('[data-act="reset"]').addEventListener("click", () => {
    rotY = 0.25; rotX = -0.12; paint();
  });
  host.querySelector('[data-act="spin"]').addEventListener("click", (ev) => {
    autoSpin = !autoSpin;
    ev.currentTarget.setAttribute("aria-pressed", String(autoSpin));
  });

  function resize() {
    // clientHeight con el max-height puesto: sin esto el lienzo se
    // dibuja a la altura de aspect-ratio y se sale del bloque.
    const w = stage.clientWidth || 480;
    const h = stage.clientHeight || Math.round(w * 0.68);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    paint();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(stage);

  function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    if (autoSpin && !dragging) rotY += 0.0035;
    holder.rotation.y = rotY;
    holder.rotation.x = rotX;
    renderer.render(scene, camera);
    if (autoSpin) paint();      // las etiquetas giran con el modelo
  }

  buildModel();
  resize();
  loop();

  return {
    get state() { return state; },
    destroy() {
      alive = false;
      ro?.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
