// Audit log: registra cada acceso a un endpoint por dispositivo.
// v0.12: privacy-first — solo el propio device puede ver su log, salvo admin.
// v0.46: persistencia WORM (Write-Once-Read-Many) con hash chain.
//        Bug auditor #7: antes era in-memory, un atacante podia borrar huellas.
//        Ahora se append a JSONL con hash SHA-256 de la entry anterior.
//        verifyChain() detecta cualquier modificacion, insercion o borrado.

import { join } from "node:path";
import { tmpdir } from "node:os";
import { WormAuditLog, type WormEntry } from "../utils/wormAudit.js";

export type AuditAction =
  | "register"
  | "auth.refresh"
  | "auth.revoke"
  | "auth.failed"
  | "audio.transcribe"
  | "audio.transcribe.failed"
  | "llm.chat"
  | "llm.chat.failed"
  | "llm.embed"
  | "ocr.image"
  | "ocr.failed"
  | "flashcards.generate"
  | "pdf.diff"
  | "backup.upload"
  | "backup.delete"
  | "backup.import"
  | "sync.push"
  | "ws.connect"
  | "ws.disconnect"
  | "ws.error"
  | "ws.rate_limited"
  | "e2e.decrypt.failed";

export interface AuditEntry {
  id: string;
  deviceId: string;
  action: AuditAction;
  /** Si la acción fue bloqueada por auth, queda false. */
  allowed: boolean;
  /** Detalles opcionales (sin PII). */
  meta?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  timestamp: number;
}

// v0.46: WORM audit log con hash chain en disco.
// Path configurable via env, default: /var/log/mnexus/audit.jsonl
// En dev/tests: usar tmpdir
function getDefaultAuditPath(): string {
  if (process.env.AUDIT_LOG_PATH) return process.env.AUDIT_LOG_PATH;
  if (process.env.NODE_ENV === "production") {
    return "/var/log/mnexus/audit.jsonl";
  }
  // dev/test: archivo temporal (v0.48: tmpdir se importa arriba, antes era require() que crasheaba en ESM)
  return join(tmpdir(), `mnexus-audit-${process.pid}.jsonl`);
}

let wormLog: WormAuditLog | null = null;
function getWormLog(): WormAuditLog {
  if (!wormLog) {
    wormLog = new WormAuditLog(getDefaultAuditPath());
  }
  return wormLog;
}

// v0.46: legacy in-memory log (deprecado, kept para backward compat en getAudit*)
const MAX_ENTRIES = 50_000;
const RETENTION_DAYS = 30;
const auditLog: AuditEntry[] = [];

export function audit(entry: Omit<AuditEntry, "id" | "timestamp">): void {
  // 1) Append WORM (persistente, inmutable)
  try {
    getWormLog().append({
      deviceId: entry.deviceId,
      action: entry.action,
      allowed: entry.allowed,
      meta: entry.meta,
      ip: entry.ip,
      userAgent: entry.userAgent,
    });
  } catch (e) {
    // Si falla el append a disco, logueamos pero NO crasheamos la app
    console.error("[AUDIT] WORM append failed:", e);
  }

  // 2) Legacy in-memory (para queries rapidas via getAudit*)
  auditLog.push({
    ...entry,
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  });
  // Poda por tamaño y edad
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  while (auditLog.length > 0 && (auditLog.length > MAX_ENTRIES || auditLog[0].timestamp < cutoff)) {
    auditLog.shift();
  }
}

export function getAuditForDevice(deviceId: string, limit = 100): AuditEntry[] {
  return auditLog.filter((e) => e.deviceId === deviceId).slice(-limit).reverse();
}

export function getAuditAll(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit).reverse();
}

export function getAuditStats() {
  return {
    total: auditLog.length,
    byAction: auditLog.reduce((acc, e) => {
      acc[e.action] = (acc[e.action] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}

// v0.46: API para verificar la integridad del log WORM
export function verifyAuditChain(): { ok: boolean; totalEntries: number; brokenAt?: number; reason?: string } {
  return getWormLog().verifyChain();
}

export function getWormAuditStats(): { totalEntries: number; firstTs?: number; lastTs?: number; fileSize: number } {
  return getWormLog().stats();
}

export function getWormAuditPath(): string {
  return getDefaultAuditPath();
}

/** v0.46: helper para tests — reset el singleton */
export function _resetWormLogForTest(): void {
  wormLog = null;
}

/** v0.46: lee las entries WORM (para admin) */
export function readWormAuditLog(): WormEntry[] {
  return getWormLog().readAll();
}
