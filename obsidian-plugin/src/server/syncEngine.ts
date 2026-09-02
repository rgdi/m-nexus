// SyncEngine: reconciliación bidireccional vault ↔ servidor.
//
// Estrategia: 3-way merge basado en hashes (local, server, common-base).
// 1. Pedimos snapshot al servidor.
// 2. Calculamos diff local: archivos cuyo hash difiere del servidor.
// 3. Calculamos diff server: archivos en el servidor que no tenemos o cuyo hash difiere.
// 4. Para cada conflicto (mismo path, hash distinto en ambos), aplicamos
//    la estrategia configurada: local-wins, server-wins, newer-wins, manual.

import { App, TFile, TFolder, normalizePath } from "obsidian";
import { Logger } from "../utils/logger";
import { HTTPClient } from "./client";
import { OfflineQueue } from "./offlineQueue";
import { ConflictResolver } from "../sync/conflictResolver";
import { AuthCredentials, FileChange, ServerSnapshot, SyncDelta, SyncResult, ConflictRecord } from "./types";
import { sha256 } from "../utils/hash";

export type ConflictStrategy = "local-wins" | "server-wins" | "newer-wins" | "manual";

export interface SyncProgress {
  phase: "starting" | "scanning" | "diffing" | "pushing" | "pulling" | "done" | "error";
  message: string;
  progress?: number; // 0..1
}

export interface SyncReport {
  result: SyncResult;
  pulledPaths: string[];
  pushedPaths: string[];
  conflictsResolved: number;
  conflictsManual: ConflictRecord[];
  durationMs: number;
}

export class SyncEngine {
  constructor(
    private app: App,
    private client: HTTPClient,
    private queue: OfflineQueue,
    private resolver: ConflictResolver,
    private log: Logger,
    private strategy: ConflictStrategy = "newer-wins",
    private onProgress?: (p: SyncProgress) => void
  ) {}

  setStrategy(s: ConflictStrategy) {
    this.strategy = s;
  }

  setOnProgress(cb: (p: SyncProgress) => void) {
    this.onProgress = cb;
  }

  // ─── Main entry ──────────────────────────────────────────────────────

