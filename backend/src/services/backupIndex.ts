// BackupIndex: índice SQLite de los backups subidos.
//
// v0.28: usa `node:sqlite` built-in (Node 22+). Zero-dependency.
// Un archivo .db por servidor — drag-and-drop friendly.
//
// Implementación: import dinámico para evitar que vite (en tests) falle
// al resolver `node:sqlite` (que es experimental). En runtime Node 22+
// funciona directamente.

export interface BackupRow {
  id: string;
  deviceId: string;
  uploadedAt: string;
  size: number;
  kind: "auto" | "manual" | "emergency" | "imported";
  vaultPath: string;
  note?: string;
  fileCount: number;
  sha256: string;
  storagePath: string;
}

export interface BackupListItem {
  id: string;
  uploadedAt: string;
  size: number;
  kind: "auto" | "manual" | "emergency";
  vaultPath: string;
  fileCount: number;
  note?: string;
  sha256: string;
}

export interface BackupIndex {
  insert(row: BackupRow): Promise<void>;
  get(deviceId: string, id: string): Promise<BackupRow | null>;
  listForDevice(deviceId: string): Promise<BackupListItem[]>;
  delete(deviceId: string, id: string): Promise<void>;
  close(): void;
}

interface SqliteStatement {
  run(...params: unknown[]): void;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/**
 * Carga el módulo sqlite. En Node 22+ runtime, funciona con `node:sqlite`
 * (cargado via createRequire para evitar problemas de resolución en Vite).
 */
async function loadSqlite(): Promise<{
  DatabaseSync: new (path: string) => SqliteDatabase;
}> {
  // createRequire permite cargar módulos built-in de Node sin que el bundler
  // (Vite) intente resolverlos. Esto es compatible con Node 22+ runtime
  // y con tests que usan Vite como test runner.
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  try {
    const mod = req("node:sqlite");
    return mod as { DatabaseSync: new (path: string) => SqliteDatabase };
  } catch (e1) {
    try {
      const mod = req("sqlite");
      return mod as { DatabaseSync: new (path: string) => SqliteDatabase };
    } catch (e2) {
      throw new Error(
        `node:sqlite no disponible. Node 22+ requerido (Runtime: ${process.version}). ` +
        `Error 1: ${(e1 as Error).message}. Error 2: ${(e2 as Error).message}`
      );
    }
  }
}

export async function openBackupIndex(path: string): Promise<BackupIndex> {
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      uploadedAt TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      vaultPath TEXT NOT NULL,
      note TEXT,
      fileCount INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      storagePath TEXT NOT NULL,
      PRIMARY KEY (deviceId, id)
    );
    CREATE INDEX IF NOT EXISTS idx_device_uploaded
      ON backups(deviceId, uploadedAt DESC);
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO backups
      (id, deviceId, uploadedAt, size, kind, vaultPath, note, fileCount, sha256, storagePath)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getStmt = db.prepare(`
    SELECT * FROM backups WHERE deviceId = ? AND id = ?
  `);
  const listStmt = db.prepare(`
    SELECT id, uploadedAt, size, kind, vaultPath, fileCount, note, sha256
    FROM backups
    WHERE deviceId = ?
    ORDER BY uploadedAt DESC
  `);
  const deleteStmt = db.prepare(`
    DELETE FROM backups WHERE deviceId = ? AND id = ?
  `);

  return {
    async insert(row: BackupRow) {
      insertStmt.run(
        row.id,
        row.deviceId,
        row.uploadedAt,
        row.size,
        row.kind,
        row.vaultPath,
        row.note ?? null,
        row.fileCount,
        row.sha256,
        row.storagePath
      );
    },
    async get(deviceId: string, id: string) {
      const r = getStmt.get(deviceId, id);
      return (r as BackupRow) ?? null;
    },
    async listForDevice(deviceId: string) {
      const rows = listStmt.all(deviceId);
      return rows as unknown as BackupListItem[];
    },
    async delete(deviceId: string, id: string) {
      deleteStmt.run(deviceId, id);
    },
    close() {
      db.close();
    },
  };
}
