// Image Occlusion: crea flashcards con regiones rectangulares sobre una imagen.
// Cada región tapada se convierte en una flashcard cloze visual.
//
// Estructura del archivo .json asociado a la imagen:
//   {
//     "imagePath": "_M-NEXUS/Photos/anatomia.png",
//     "occlusions": [
//       { "id": "occ1", "x": 100, "y": 50, "width": 200, "height": 80, "label": "Ventrículo izquierdo" },
//       ...
//     ],
//     "createdAt": "..."
//   }

import { App, TFile, normalizePath } from "obsidian";
import { PressurePoint } from "../types";
import { Logger } from "../utils/logger";
import { PhotoManager } from "../photos/manager";

export interface Occlusion {
  id: string;
  x: number; // en píxeles de la imagen
  y: number;
  width: number;
  height: number;
  label: string; // la respuesta de la flashcard
}

export interface OcclusionDocument {
  imagePath: string;
  occlusions: Occlusion[];
  createdAt: string;
  updatedAt: string;
}

export interface OcclusionCard {
  id: string;
  imagePath: string;
  occlusion: Occlusion;
  /** Texto del front: "Identifica esta región:" + ruta de la imagen tapada. */
  front: string;
  /** Texto del back: la etiqueta. */
  back: string;
}

const STORAGE_FOLDER = "_M-NEXUS/Photos/occlusions";

export class ImageOcclusionBuilder {
  constructor(
    private app: App,
    private photoManager: PhotoManager,
    private log: Logger
  ) {}

  /**
   * Crea un nuevo documento de oclusión para una imagen del vault.
   * Devuelve el path del .json con las oclusiones.
   */
  async create(imagePath: string): Promise<string> {
    const norm = normalizePath(STORAGE_FOLDER);
    if (!(await this.app.vault.adapter.exists(norm))) {
      const parts = norm.split("/");
      let cur = "";
      for (const p of parts) {
        cur = cur ? `${cur}/${p}` : p;
        if (!(await this.app.vault.adapter.exists(cur))) {
          await this.app.vault.createFolder(cur);
        }
      }
    }
    const file = this.app.vault.getAbstractFileByPath(imagePath);
    if (!(file instanceof TFile)) throw new Error(`Imagen no encontrada: ${imagePath}`);
    const stem = file.basename;
    const jsonPath = normalizePath(`${STORAGE_FOLDER}/${stem}.occlusions.json`);
    const doc: OcclusionDocument = {
      imagePath,
      occlusions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (await this.app.vault.adapter.exists(jsonPath)) {
      throw new Error(`Ya existe un documento de oclusiones para ${stem}`);
    }
    await this.app.vault.create(jsonPath, JSON.stringify(doc, null, 2));
    return jsonPath;
  }

  async load(jsonPath: string): Promise<OcclusionDocument> {
    const raw = await this.app.vault.adapter.read(normalizePath(jsonPath));
    return JSON.parse(raw) as OcclusionDocument;
  }

  async save(jsonPath: string, doc: OcclusionDocument): Promise<void> {
    doc.updatedAt = new Date().toISOString();
    await this.app.vault.adapter.write(
      normalizePath(jsonPath),
      JSON.stringify(doc, null, 2)
    );
  }

  /**
   * Añade una oclusión. Las coordenadas se dan en píxeles de la imagen
   * original (no escalados).
   */
  async addOcclusion(jsonPath: string, occ: Omit<Occlusion, "id">): Promise<OcclusionDocument> {
    const doc = await this.load(jsonPath);
    const full: Occlusion = {
      ...occ,
      id: `occ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    doc.occlusions.push(full);
    await this.save(jsonPath, doc);
    return doc;
  }

  async removeOcclusion(jsonPath: string, occlusionId: string): Promise<OcclusionDocument> {
    const doc = await this.load(jsonPath);
    doc.occlusions = doc.occlusions.filter((o) => o.id !== occlusionId);
    await this.save(jsonPath, doc);
    return doc;
  }

  /**
   * Convierte las oclusiones en borradores de flashcards.
   * Cada oclusión es una flashcard tipo image-occlusion.
   */
  toDrafts(doc: OcclusionDocument, notePath: string): OcclusionCard[] {
    return doc.occlusions.map((occ) => ({
      id: `imgocc-${occ.id}`,
      imagePath: doc.imagePath,
      occlusion: occ,
      front: `Identifica la región marcada: ![[${doc.imagePath}#${occ.id}]]`,
      back: occ.label,
    }));
  }
}
