// Tipos compartidos del sistema servidor↔cliente.
// v0.6: protocolo basado en JSON sobre HTTPS, con cola offline persistente.
//
// Modelo: cada dispositivo (vault) tiene un deviceId estable y un token
// de autenticación. El servidor central conoce el estado por deviceId y
// mantiene un snapshot versionado que el cliente reconcilia bidireccionalmente.

export type ServerStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "offline"
  | "error";

export interface DeviceInfo {
  /** ID único estable del dispositivo (UUID v4 generado la primera vez). */
  deviceId: string;
  /** Nombre legible (ej. "MacBook Pro - Rodrigo"). */
  deviceName: string;
  /** Plataforma: macos, windows, linux, ios, android. */
  platform: string;
  /** Versión del plugin. */
  pluginVersion: string;
  /** Versión del protocolo. */
  protocolVersion: string;
}

export interface RegisterRequest extends DeviceInfo {
  /** Token de invitación (opcional si el servidor es self-hosted). */
  inviteToken?: string;
}

export interface RegisterResponse {
  /** Token de autenticación persistente. Guardar en disco. */
  authToken: string;
  /** Versión del servidor. */
  serverVersion: string;
  /** Si el servidor ya tenía estado para este device. */
  hasExistingState: boolean;
  /** Snapshot del estado conocido por el servidor (si hay). */
  snapshot?: ServerSnapshot;
}

export interface AuthCredentials {
  deviceId: string;
  authToken: string;
  serverUrl: string;
}

/** Snapshot versionado del estado del vault en el servidor. */
export interface ServerSnapshot {
  /** Versión del snapshot (monotónicamente creciente por device). */
  version: number;
  /** Última actualización (ISO). */
  updatedAt: string;
  /** Archivos conocidos por el servidor. */
  files: ServerFileEntry[];
  /** Flashcards aprobadas conocidas por el servidor. */
  approvedCards: ServerCardEntry[];
  /** Estado de backups en el servidor. */
  backups: ServerBackupEntry[];
}

export interface ServerFileEntry {
  path: string;
  /** Hash del contenido (sha256 hex). */
  hash: string;
  size: number;
  modifiedAt: string;
  /** Versión del archivo (monotónica). */
  version: number;
}

export interface ServerCardEntry {
  id: string;
  notePath: string;
  front: string;
  back: string;
  cardType: string;
  approvedAt: string;
}

export interface ServerBackupEntry {
  id: string;
  /** Cuándo se subió. */
  uploadedAt: string;
  size: number;
  /** Tipo: auto, manual, emergency. */
  kind: "auto" | "manual" | "emergency";
  /** Path/nombre del archivo en el vault. */
  vaultPath: string;
}

/** Cambio que el cliente quiere subir al servidor. */
export interface SyncDelta {
  /** Versión del snapshot del cliente (base). */
  baseVersion: number;
  files: FileChange[];
  cards: CardChange[];
  /** Timestamp del cliente. */
  clientTime: string;
}

export type FileChange =
  | { kind: "upsert"; path: string; hash: string; content: string; modifiedAt: string }
  | { kind: "delete"; path: string; modifiedAt: string };

export type CardChange =
  | { kind: "approve"; card: ServerCardEntry }
  | { kind: "reject"; cardId: string; reason?: string };

/** Resultado del sync. */
export interface SyncResult {
  /** Nueva versión del snapshot tras el sync. */
  newVersion: number;
  /** Conflictos encontrados. */
  conflicts: ConflictRecord[];
  /** Cambios que el servidor aplicó. */
  applied: number;
  /** Cambios rechazados. */
  rejected: number;
  /** Snapshot completo actualizado. */
  snapshot: ServerSnapshot;
}

export interface ConflictRecord {
  path: string;
  /** Versión local. */
  localVersion: number;
  /** Versión del servidor. */
  serverVersion: number;
  /** Hash local. */
  localHash: string;
  /** Hash del servidor. */
  serverHash: string;
  /** Resolución automática si fue posible. */
  autoResolved: "local" | "server" | "manual" | null;
}

export interface HeartbeatResponse {
  /** Versión del snapshot del servidor. */
  serverVersion: number;
  /** Si el cliente debe hacer pull. */
  needsPull: boolean;
  /** Mensaje opcional del servidor. */
  message?: string;
}

export interface BackupUploadRequest {
  /** v0.28: bytes del ZIP binario (en vez de base64-en-JSON, ~3x más rápido). */
  zipBytes: Uint8Array;
  /** Tipo. */
  kind: "auto" | "manual" | "emergency";
  /** Path original del archivo en el vault. */
  vaultPath: string;
  /** Comentario opcional. */
  note?: string;
  /** v0.28: número de archivos en el backup (metadata rápido sin descargar). */
  fileCount: number;
}

export interface BackupUploadResponse {
  id: string;
  size: number;
  uploadedAt: string;
  /** v0.28: bytes recibidos (eco). */
  receivedBytes: number;
  /** v0.28: cuánto tardó en el servidor (ms). */
  serverDurationMs: number;
}

export interface BackupListItem {
  id: string;
  uploadedAt: string;
  size: number;
  kind: "auto" | "manual" | "emergency";
  vaultPath: string;
  fileCount: number;
  note?: string;
  /** v0.28: SHA-256 del archivo (verificación de integridad). */
  sha256: string;
}

/** Mensaje genérico de error del servidor. */
export interface ServerError {
  code: string;
  message: string;
  retryAfter?: number;
}
