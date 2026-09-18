// anatomy_generator.js — programmatic 3D anatomy model generator (v2.8.0).
//
// Generates a simple humerus/femur-style bone from primitives, with
// anatomically-accurate surface landmarks (tubercles, condyles, etc.) as
// hotspots that link to notes.
//
// Real Anki-style anatomy learning: hotspots carry a label and a `noteId`
// pointer. Click → opens the linked note in the side panel.

import { open3DViewer } from "./three_d_viewer.js";

const ANATOMY_DATA = {
  humerus: {
    name: "Húmero",
    color: 0xf5e6d3,
    /** Approximate bone shape: a cylinder body + sphere heads + small bumps for landmarks */
    hotspots: [
      { id: "head", label: "Cabeza humeral", pos: [0, 1.4, 0], noteAnchor: "humero#cabeza" },
      { id: "anatomical-neck", label: "Cuello anatómico", pos: [0, 1.25, 0], noteAnchor: "humero#cuello-anatomico" },
      { id: "greater-tubercle", label: "Troquiter (tubérculo mayor)", pos: [0.4, 1.1, 0], noteAnchor: "humero#troquiter" },
      { id: "lesser-tubercle", label: "Troquín (tubérculo menor)", pos: [-0.3, 1.05, 0], noteAnchor: "humero#troquin" },
      { id: "intertubercular-groove", label: "Surco intertubercular (corredera bicipital)", pos: [0.05, 0.95, 0.15], noteAnchor: "humero#corredera-bicipital" },
      { id: "surgical-neck", label: "Cuello quirúrgico", pos: [0, 0.6, 0], noteAnchor: "humero#cuello-quirurgico" },
      { id: "deltoid-tuberosity", label: "Tuberosidad deltoidea (V deltoidea)", pos: [0.18, 0.0, 0], noteAnchor: "humero#v-deltoidea" },
      { id: "radial-groove", label: "Surco del nervio radial", pos: [-0.25, -0.4, 0], noteAnchor: "humero#surco-radial" },
      { id: "lateral-epicondyle", label: "Epicóndilo lateral", pos: [0.4, -1.2, 0], noteAnchor: "humero#epicondilo-lateral" },
      { id: "medial-epicondyle", label: "Epicóndilo medial", pos: [-0.35, -1.25, 0], noteAnchor: "humero#epicondilo-medial" },
      { id: "trochlea", label: "Tróclea humeral", pos: [-0.1, -1.5, 0], noteAnchor: "humero#troclea" },
      { id: "capitulum", label: "Cóndilo (capitulum)", pos: [0.2, -1.5, 0], noteAnchor: "humero#capitulum" },
      { id: "olecranon-fossa", label: "Fosa olecraneana", pos: [0, -1.05, -0.25], noteAnchor: "humero#fosa-olecraneana" },
      { id: "coronoid-fossa", label: "Fosa coronoidea", pos: [0, -1.4, -0.2], noteAnchor: "humero#fosa-coronoidea" },
    ],
  },
  femur: {
    name: "Fémur",
    color: 0xf5e6d3,
    hotspots: [
      { id: "femoral-head", label: "Cabeza femoral", pos: [0, 1.8, 0], noteAnchor: "femur#cabeza" },
      { id: "femoral-neck", label: "Cuello femoral", pos: [0.2, 1.5, 0], noteAnchor: "femur#cuello" },
      { id: "greater-trochanter", label: "Trocánter mayor", pos: [0.5, 1.4, 0], noteAnchor: "femur#trocanter-mayor" },
      { id: "lesser-trochanter", label: "Trocánter menor", pos: [-0.3, 1.1, 0.1], noteAnchor: "femur#trocanter-menor" },
      { id: "intertrochanteric-line", label: "Línea intertrocantérica", pos: [0.1, 1.25, 0.15], noteAnchor: "femur#linea-intertrocanterica" },
      { id: "intertrochanteric-crest", label: "Cresta intertrocantérica", pos: [0.2, 1.25, -0.15], noteAnchor: "femur#cresta-intertrocanterica" },
      { id: "gluteal-tuberosity", label: "Tuberosidad glútea", pos: [0.25, 0.8, -0.15], noteAnchor: "femur#tuberosidad-glutea" },
      { id: "linea-aspera", label: "Línea áspera", pos: [-0.1, 0.0, -0.15], noteAnchor: "femur#linea-aspera" },
      { id: "medial-condyle", label: "Cóndilo medial", pos: [-0.25, -1.7, 0], noteAnchor: "femur#condilo-medial" },
      { id: "lateral-condyle", label: "Cóndilo lateral", pos: [0.25, -1.7, 0], noteAnchor: "femur#condilo-lateral" },
      { id: "intercondylar-fossa", label: "Fosa intercondílea", pos: [0, -1.6, -0.15], noteAnchor: "femur#fosa-intercondilea" },
      { id: "patellar-surface", label: "Carilla rotuliana", pos: [0, -1.75, 0.25], noteAnchor: "femur#carilla-rotuliana" },
    ],
  },
  scapula: {
    name: "Escápula",
    color: 0xf5e6d3,
    hotspots: [
      { id: "glenoid", label: "Cavidad glenoidea", pos: [0, -0.2, 0.3], noteAnchor: "escapula#cavidad-glenoidea" },
      { id: "coracoid", label: "Apófisis coracoides", pos: [0.4, 0.0, 0.2], noteAnchor: "escapula#coracoides" },
      { id: "acromion", label: "Acromion", pos: [0.5, 0.6, 0], noteAnchor: "escapula#acromion" },
      { id: "spine", label: "Espina de la escápula", pos: [0.4, 0.4, 0], noteAnchor: "escapula#espina" },
      { id: "supraspinous-fossa", label: "Fosa supraespinosa", pos: [0.3, 0.7, -0.05], noteAnchor: "escapula#fosa-supraespinosa" },
      { id: "infraspinous-fossa", label: "Fosa infraespinosa", pos: [0.3, -0.1, -0.05], noteAnchor: "escapula#fosa-infraespinosa" },
      { id: "subscapular-fossa", label: "Fosa subescapular", pos: [-0.2, 0.1, 0.1], noteAnchor: "escapula#fosa-subescapular" },
      { id: "medial-border", label: "Borde medial (vertebral)", pos: [-0.6, 0.3, 0], noteAnchor: "escapula#borde-medial" },
      { id: "lateral-border", label: "Borde lateral (axilar)", pos: [0.55, 0.1, 0], noteAnchor: "escapula#borde-lateral" },
      { id: "superior-border", label: "Borde superior", pos: [0.0, 0.85, 0], noteAnchor: "escapula#borde-superior" },
      { id: "inferior-angle", label: "Ángulo inferior", pos: [-0.4, -0.8, 0], noteAnchor: "escapula#angulo-inferior" },
    ],
  },
};

