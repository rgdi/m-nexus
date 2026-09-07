// wormAudit.ts: Write-Once-Read-Many audit log con hash chain (Fase 6 security fix).
//
// v0.46: bug del auditor #7 — el audit log estaba en memoria, no era
// inmutable. Un atacante con acceso al server podia borrar sus huellas.
//
// Solución: append-only JSONL file + hash chain. Cada entry incluye
// el hash SHA-256 de la entry anterior, formando una cadena. Cualquier
// modificación (insertar/borrar/modificar) rompe el chain y se detecta
// en verifyChain().
//
// v0.46 limitations:
// - El file está en disco local. Para S3 Object Lock / GCS Bucket Lock
//   (compliance WORM real) hay que cambiar AuditBackend (interface).
// - Hash chain protege contra modificación local pero no contra root que
//   borra el archivo entero. Para eso, replicar a servidor externo
//   (CloudWatch, Datadog, S3 con Object Lock).
//
// Uso:
//   const log = new WormAuditLog("/var/log/mnexus/audit.jsonl");
//   log.append({ action: "auth.failed", deviceId: "abc", allowed: false });
//   const ok = log.verifyChain(); // true si nadie ha tocado el log

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

/** Entry que se almacena (incluye hash chain fields) */
export interface WormEntry {
  /** Hash SHA-256 de la entry anterior (hex). "0"*64 para genesis. */
  prevHash: string;
  /** Hash SHA-256 de esta entry (hex). Calculado al append. */
  hash: string;
  /** Sequence number monotónico. */
  seq: number;
  /** Timestamp ms */
  ts: number;
  /** Random nonce para que entradas idénticas tengan hashes distintos */
  nonce: string;
  /** Payload del evento */
  payload: Record<string, unknown>;
}

export class WormAuditLog {
  private filePath: string;
  private lastHash: string = "0".repeat(64);
  private lastSeq: number = 0;
  private readonly genesisHash = "0".repeat(64);

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureDirectory();
    this.loadLastEntry();
  }

  private ensureDirectory(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Carga la última entry para continuar el chain.
   * Si el archivo no existe o está vacío, arranca con seq=0.
   */
  private loadLastEntry(): void {
    if (!existsSync(this.filePath)) return;
    const content = readFileSync(this.filePath, "utf8").trim();
    if (content.length === 0) return;
    const lines = content.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) return;
    try {
      const last = JSON.parse(lines[lines.length - 1]) as WormEntry;
      this.lastHash = last.hash;
      this.lastSeq = last.seq;
    } catch {
      // Archivo corrupto: lo dejamos en genesis para no crashear
      this.lastHash = this.genesisHash;
      this.lastSeq = 0;
    }
  }

  /**
   * Calcula el hash de una entry (sin incluir el campo hash).
   */
  private computeHash(entry: Omit<WormEntry, "hash">): string {
    const data = JSON.stringify({
      prevHash: entry.prevHash,
      seq: entry.seq,
      ts: entry.ts,
      nonce: entry.nonce,
      payload: entry.payload,
    });
    return createHash("sha256").update(data).digest("hex");
  }

  /**
   * Append una entry al log. Retorna la entry completa con hash.
   *
   * IMPORTANTE: este método es el UNICO que escribe al file.
   * No hay updateEntry() / deleteEntry() público por diseño WORM.
   */
  append(payload: Record<string, unknown>): WormEntry {
    const entry: Omit<WormEntry, "hash"> = {
      prevHash: this.lastHash,
      seq: this.lastSeq + 1,
      ts: Date.now(),
      nonce: randomBytes(8).toString("hex"),
      payload,
    };
    const hash = this.computeHash(entry);
    const fullEntry: WormEntry = { ...entry, hash };

    // Append atómico a disco (JSONL: una línea por entry)
    appendFileSync(this.filePath, JSON.stringify(fullEntry) + "\n", { encoding: "utf8" });

    this.lastHash = hash;
    this.lastSeq = fullEntry.seq;
    return fullEntry;
  }

  /**
   * Lee todas las entries del log.
   */
  readAll(): WormEntry[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf8").trim();
    if (content.length === 0) return [];
    const lines = content.split("\n").filter((l) => l.length > 0);
    return lines.map((l) => {
      try {
        return JSON.parse(l) as WormEntry;
      } catch {
        // Entrada corrupta: retornamos marcador para que verifyChain la detecte
        return { corrupted: true, raw: l } as unknown as WormEntry;
      }
    });
  }

  /**
   * Verifica la integridad del chain.
   * Retorna { ok, brokenAt } donde brokenAt es el seq number de la primera entry corrupta.
   *
   * Detecta:
   * - Entradas modificadas (hash no matchea)
   * - Entradas borradas (seq no consecutivo)
   * - Entradas insertadas (prevHash no matchea)
   */
  verifyChain(): { ok: boolean; totalEntries: number; brokenAt?: number; reason?: string } {
    const entries = this.readAll();
    if (entries.length === 0) {
      return { ok: true, totalEntries: 0 };
    }
    let expectedPrevHash = this.genesisHash;
    let expectedSeq = 1;
    for (const e of entries) {
      if ((e as any).corrupted) {
        return { ok: false, totalEntries: entries.length, brokenAt: expectedSeq, reason: "corrupted_json" };
      }
      if (e.seq !== expectedSeq) {
        return { ok: false, totalEntries: entries.length, brokenAt: e.seq, reason: "seq_gap" };
      }
      if (e.prevHash !== expectedPrevHash) {
        return { ok: false, totalEntries: entries.length, brokenAt: e.seq, reason: "prev_hash_mismatch" };
      }
      const recomputed = this.computeHash({
        prevHash: e.prevHash,
        seq: e.seq,
        ts: e.ts,
        nonce: e.nonce,
        payload: e.payload,
      });
      if (recomputed !== e.hash) {
        return { ok: false, totalEntries: entries.length, brokenAt: e.seq, reason: "hash_mismatch" };
      }
      expectedPrevHash = e.hash;
      expectedSeq = e.seq + 1;
    }
    return { ok: true, totalEntries: entries.length };
  }

  /**
   * Stats: total entries, primer/último timestamp.
   */
  stats(): { totalEntries: number; firstTs?: number; lastTs?: number; fileSize: number } {
    const entries = this.readAll().filter((e) => !(e as any).corrupted);
    const fileSize = existsSync(this.filePath)
      ? readFileSync(this.filePath).length
      : 0;
    return {
      totalEntries: entries.length,
      firstTs: entries[0]?.ts,
      lastTs: entries[entries.length - 1]?.ts,
      fileSize,
    };
  }
}
