// Audit log: registra cada acceso a un endpoint por dispositivo.
// Almacenado en memoria (en producción: persistir en DB o archivo JSONL).
// v0.12: privacy-first — solo el propio device puede ver su log, salvo admin.

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

const MAX_ENTRIES = 50_000;
const RETENTION_DAYS = 30;

const auditLog: AuditEntry[] = [];

export function audit(entry: Omit<AuditEntry, "id" | "timestamp">): void {
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
