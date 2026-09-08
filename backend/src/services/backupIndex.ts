// BackupIndex: índice SQLite de los backups subidos.
//
// v0.28: usa `node:sqlite` built-in (Node 22+). Zero-dependency.
// Un archivo .db por servidor — drag-and-drop friendly.
//
// Implementación: import dinámico para evitar que vite (en tests) falle
// al resolver `node:sqlite` (que es experimental). En runtime Node 22+
// funciona directamente.

import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

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
  // Estrategia en cascada:
  //   1) node:sqlite (built-in en Node 22+, zero-deps)
  //   2) sqlite (npm package opcional, pnpm install sqlite)
  //   3) better-sqlite3 (npm dep ya declarada) — si el binding nativo es
  //      compatible con el runtime de Node actual
  //
  // v0.47.11: Antes de este fix, si ninguna opción estaba disponible el código
  // lanzaba un error genérico que se traducía en HTTP 500 sin contexto.
  // Ahora probamos cada alternativa y reportamos el motivo exacto del fallo.
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const attempts: string[] = [];
  // 1) built-in node:sqlite (Node 22+)
  try {
    const mod = req("node:sqlite");
    if (mod && typeof mod.DatabaseSync === "function") {
      return mod as { DatabaseSync: new (path: string) => SqliteDatabase };
    }
    attempts.push("node:sqlite: DatabaseSync no exportado");
  } catch (e1) {
    attempts.push(`node:sqlite: ${(e1 as Error).message}`);
  }
  // 2) optional `sqlite` package
  try {
    const mod = req("sqlite");
    if (mod && typeof mod.DatabaseSync === "function") {
      return mod as { DatabaseSync: new (path: string) => SqliteDatabase };
    }
    attempts.push("sqlite package: DatabaseSync no exportado");
  } catch (e2) {
    attempts.push(`sqlite package: ${(e2 as Error).message}`);
  }
  // 3) better-sqlite3 fallback
  try {
    const mod = req("better-sqlite3");
    const Database = (mod as { Database?: new (p: string) => unknown }).Database;
    if (typeof Database !== "function") {
      attempts.push("better-sqlite3: Database no es constructor");
    } else {
      // Adapter: better-sqlite3 expone `new Database(path)` (sin Sync)
      // y `prepare(...).run/get/all` síncronos. Mapeamos al contrato
      // `DatabaseSync` que espera el caller de este módulo.
      const adapter = {
        DatabaseSync: class DatabaseSync {
          private readonly db: {
            exec(sql: string): void;
            prepare(sql: string): SqliteStatement;
            close(): void;
          };
          constructor(filePath: string) {
            const DatabaseCtor = Database as new (p: string) => unknown;
            const inst = new DatabaseCtor(filePath) as {
              exec(sql: string): void;
              prepare(sql: string): {
                run(...p: unknown[]): unknown;
                get(...p: unknown[]): unknown;
                all(...p: unknown[]): unknown[];
              };
              close(): void;
            };
            this.db = {
              exec: (sql) => inst.exec(sql),
              prepare: (sql) => {
                const stmt = inst.prepare(sql);
                return {
                  run: (...p) => { stmt.run(...p); },
                  get: (...p) => stmt.get(...p),
                  all: (...p) => stmt.all(...p),
                };
              },
              close: () => inst.close(),
            };
          }
          exec(sql: string) { this.db.exec(sql); }
          prepare(sql: string) { return this.db.prepare(sql); }
          close() { this.db.close(); }
        } as unknown as new (path: string) => SqliteDatabase,
      };
      return adapter;
    }
  } catch (e3) {
    attempts.push(`better-sqlite3: ${(e3 as Error).message}`);
  }
  throw new Error(
    `Ningún backend SQLite funcional. Runtime: ${process.version}. Intentos: ${attempts.join(" | ")}`
  );
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
      await safeCallAsync({
        component: "bk",
        code: "EC-BK-002",
        message: "backupIndex.insert failed",
        context: { id: row.id, deviceId: row.deviceId, size: row.size },
        op: async () => {
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
          logOp("bk", "insert", true, { id: row.id, deviceId: row.deviceId });
        },
      });
    },
    async get(deviceId: string, id: string) {
      const r = await safeCallAsync<BackupRow | null>({
        component: "bk",
        code: "EC-BK-003",
        message: "backupIndex.get failed",
        context: { deviceId, id },
        op: async () => getStmt.get(deviceId, id) as BackupRow | null,
      });
      return r.value ?? null;
    },
    async listForDevice(deviceId: string) {
      const r = await safeCallAsync<BackupListItem[]>({
        component: "bk",
        code: "EC-BK-004",
        message: "backupIndex.listForDevice failed",
        context: { deviceId },
        op: async () => listStmt.all(deviceId) as unknown as BackupListItem[],
      });
      return r.value ?? [];
    },
    async delete(deviceId: string, id: string) {
      await safeCallAsync({
        component: "bk",
        code: "EC-BK-005",
        message: "backupIndex.delete failed",
        context: { deviceId, id },
        op: async () => {
          deleteStmt.run(deviceId, id);
          logOp("bk", "delete", true, { id, deviceId });
        },
      });
    },
    close() {
      db.close();
    },
  };
}