/**
 * Generate a procedural geometry for a bone model.
 * Returns: { vertices, faces } suitable for THREE.BufferGeometry,
 * plus `hotspots` ready for open3DViewer.
 */
export function generateBoneModel(boneKey) {
  const data = ANATOMY_DATA[boneKey];
  if (!data) throw new Error("Unknown bone: " + boneKey);
  // Cylinder body + spherical heads — built by open3DViewer with a custom
  // geometry if provided. For now we use the existing cube + hotspots approach.
  const hotspots = data.hotspots.map((h) => ({
    id: h.id,
    label: h.label,
    x: h.pos[0], y: h.pos[1], z: h.pos[2],
    noteAnchor: h.noteAnchor,
  }));
  return {
    name: data.name,
    boneKey,
    hotspots,
    color: data.color,
    /** The actual mesh geometry is built inside open3DViewer */
  };
}

/**
 * Open the bone viewer — wraps open3DViewer with the procedural geometry.
 * Wires hotspot clicks to navigate to the linked note.
 */
export function openBoneViewer(boneKey, options = {}) {
  const bone = generateBoneModel(boneKey);
  // v2.10.0: try real .glb from /public/models/ first. Falls back to procedural cylinder.
  // modelType can be either:
  //  - string: "cube" | "sphere" | "bone" | ".glb URL"
  //  - object: { url: ".glb URL" } for explicit GLB loading
  const modelSpec = options.modelSpec || {
    url: `/models/${boneKey}.glb`,
  };
  open3DViewer({
    label: bone.name,
    hotspots: bone.hotspots,
    color: bone.color,
    modelType: modelSpec,
    onHotspotClick: (h) => {
      if (h.noteAnchor) {
        const [topic, anchor] = h.noteAnchor.split("#");
        location.hash = `#/notes?topic=${encodeURIComponent(topic)}&anchor=${encodeURIComponent(anchor)}`;
      }
    },
  });
}

export const AVAILABLE_BONES = Object.keys(ANATOMY_DATA);
