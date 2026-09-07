// syncService.ts: CRDT-based sync via Yjs (Fase 4).
//
// v0.46: implementa sync de notas usando Yjs (CRDT).
// Cada cliente tiene un Y.Doc que representa el vault.
// Sync: merge de Y.Doc remoto con local usando Y.encodeStateAsUpdate.
//
// Diseño:
//   - Y.Doc contiene:
//     * Y.Map "notes": notePath -> Y.Map { title, content, tags, fsrsState, ... }
//     * Y.Array "events": log de eventos para audit/undo
//   - Vector clocks: clientID + clock se gestionan automáticamente por Yjs
//   - E2E encryption: en el cliente (no en backend) — backend solo ve ciphertext

import * as Y from "yjs";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export interface SyncState {
  /** Vector base64 del state */
  state: string;
  /** Vector base64 del state vector conocido por el cliente (lo que ya tiene) */
  stateVector: string;
  /** Timestamp (ms) del update */
  timestamp: number;
  /** ClientID que generó este update */
  clientId: number;
}

export interface NoteEntry {
  path: string;
  title: string;
  content: string;
  tags: string[];
  /** FSRS state (opcional, serializado) */
  fsrsState?: string;
  updatedAt: number;
}

export class SyncService {
  private doc: Y.Doc;
  private notes: Y.Map<Y.Map<unknown>>;
  private events: Y.Array<unknown>;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.notes = this.doc.getMap<Y.Map<unknown>>("notes");
    this.events = this.doc.getArray<unknown>("events");
  }

  /**
   * Crea un SyncService nuevo a partir de un state.
   */
  static fromState(stateBase64: string): SyncService {
    const doc = new Y.Doc();
    if (stateBase64.length > 0) {
      const update = Buffer.from(stateBase64, "base64");
      Y.applyUpdate(doc, update);
    }
    return new SyncService(doc);
  }

  /**
   * Crea/actualiza una nota.
   */
  upsertNote(note: NoteEntry): void {
    let entry = this.notes.get(note.path);
    if (!entry) {
      entry = new Y.Map();
      this.notes.set(note.path, entry);
    }
    entry.set("title", note.title);
    entry.set("content", note.content);
    entry.set("tags", JSON.stringify(note.tags));
    if (note.fsrsState) entry.set("fsrsState", note.fsrsState);
    entry.set("updatedAt", note.updatedAt);
  }

  /**
   * Obtiene una nota.
   */
  getNote(path: string): NoteEntry | null {
    const entry = this.notes.get(path);
    if (!entry) return null;
    return SyncService.entryToNote(path, entry);
  }

  /**
   * Lista todas las notas.
   */
  listNotes(): NoteEntry[] {
    const result: NoteEntry[] = [];
    for (const [path, entry] of this.notes) {
      result.push(SyncService.entryToNote(path, entry));
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Elimina una nota.
   */
  removeNote(path: string): boolean {
    const existed = this.notes.has(path);
    this.notes.delete(path);
    return existed;
  }

  /**
   * Registra un evento en el log.
   */
  logEvent(event: { type: string; path?: string; meta?: Record<string, unknown> }): void {
    this.events.push([
      {
        type: event.type,
        path: event.path,
        meta: event.meta ?? {},
        ts: Date.now(),
        client: this.doc.clientID,
      },
    ]);
  }

  /**
   * Obtiene el state actual.
   */
  getState(): SyncState {
    return {
      state: Buffer.from(Y.encodeStateAsUpdate(this.doc)).toString("base64"),
      stateVector: Buffer.from(Y.encodeStateVector(this.doc)).toString("base64"),
      timestamp: Date.now(),
      clientId: this.doc.clientID,
    };
  }

  /**
   * Aplica un update remoto.
   */
  applyRemoteUpdate(remoteStateBase64: string): void {
    if (remoteStateBase64.length === 0) return;
    const update = Buffer.from(remoteStateBase64, "base64");
    Y.applyUpdate(this.doc, update);
  }

  /**
   * Calcula el diff entre dos states.
   * Útil para sync incremental.
   */
  static diff(remoteStateBase64: string, localStateBase64: string): string {
    const remote = new Uint8Array(Buffer.from(remoteStateBase64, "base64"));
    const local = new Uint8Array(Buffer.from(localStateBase64, "base64"));
    // diff = remote update que NO está en local
    // Para esto, decodificamos el remote state vector del local
    // y pedimos los updates que el local no tiene
    // (simplificado: retornamos el remote entero)
    return Buffer.from(remote).toString("base64");
  }

  private static entryToNote(path: string, entry: Y.Map<unknown>): NoteEntry {
    return {
      path,
      title: (entry.get("title") as string) ?? "",
      content: (entry.get("content") as string) ?? "",
      tags: JSON.parse((entry.get("tags") as string) ?? "[]"),
      fsrsState: entry.get("fsrsState") as string | undefined,
      updatedAt: (entry.get("updatedAt") as number) ?? 0,
    };
  }
}

/**
 * Encryption helper para E2E (Fase 4).
 * El backend NUNCA ve el contenido en claro. Solo almacena ciphertext.
 * El cliente cifra con AES-256-GCM y la key nunca sale del cliente.
 *
 * Diseño de key derivation:
 *   - password + salt -> PBKDF2 -> masterKey
 *   - masterKey + noteId -> derivedKey (per-note)
 *   - derivedKey + nonce -> ciphertext + authTag
 */
export class E2EEncryption {
  /** PBKDF2 iterations (alto para resistencia offline) */
  static readonly PBKDF2_ITERATIONS = 200000;
  static readonly KEY_LENGTH = 32; // 256 bits
  static readonly SALT_LENGTH = 16;
  static readonly NONCE_LENGTH = 12;
  static readonly TAG_LENGTH = 16;

  /**
   * Deriva una key de 256 bits desde una password.
   */
  static deriveKey(password: string, salt: Buffer): Buffer {
    // Implementación pura de Node (sin importar módulo completo)
    // Para tests, podemos usar createHash como fallback
    // pero en producción usamos scrypt
    const { scryptSync } = require("node:crypto") as typeof import("node:crypto");
    return scryptSync(password, salt, E2EEncryption.KEY_LENGTH);
  }

  /**
   * Genera un salt aleatorio.
   */
  static generateSalt(): Buffer {
    return randomBytes(E2EEncryption.SALT_LENGTH);
  }

  /**
   * Cifra un texto.
   * Devuelve: salt + nonce + ciphertext + authTag, todo en un solo buffer
   */
  static encrypt(plaintext: string, key: Buffer): string {
    const nonce = randomBytes(E2EEncryption.NONCE_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const result = Buffer.concat([nonce, encrypted, tag]);
    return result.toString("base64");
  }

  /**
   * Descifra un texto.
   */
  static decrypt(ciphertextBase64: string, key: Buffer): string {
    const data = Buffer.from(ciphertextBase64, "base64");
    const nonce = data.subarray(0, E2EEncryption.NONCE_LENGTH);
    const tag = data.subarray(data.length - E2EEncryption.TAG_LENGTH);
    const encrypted = data.subarray(E2EEncryption.NONCE_LENGTH, data.length - E2EEncryption.TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  /**
   * Hash determinístico para key lookup (no para passwords).
   */
  static hashKey(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }
}