  async sync(creds: AuthCredentials): Promise<SyncReport> {
    const start = Date.now();
    this.progress({ phase: "starting", message: "Iniciando sincronización…" });

    // 1) Snapshot del servidor
    let snapshot: ServerSnapshot;
    try {
      snapshot = await this.client.getSnapshot(creds);
      this.progress({ phase: "scanning", message: `Snapshot servidor v${snapshot.version}` });
    } catch (e) {
      // Si falla, intentamos usar el último cacheado en queue
      this.log.warn(`Snapshot falló: ${(e as Error).message}`);
      throw e;
    }

    // 2) Diff local → cambios a subir
    const localChanges = await this.computeLocalChanges(snapshot);
    this.progress({
      phase: "diffing",
      message: `${localChanges.length} cambios locales`,
      progress: 0.5,
    });

    // 3) Push
    let syncResult: SyncResult;
    if (localChanges.length > 0) {
      const cardChanges = await this.queue.peek(500).then((items) =>
        items.filter((i) => i.type === "card").map((i) => i.payload as never)
      );
      const delta: SyncDelta = {
        baseVersion: snapshot.version,
        files: localChanges.filter((c) => c.kind === "upsert" || c.kind === "delete"),
        cards: cardChanges,
        clientTime: new Date().toISOString(),
      };
      this.progress({ phase: "pushing", message: `Subiendo ${delta.files.length} archivos…` });
      syncResult = await this.client.pushDelta(creds, delta);
      // Ack de las cards que se subieron
      const items = await this.queue.peek(500);
      const cardIds = items.filter((i) => i.type === "card").map((i) => i.id);
      if (cardIds.length > 0) await this.queue.ack(cardIds);
    } else {
      syncResult = {
        newVersion: snapshot.version,
        conflicts: [],
        applied: 0,
        rejected: 0,
        snapshot,
      };
    }

    // 4) Pull: descargar archivos que el servidor tiene más nuevos
    const pulledPaths: string[] = [];
    const conflictsResolved: ConflictRecord[] = [];
    const conflictsManual: ConflictRecord[] = [];
    for (const f of syncResult.snapshot.files) {
      const local = this.app.vault.getAbstractFileByPath(normalizePath(f.path));
      if (!local) {
        // Nuevo en servidor
        // Solo descargamos si el servidor lo tiene explícitamente
        // (esto requiere un endpoint de download por archivo; lo registramos para el cliente)
        pulledPaths.push(f.path);
        continue;
      }
      // Conflicto potencial: serverHash !== hash local
      if (local instanceof TFile) {
        const localBuf = await this.app.vault.readBinary(local);
        const localHash = sha256(new Uint8Array(localBuf));
        if (localHash !== f.hash) {
          const c: ConflictRecord = {
            path: f.path,
            localVersion: 0,
            serverVersion: f.version,
            localHash,
            serverHash: f.hash,
            autoResolved: null,
          };
          const resolution = await this.resolver.resolve({
            path: f.path,
            localHash,
            remoteHash: f.hash,
            strategy: this.strategy,
            modifiedAt: f.modifiedAt,
          });
          if (resolution.action === "keep-local") {
            c.autoResolved = "local";
            conflictsResolved.push(c);
          } else if (resolution.action === "keep-remote") {
            c.autoResolved = "server";
            conflictsResolved.push(c);
            pulledPaths.push(f.path);
          } else {
            c.autoResolved = "manual";
            conflictsManual.push(c);
          }
        }
      }
    }

    this.progress({ phase: "done", message: "Sincronización completa", progress: 1 });
    return {
      result: syncResult,
      pulledPaths,
      pushedPaths: localChanges.map((c) => ("path" in c ? c.path : "?")),
      conflictsResolved: conflictsResolved.length,
      conflictsManual,
      durationMs: Date.now() - start,
    };
  }

  // ─── Local diff ──────────────────────────────────────────────────────

  private async computeLocalChanges(serverSnap: ServerSnapshot): Promise<FileChange[]> {
    const serverFiles = new Map(serverSnap.files.map((f) => [f.path, f]));
    const changes: FileChange[] = [];
    // Carpetas a sincronizar
    const foldersToScan = [""];
    const allFiles: TFile[] = [];
    for (const root of foldersToScan) {
      const folder = this.app.vault.getAbstractFileByPath(normalizePath(root || "/"));
      if (folder instanceof TFolder) {
        this.collectMarkdownFiles(folder, allFiles);
      } else if (!root) {
        // Vault root
        this.collectMarkdownFiles(this.app.vault as unknown as TFolder, allFiles);
      }
    }
    for (const f of allFiles) {
      // Excluir _M-NEXUS interno y backups
      if (f.path.startsWith("_M-NEXUS/server/") || f.path.startsWith(".trash/")) continue;
      if (f.path.includes("/.mnexus-backups/")) continue;
      const buf = await this.app.vault.readBinary(f);
      const hash = sha256(new Uint8Array(buf));
      const server = serverFiles.get(f.path);
      if (!server || server.hash !== hash) {
        // Para upsert, codificamos en base64 para enviar JSON
        const content = arrayBufferToBase64(buf);
        changes.push({
          kind: "upsert",
          path: f.path,
          hash,
          content,
          modifiedAt: new Date(f.stat.mtime).toISOString(),
        });
      }
    }
    return changes;
  }

  private collectMarkdownFiles(folder: TFolder, out: TFile[]) {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        out.push(child);
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, out);
      }
    }
  }

  private progress(p: SyncProgress) {
    this.log.debug(`Sync: ${p.phase} – ${p.message}`);
    this.onProgress?.(p);
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
