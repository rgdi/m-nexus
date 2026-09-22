/* ============================================================
 * services/pdfCrdtSync.ts — Sincronización CRDT de entidades PDF
 *                            (highlights + occlusions) entre peers.
 *
 * v2.29.0 — Cross-device sync:
 *   - Mantiene un Yjs Doc por (deviceId, documentPath) que registra
 *     ops atómicos (create/update/delete) sobre highlights y oclusiones.
 *   - Los peers aplican updates binarios remotos (POST /sync/pdf/update)
 *     y consultan estado actual (GET /sync/pdf/state).
 *   - Política: last-writer-wins en ops con el mismo id, manteniendo
 *     historial por Lamport timestamp (clock del peer).
 *   - Persistencia: vault/.m-nexus-crdt/pdf-<hash>.bin (re-usa el mismo
 *     directorio del crdtSyncService para no fragmentar).
 *
 * API HTTP:
 *   GET  /api/v1/sync/pdf/state?documentPath=...
 *   POST /api/v1/sync/pdf/update { documentPath, update (base64), deviceId }
 *   GET  /api/v1/sync/pdf/log?documentPath=...&since=<lamport>
 * ============================================================ */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
import { logger, logOp } from "../utils/log.js";

const PERSISTENCE_DIR = join(process.cwd(), "vault", ".m-nexus-crdt");

interface RoomState {
  doc: Y.Doc;
  deviceIds: Set<string>;
  lastAccess: number;
  persistencePath: string;
  /** Lamport clock monotónico del room. */
  lamport: number;
}

class PdfCrdtSyncService {
  private rooms = new Map<string, RoomState>();
  private inMemoryState = new Map<string, { highlights: any[]; occlusions: any[] }>();

  private roomKey(documentPath: string): string {
    return `pdf-${createHash("sha1").update(documentPath).digest("hex").slice(0, 16)}`;
  }

  private async ensureRoom(documentPath: string): Promise<RoomState> {
    const key = this.roomKey(documentPath);
    let room = this.rooms.get(key);
    if (room) {
      room.lastAccess = Date.now();
      return room;
    }
    if (!existsSync(PERSISTENCE_DIR)) {
      mkdirSync(PERSISTENCE_DIR, { recursive: true });
    }
    const persistencePath = join(PERSISTENCE_DIR, `${key}.bin`);
    const doc = new Y.Doc();
    if (existsSync(persistencePath)) {
      try {
        const buf = await readFile(persistencePath);
        if (buf.length > 0) {
          Y.applyUpdate(doc, new Uint8Array(buf));
        }
      } catch (e) {
        logger.warn(`[pdf-crdt] failed to load room ${key}: ${e}`);
      }
    }
    room = {
      doc,
      deviceIds: new Set(),
      lastAccess: Date.now(),
      persistencePath,
      lamport: doc.getMap<number>("meta").get("lamport") ?? 0,
    };
    this.rooms.set(key, room);
    return room;
  }

  private async persistRoom(room: RoomState): Promise<void> {
    try {
      const buf = Y.encodeStateAsUpdate(room.doc);
      await writeFile(room.persistencePath, buf);
    } catch (e) {
      logger.error(`[pdf-crdt] persist failed: ${e}`);
    }
  }

  /**
   * Devuelve el estado actual del room: highlights y oclusiones como arrays JSON.
   * Si no hay room (sin updates remotos aún), carga del store local si existe.
   */
  async getState(documentPath: string): Promise<{ highlights: any[]; occlusions: any[]; lamport: number }> {
    const cached = this.inMemoryState.get(this.roomKey(documentPath));
    const room = await this.ensureRoom(documentPath);
    const highlightsMap = room.doc.getMap<any>("highlights");
    const occlusionsMap = room.doc.getMap<any>("occlusions");
    const highlights = Array.from(highlightsMap.values());
    const occlusions = Array.from(occlusionsMap.values());
    return {
      highlights: cached?.highlights ?? highlights,
      occlusions: cached?.occlusions ?? occlusions,
      lamport: room.lamport,
    };
  }

