// RAG Indexer: recorre el vault, genera chunks, calcula embeddings, los guarda.
// Trabaja en background. Soporta re-indexado incremental (solo chunks modificados).

import { App, TFile } from "obsidian";
import { RAGChunk, MNexusSettings } from "../types";
import { chunkNote, hashText } from "./chunker";
import { EmbeddingProvider } from "./embeddings";
import { VectorStore } from "./vectorStore";
import { Logger } from "../utils/logger";

export interface IndexerOptions {
  /** Re-indexar en cada modificación del vault (puede ser costoso). */
  watchVault: boolean;
  /** Carpetas a excluir (glob patterns). */
  excludeFolders: string[];
  /** Si la nota no tiene frontmatter.author_verified=true, no se indexa. */
  onlyVerified: boolean;
}

export class Indexer {
  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger,
    private store: VectorStore,
    private embeddings: EmbeddingProvider
  ) {}

  async indexVault(opts: Partial<IndexerOptions> = {}): Promise<{ indexed: number; skipped: number; failed: number }> {
    const merged = { watchVault: false, excludeFolders: ["_M-NEXUS"], onlyVerified: false, ...opts };
    const files = this.app.vault.getMarkdownFiles();
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    for (const f of files) {
      // Excluir si el path empieza por una carpeta excluida o es exactamente esa carpeta.
      // Importante: usar `p + "/"` para no matchear archivos como "_M-NEXUS-Notas.md".
      if (
        merged.excludeFolders.some(
          (p) => f.path === p || f.path.startsWith(p + "/") || f.path.startsWith(p + "\\"),
        )
      ) {
        skipped++;
        continue;
      }
      if (merged.onlyVerified) {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (fm?.author_verified !== true) {
          skipped++;
          continue;
        }
      }
      try {
        const result = await this.indexNote(f);
        if (result > 0) indexed++;
        else skipped++;
      } catch (e) {
        failed++;
        this.log.warn(`Index falló para ${f.path}: ${(e as Error).message}`);
      }
    }
    await this.store.persist();
    this.log.info(`RAG index: ${indexed} indexadas, ${skipped} omitidas, ${failed} fallidas.`);
    return { indexed, skipped, failed };
  }

  async indexNote(file: TFile): Promise<number> {
    if (!this.embeddings.isConfigured()) {
      throw new Error("Embeddings no configurados. Configura la API key de OpenRouter.");
    }
    const content = await this.app.vault.read(file);
    const rawChunks = chunkNote(file, content);
    this.store.removeByNote(file.path);
    if (rawChunks.length === 0) return 0;

    // Embed en batch (más eficiente)
    const texts = rawChunks.map((c) => c.text);
    let vecs: number[][];
    try {
      vecs = await this.embeddings.embedBatch(texts);
    } catch (e) {
      this.log.warn(`Embedding falló para ${file.path}: ${(e as Error).message}. Fallback: 1-by-1.`);
      vecs = [];
      for (const t of texts) {
        vecs.push(await this.embeddings.embed(t));
      }
    }

    const now = new Date().toISOString();
    for (let i = 0; i < rawChunks.length; i++) {
      const c = rawChunks[i];
      const id = VectorStore.idFor(file.path, c.chunkIndex, c.text);
      const chunk: RAGChunk = {
        id,
        notePath: file.path,
        noteTitle: file.basename,
        section: c.section,
        chunkIndex: c.chunkIndex,
        text: c.text,
        embedding: vecs[i],
        createdAt: now,
        hash: hashText(c.text),
      };
      this.store.add(chunk);
    }
    return rawChunks.length;
  }

  async removeNote(file: TFile): Promise<number> {
    return this.store.removeByNote(file.path);
  }

  /** Re-indexar notas modificadas recientemente. Llamar periódicamente. */
  async reindexStale(maxAge: number = 60 * 60 * 1000): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    const now = Date.now();
    let count = 0;
    for (const f of files) {
      const mtimeMs = f.stat.mtime;
      if (now - mtimeMs < maxAge) {
        // Archivo modificado recientemente; re-indexar
        await this.indexNote(f);
        count++;
      }
    }
    if (count > 0) await this.store.persist();
    return count;
  }
}
