// Backup config service.
// v2.6.0: persistent config for rotation interval + remote command.
// Stored at data/backup-config.json (gitignored).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logOp } from "../utils/log.js";

export interface BackupConfig {
  intervalHours: number;     // 0 = disabled, 1-168
  keepDaily: number;         // number of daily backups to keep
  keepMonthly: number;       // additional monthly backups
  remoteCommand?: string;    // optional, runs after each backup. {} = backup path
}

const DEFAULT: BackupConfig = {
  intervalHours: 24,
  keepDaily: 30,
  keepMonthly: 12,
};

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}

function configFile(): string {
  return join(dataDir(), "backup-config.json");
}

let cache: BackupConfig | null = null;

export function getBackupConfig(): BackupConfig {
  if (cache) return cache;
  const f = configFile();
  if (!existsSync(f)) {
    cache = { ...DEFAULT };
    return cache;
  }
  try {
    const raw = readFileSync(f, "utf8");
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULT, ...parsed };
    return cache!;
  } catch {
    cache = { ...DEFAULT };
    return cache;
  }
}

export async function setBackupConfig(cfg: BackupConfig): Promise<void> {
  cache = cfg;
  await mkdir(dataDir(), { recursive: true });
  await writeFile(configFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  logOp("backup", `backup-config saved: interval=${cfg.intervalHours}h daily=${cfg.keepDaily} monthly=${cfg.keepMonthly}`, true, { hasRemote: !!cfg.remoteCommand });
}
