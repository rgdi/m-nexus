// crdtSyncService.ts: sincronizacion CRDT de notas con Yjs.
//
// v0.51: usa Yjs para sync fino entre clientes. Cada "room" es una nota
// identificada por path relativo al vault. Los updates binarios se
// almacenan en vault/.m-nexus-crdt/<noteHash>.bin y se sirven via
// WebSocket + REST fallback.
//
// API:
//   crdtDoc(room): { applyUpdate, getState, onUpdate }
//   httpHandlers: GET /state, POST /update
//
// Los updates son binarios (Uint8Array) de Yjs encodeStateAsUpdate.

import { readFile, writeFile, mkdir, stat, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import * as Y from "yjs";
import { createHash } from "node:crypto";
import { logger, logOp, logNetwork } from "../utils/log.js";

interface RoomState {
  doc: Y.Doc;
  clients: Set<string>; // client IDs conectados
  lastAccess: number;
  dirty: boolean;
  persistencePath: string;
}

class CrdtSyncService {
  private rooms = new Map<string, RoomState>();
  private persistenceDir: string;

  constructor(persistenceDir: string) {
    this.persistenceDir = persistenceDir;
  }

  /** v0.51: hash deterministico del nombre de la nota para el path del room. */
  private roomKey(notePath: string): string {
    return createHash("sha1").update(notePath).digest("hex").slice(0, 16);
  }

  /** v0.51: carga (o crea) un room para una nota. */
  async getOrCreateRoom(notePath: string): Promise<RoomState> {
    const key = this.roomKey(notePath);
    let room = this.rooms.get(key);
    if (room) {
      room.lastAccess = Date.now();
      return room;
    }
    if (!existsSync(this.persistenceDir)) {
      await mkdir(this.persistenceDir, { recursive: true });
    }
    const persistencePath = join(this.persistenceDir, `${key}.bin`);
    const doc = new Y.Doc();
    // Cargar estado persistido si existe
    if (existsSync(persistencePath)) {
      try {
        const buf = await readFile(persistencePath);
        if (buf.length > 0) {
          Y.applyUpdate(doc, new Uint8Array(buf));
          logOp("crdt", "room loaded", true, { key, bytes: buf.length });
        }
      } catch (e) {
        logger.warn(`[crdt] failed to load room ${key}: ${e}`);
      }
    }
    room = {
      doc,
      clients: new Set(),
      lastAccess: Date.now(),
      dirty: false,
      persistencePath,
    };
    this.rooms.set(key, room);
    // Persistir en cada update
    doc.on("update", (_update: Uint8Array, origin: unknown) => {
      room!.dirty = true;
      // Debounce persist
      this.schedulePersist(key);
      // Si el origin es un cliente, propagar a otros
      if (typeof origin === "string" && origin.startsWith("client:")) {
        // Esto lo maneja el WebSocket handler
      }
    });
    return room;
  }

  private persistTimers = new Map<string, NodeJS.Timeout>();

  /** v0.51: debounced persist (1s). */
  private schedulePersist(key: string): void {
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.persistRoom(key).catch((e) => {
        logger.warn(`[crdt] persist failed for ${key}: ${e}`);
      });
    }, 1000);
    this.persistTimers.set(key, t);
  }

  /** v0.51: flush a disco. */
  async persistRoom(key: string): Promise<void> {
    const room = this.rooms.get(key);
    if (!room) return;
    const state = Y.encodeStateAsUpdate(room.doc);
    if (state.byteLength === 0) return; // doc vacio
    await writeFile(room.persistencePath, state);
    room.dirty = false;
    room.lastAccess = Date.now();
    logOp("crdt", "room persisted", true, { key, bytes: state.byteLength });
  }

  /** v0.51: aplica un update binario a un room. */
  async applyUpdate(notePath: string, update: Uint8Array, origin: string = "client:http"): Promise<void> {
    const room = await this.getOrCreateRoom(notePath);
    Y.applyUpdate(room.doc, update, origin);
    room.lastAccess = Date.now();
  }

  /** v0.51: serializa el estado completo. */
  async getState(notePath: string): Promise<Uint8Array> {
    const room = await this.getOrCreateRoom(notePath);
    return Y.encodeStateAsUpdate(room.doc);
  }

  /** v0.51: diff entre dos updates (no usado directamente pero util). */
  diffStates(stateA: Uint8Array, stateB: Uint8Array): number {
    // Naive: cuenta bytes diferentes. Yjs no da diff directo.
    const a = Buffer.from(stateA);
    const b = Buffer.from(stateB);
    const len = Math.min(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) diff++;
    return diff + Math.abs(a.length - b.length);
  }

  /** v0.51: lista los rooms activos. */
  listRooms(): Array<{ key: string; clients: number; dirty: boolean; lastAccess: number }> {
    return Array.from(this.rooms.entries()).map(([key, r]) => ({
      key,
      clients: r.clients.size,
      dirty: r.dirty,
      lastAccess: r.lastAccess,
    }));
  }

  /** v0.51: cleanup rooms inactivos (>5min sin acceso y sin clientes). */
  async cleanup(maxAgeMs: number = 5 * 60 * 1000): Promise<number> {
    const now = Date.now();
    const toRemove: string[] = [];
    for (const [key, r] of this.rooms) {
      if (r.clients.size === 0 && now - r.lastAccess > maxAgeMs) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      const r = this.rooms.get(key);
      if (r?.dirty) await this.persistRoom(key);
      this.rooms.delete(key);
    }
    return toRemove.length;
  }

  /** v0.51: stats de almacenamiento. */
  async storageStats(): Promise<{ rooms: number; totalBytes: number; byRoom: Array<{ key: string; bytes: number }> }> {
    if (!existsSync(this.persistenceDir)) {
      return { rooms: 0, totalBytes: 0, byRoom: [] };
    }
    const files = await readdir(this.persistenceDir).catch(() => [] as string[]);
    let total = 0;
    const byRoom: Array<{ key: string; bytes: number }> = [];
    for (const f of files) {
      if (!f.endsWith(".bin")) continue;
      const s = await stat(join(this.persistenceDir, f));
      total += s.size;
      byRoom.push({ key: f.replace(".bin", ""), bytes: s.size });
    }
    byRoom.sort((a, b) => b.bytes - a.bytes);
    return { rooms: files.length, totalBytes: total, byRoom: byRoom.slice(0, 20) };
  }

  /** v0.51: elimina un room (cuando se borra la nota). */
  async removeRoom(notePath: string): Promise<void> {
    const key = this.roomKey(notePath);
    const room = this.rooms.get(key);
    if (room) {
      if (room.dirty) await this.persistRoom(key);
      room.doc.destroy();
      this.rooms.delete(key);
    }
    if (existsSync(this.persistenceDir)) {
      const path = join(this.persistenceDir, `${key}.bin`);
      if (existsSync(path)) {
        await unlink(path);
      }
    }
  }
}

// Singleton
let _instance: CrdtSyncService | null = null;

export function getCrdtSyncService(persistenceDir: string): CrdtSyncService {
  if (!_instance) {
    _instance = new CrdtSyncService(persistenceDir);
  }
  return _instance;
}

export { CrdtSyncService };
