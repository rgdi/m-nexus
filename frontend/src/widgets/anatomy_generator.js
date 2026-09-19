// anatomy_generator.js — Cell biology 3D model generator (v2.15.0).
//
// Generates 3 procedural cellular models with organelle hotspots:
// - animal_cell.glb: membrana + núcleo + mitocondrias + RE + Golgi
// - plant_cell.glb:  pared celular + núcleo + vacuola + cloroplastos
// - bacterium.glb:   cápsula + nucleoide + ribosomas + plásmido
//
// Each hotspot links to a note anchor for study-mode navigation.
// Real .glb files live in /public/models/ and are loaded by the 3D viewer.

import { open3DViewer } from "./three_d_viewer.js";

const CELL_DATA = {
  animal_cell: {
    name: "Célula animal",
    color: 0xd9e8f5, // pale blue (membrane)
    hotspots: [
      { id: "membrane",         label: "Membrana plasmática",     pos: [0.95, 0,    0],    noteAnchor: "celula-animal#membrana" },
      { id: "nucleus",          label: "Núcleo",                  pos: [0.25, 0.15, 0.1],  noteAnchor: "celula-animal#nucleo" },
      { id: "nucleolus",        label: "Nucléolo",                pos: [0.30, 0.20, 0.15], noteAnchor: "celula-animal#nucleolo" },
      { id: "mito-1",           label: "Mitocondria 1",           pos: [-0.5, 0.35, 0.25], noteAnchor: "celula-animal#mitocondria" },
      { id: "mito-2",           label: "Mitocondria 2",           pos: [0.45, -0.45, 0.35],noteAnchor: "celula-animal#mitocondria" },
      { id: "mito-3",           label: "Mitocondria 3",           pos: [0.35, 0.55, -0.35],noteAnchor: "celula-animal#mitocondria" },
      { id: "er",               label: "Retículo endoplásmico",   pos: [0, -0.35, 0],     noteAnchor: "celula-animal#re" },
      { id: "golgi",            label: "Aparato de Golgi",        pos: [-0.45, 0.55, 0.45],noteAnchor: "celula-animal#golgi" },
      { id: "cytoplasm",        label: "Citoplasma",              pos: [0, 0, 0.7],       noteAnchor: "celula-animal#citoplasma" },
    ],
  },
  plant_cell: {
    name: "Célula vegetal",
    color: 0xa6dca0, // green
    hotspots: [
      { id: "cell-wall",        label: "Pared celular",            pos: [0.95, 0, 0],       noteAnchor: "celula-vegetal#pared" },
      { id: "membrane",         label: "Membrana plasmática",     pos: [0.9, 0.2, 0],      noteAnchor: "celula-vegetal#membrana" },
      { id: "nucleus",          label: "Núcleo",                  pos: [0.35, 0.35, 0.1],  noteAnchor: "celula-vegetal#nucleo" },
      { id: "vacuole",          label: "Vacuola central",         pos: [-0.25, -0.25, 0.15],noteAnchor: "celula-vegetal#vacuola" },
      { id: "chloroplast-1",    label: "Cloroplasto 1",          pos: [0.55, 0.55, 0.55], noteAnchor: "celula-vegetal#cloroplasto" },
      { id: "chloroplast-2",    label: "Cloroplasto 2",          pos: [-0.65, 0.45, 0.5], noteAnchor: "celula-vegetal#cloroplasto" },
      { id: "chloroplast-3",    label: "Cloroplasto 3",          pos: [0.45, -0.65, 0.5], noteAnchor: "celula-vegetal#cloroplasto" },
      { id: "golgi",            label: "Aparato de Golgi",        pos: [0.6, -0.5, -0.4],  noteAnchor: "celula-vegetal#golgi" },
    ],
  },
  bacterium: {
    name: "Bacteria (bacilo)",
    color: 0xf2d9b6, // beige
    hotspots: [
      { id: "capsule",          label: "Cápsula bacteriana",      pos: [0, 0.7, 0],       noteAnchor: "bacteria#capsula" },
      { id: "cell-wall",        label: "Pared celular (peptidoglucano)", pos: [0, 0.65, 0.2], noteAnchor: "bacteria#pared" },
      { id: "membrane",         label: "Membrana plasmática",     pos: [0, 0.55, 0.3],    noteAnchor: "bacteria#membrana" },
      { id: "nucleoid",         label: "Nucleoide",               pos: [0, 0.15, 0.1],    noteAnchor: "bacteria#nucleoide" },
      { id: "ribosome-1",       label: "Ribosoma 1",             pos: [0.35, -0.25, 0.35],noteAnchor: "bacteria#ribosoma" },
      { id: "ribosome-2",       label: "Ribosoma 2",             pos: [-0.35, 0.35, 0.35],noteAnchor: "bacteria#ribosoma" },
      { id: "ribosome-3",       label: "Ribosoma 3",             pos: [0.35, 0.35, -0.35],noteAnchor: "bacteria#ribosoma" },
      { id: "ribosome-4",       label: "Ribosoma 4",             pos: [-0.35, -0.35, -0.35],noteAnchor: "bacteria#ribosoma" },
      { id: "ribosome-5",       label: "Ribosoma 5",             pos: [0, 0.05, 0.4],    noteAnchor: "bacteria#ribosoma" },
      { id: "plasmid",          label: "Plásmido",                pos: [0.35, -0.45, 0.05],noteAnchor: "bacteria#plasmido" },
    ],
  },
};

export function generateModel(key) {
  const data = CELL_DATA[key];
  if (!data) throw new Error("Unknown model: " + key);
  const hotspots = data.hotspots.map((h) => ({
    id: h.id,
    label: h.label,
    x: h.pos[0], y: h.pos[1], z: h.pos[2],
    noteAnchor: h.noteAnchor,
  }));
  return {
    name: data.name,
    modelKey: key,
    hotspots,
    color: data.color,
  };
}

export function openModelViewer(modelKey, options = {}) {
  const model = generateModel(modelKey);
  const modelSpec = options.modelSpec || {
    url: `/models/${modelKey}.glb`,
  };
  open3DViewer({
    label: model.name,
    hotspots: model.hotspots,
    color: model.color,
    modelType: modelSpec,
    onHotspotClick: (h) => {
      if (h.noteAnchor) {
        const [topic, anchor] = h.noteAnchor.split("#");
        location.hash = `#/notes?topic=${encodeURIComponent(topic)}&anchor=${encodeURIComponent(anchor)}`;
      }
    },
  });
}

// Backward-compatible alias (some old callers used openBoneViewer)
export const openBoneViewer = openModelViewer;
export const AVAILABLE_BONES = Object.keys(CELL_DATA);
