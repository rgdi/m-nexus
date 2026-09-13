// routes/sync.ts — sync simple de notas entre devices (last-write-wins).
// v0.62.17: persistencia en disco (data/sync.json). NO usa CRDT — es
// last-write-wins por timestamp frontmatter.lastModified.
//
// Endpoints:
//   POST /api/v1/notes/sync/pull  {since: ISO8601}
//       → {notes: [{path, content, lastModified, fmVersion}], serverTime}
//   POST /api/v1/notes/sync/push  {notes: [{path, content, lastModified, fmVersion}]}
//       → {accepted: [...], conflicts: [...], serverTime}
//
// Estrategia de conflictos:
//   - Si la nota del server tiene lastModified más reciente que la del
//     cliente, va a "conflicts" (no se acepta) y se devuelve al cliente.
//   - El cliente debe descargar la versión del server (resolver).
//
// Persistencia: sync.json con map<path, SyncEntry>. Se reescribe
// atómicamente.

import { FastifyInstance } from "fastify";
import { writeFile, readFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config.js";
import { logger, logOp } from "../utils/log.js";
import { safeCallAsync } from "../utils/safeCall.js";

interface SyncEntry {
  path: string;
  content: string;
  lastModified: string;
  fmVersion: number;
  updatedAt: number;
}

const STORE_FILE = join(process.env.SYNC_DATA_DIR || "./data", "sync.json");
let store: Record<string, SyncEntry> = {};
let loaded = false;

async function loadStore(): Promise<void> {
  if (loaded) return;
  try {
    if (existsSync(STORE_FILE)) {
      const raw = await readFile(STORE_FILE, "utf-8");
      store = JSON.parse(raw);
    } else {
      store = {};
    }
    loaded = true;
  } catch (e) {
    logger.warn({ component: "sync", err: String(e) }, "loadStore failed");
    store = {};
    loaded = true;
  }
}

async function saveStore(): Promise<void> {
  try {
    if (!existsSync(dirname(STORE_FILE))) {
      await mkdir(dirname(STORE_FILE), { recursive: true });
    }
    const tmp = STORE_FILE + ".tmp";
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
    await rename(tmp, STORE_FILE);
  } catch (e) {
    logger.error({ component: "sync", err: String(e) }, "saveStore failed");
  }
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  await loadStore();

  app.post<{
    Body: { since: string };
  }>("/api/v1/notes/sync/pull", async (req, reply) => {
    const result = await safeCallAsync({
      component: "sync",
      code: "EC-SYNC-001",
      message: "pull failed",
      op: async () => {
        const since = req.body?.since || new Date(0).toISOString();
        const sinceMs = Date.parse(since) || 0;
        const notes: SyncEntry[] = [];
        for (const [path, entry] of Object.entries(store)) {
          const t = Date.parse(entry.lastModified);
          if (t > sinceMs) {
            notes.push(entry);
          }
        }
        logOp("sync", `pull ${since} → ${notes.length}`);
        return { notes, serverTime: new Date().toISOString() };
      },
    });
    if (!result.success) {
      return reply.code(500).send({ error: result.error });
    }
    return result.value;
  });

  app.post<{
    Body: { notes: Array<{ path: string; content: string; lastModified: string; fmVersion?: number }> };
  }>("/api/v1/notes/sync/push", async (req, reply) => {
    const result = await safeCallAsync({
      component: "sync",
      code: "EC-SYNC-002",
      message: "push failed",
      op: async () => {
        const incoming = req.body?.notes || [];
        const accepted: SyncEntry[] = [];
        const conflicts: SyncEntry[] = [];
        const serverNow = new Date();

        for (const n of incoming) {
          const clientMs = Date.parse(n.lastModified) || 0;
          const existing = store[n.path];
          if (existing) {
            const serverMs = Date.parse(existing.lastModified) || 0;
            if (serverMs > clientMs) {
              conflicts.push(existing);
              continue;
            }
          }
          const entry: SyncEntry = {
            path: n.path,
            content: n.content,
            lastModified: n.lastModified,
            fmVersion: n.fmVersion || 1,
            updatedAt: serverNow.getTime(),
          };
          store[n.path] = entry;
          accepted.push(entry);
        }
        await saveStore();
        logOp("sync", `push incoming=${incoming.length} accepted=${accepted.length} conflicts=${conflicts.length}`);
        return {
          accepted,
          conflicts,
          serverTime: serverNow.toISOString(),
        };
      },
    });
    if (!result.success) {
      return reply.code(500).send({ error: result.error });
    }
    return result.value;
  });

  app.get("/api/v1/notes/sync/status", async (_req, reply) => {
    return {
      available: true,
      entries: Object.keys(store).length,
      serverTime: new Date().toISOString(),
    };
  });
}
