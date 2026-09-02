// Registro persistente de AudioRecord (en .obsidian/plugins/m-nexus/data.json).
// CRUD completo: register, list, get, update, findBySubject, findByDateRange, findByStatus.

import { App } from "obsidian";
import { AudioRecord, MNexusSettings } from "../types";

export class AudioRegistry {
  private storage: AudioRecord[] = [];

  constructor(private app: App, private settings: MNexusSettings) {}

  load(records: AudioRecord[]) {
    this.storage = records ?? [];
  }

  serialize(): AudioRecord[] {
    return this.storage;
  }

  /** Añade un audio al registro. */
  async add(record: AudioRecord): Promise<void> {
    this.storage.push(record);
  }

  /** Alias: add como register para compatibilidad. */
  async register(record: AudioRecord): Promise<void> {
    return this.add(record);
  }

  /** Lista todos los audios. */
  list(): AudioRecord[] {
    return [...this.storage];
  }

  /** Obtiene un audio por id. */
  get(id: string): AudioRecord | undefined {
    return this.storage.find((r) => r.id === id);
  }

  /** Actualiza un audio por id. */
  update(id: string, patch: Partial<AudioRecord>): boolean {
    const r = this.storage.find((x) => x.id === id);
    if (!r) return false;
    Object.assign(r, patch);
    return true;
  }

  /** Filtra por subject. */
  findBySubject(subject: string): AudioRecord[] {
    return this.storage.filter((r) => r.subject === subject);
  }

  /** Filtra por rango de fechas. */
  findByDateRange(fromMs: number, toMs: number): AudioRecord[] {
    return this.storage.filter((r) => {
      // v0.28: prefiere recordedAt (ms) si existe, sino deriva de createdAt (string ISO).
      const t = r.recordedAt ?? (r.createdAt ? new Date(r.createdAt).getTime() : 0);
      return t >= fromMs && t <= toMs;
    });
  }

  /** Filtra por estado. Acepta tanto `state` (oficial) como `status` (alias legacy). */
  findByStatus(status: string): AudioRecord[] {
    return this.storage.filter((r) => r.state === status || (r as any).status === status);
  }

  /** Audios sin asignar (inbox). */
  inbox(): AudioRecord[] {
    return this.storage.filter((r) => r.state === "inbox" || !r.targetNotePath);
  }

  /** Marca como vinculado a una nota. */
  markLinked(id: string, notePath: string): void {
    this.update(id, { state: "linked", targetNotePath: notePath });
  }
}