  /**
   * Aplica un update binario de un peer. Devuelve el state vector resultante.
   */
  async applyUpdate(documentPath: string, updateB64: string, deviceId: string): Promise<{ lamport: number; merged: number }> {
    const room = await this.ensureRoom(documentPath);
    room.deviceIds.add(deviceId);
    const update = Buffer.from(updateB64, "base64");
    let merged = 0;
    try {
      const before = Y.encodeStateVector(room.doc);
      Y.applyUpdate(room.doc, new Uint8Array(update));
      const after = Y.encodeStateVector(room.doc);
      // Bytes diff approximation
      merged = after.length - before.length;
      room.lamport += 1;
      room.doc.getMap<number>("meta").set("lamport", room.lamport);
      await this.persistRoom(room);
      logOp("pdf-sync", "apply_update", true, { documentPath, deviceId, mergedBytes: merged });
    } catch (e) {
      logOp("pdf-sync", "apply_update", false, { documentPath, deviceId, error: String(e) });
      throw e;
    }
    return { lamport: room.lamport, merged };
  }

  /**
   * Aplica una operación local sobre el room.
   * Esto lo llama el route handler cuando se crea/edita/borrar un highlight
   * u oclusión. La idea es que después de persistir en el storage local,
   * también se registra aquí para que otros peers puedan enterarse.
   */
  async applyLocalOp(
    documentPath: string,
    entity: "highlights" | "occlusions",
    op: "create" | "update" | "delete",
    payload: any,
  ): Promise<void> {
    const room = await this.ensureRoom(documentPath);
    const map = room.doc.getMap<any>(entity);
    const enriched = { ...payload, _lamport: room.lamport + 1, _op: op };
    if (op === "delete") {
      map.delete(payload.id);
    } else {
      map.set(payload.id, enriched);
    }
    room.lamport += 1;
    room.doc.getMap<number>("meta").set("lamport", room.lamport);
    await this.persistRoom(room);

    // Mantén cache local también (para listados cuando Yjs esté vacío).
    const key = this.roomKey(documentPath);
    const cur = this.inMemoryState.get(key) ?? { highlights: [], occlusions: [] };
    if (op === "delete") {
      cur[entity] = cur[entity].filter((x: any) => x.id !== payload.id);
    } else {
      const idx = cur[entity].findIndex((x: any) => x.id === payload.id);
      if (idx >= 0) cur[entity][idx] = enriched;
      else cur[entity].push(enriched);
    }
    this.inMemoryState.set(key, cur);
  }

  /** Lista los devices que han tocado este room. */
  async listDevices(documentPath: string): Promise<string[]> {
    const room = await this.ensureRoom(documentPath);
    return Array.from(room.deviceIds);
  }

  /** Stats globales del servicio. */
  stats(): { rooms: number; totalDevices: number } {
    let totalDevices = 0;
    for (const room of this.rooms.values()) totalDevices += room.deviceIds.size;
    return { rooms: this.rooms.size, totalDevices };
  }

  /** Snapshot con operaciones nuevas desde un lamport dado. */
  async getLogSince(documentPath: string, since: number): Promise<{ highlights: any[]; occlusions: any[]; lamport: number }> {
    const state = await this.getState(documentPath);
    const sinceN = Number.isFinite(since) ? since : 0;
    return {
      highlights: state.highlights.filter((h: any) => (h._lamport ?? 0) > sinceN),
      occlusions: state.occlusions.filter((o: any) => (o._lamport ?? 0) > sinceN),
      lamport: state.lamport,
    };
  }

  /** Generate an op ID for testing. */
  newOpId(): string {
    return `op-${randomUUID()}`;
  }
}

export const pdfCrdtSync = new PdfCrdtSyncService();

/** Reset all rooms + in-memory state. Test-only helper. */
export function pdfCrdtReset(): void {
  // Drop any persistence files (test isolation)
  try {
    const { readdirSync, unlinkSync } = require("node:fs");
    if (existsSync(PERSISTENCE_DIR)) {
      for (const f of readdirSync(PERSISTENCE_DIR)) {
        if (f.startsWith("pdf-")) {
          try { unlinkSync(join(PERSISTENCE_DIR, f)); } catch {}
        }
      }
    }
  } catch {}
  (pdfCrdtSync as any).rooms = new Map();
  (pdfCrdtSync as any).inMemoryState = new Map();
}
