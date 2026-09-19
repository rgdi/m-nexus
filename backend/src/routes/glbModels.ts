// glbModels.ts — User-uploaded .glb model routes (v2.16.0).
//
// Allows users to import their own anatomical models into the 3D viewer.
// Flow:
//   1. POST /api/v1/models/upload   → multipart/form-data with 'file' field → returns {id, url, size}
//      The uploaded file is saved under public/models/user/<id>.glb.
//   2. GET  /api/v1/models          → list user-uploaded + built-in models.
//   3. DELETE /api/v1/models/:id    → remove user-uploaded model (built-ins protected).
//
// Built-in models (animal_cell.glb, plant_cell.glb, bacterium.glb) cannot be deleted.

import { FastifyInstance } from "fastify";
import { writeFile, readdir, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";

const BUILTIN_MODELS = new Set(["animal_cell.glb", "plant_cell.glb", "bacterium.glb"]);
const USER_DIR = "public/models/user";

function dataRoot(): string {
  return process.env.DATA_DIR
    ? join(process.env.DATA_DIR, "..", "public", "models", "user")
    : join(process.cwd(), USER_DIR);
}

function publicUrlPath(filename: string): string {
  return `/models/user/${filename}`;
}

async function ensureDir(): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const dir = dataRoot();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".gitkeep"), "");
  }
}

export async function glbModelsRoutes(app: FastifyInstance): Promise<void> {
  await ensureDir();

  app.post("/api/v1/models/upload", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });
    if (extname(file.filename).toLowerCase() !== ".glb") {
      return reply.code(415).send({ error: "Only .glb files accepted" });
    }
    // Quick magic-byte check: GLB starts with 'glTF' (4 bytes ASCII).
    const buf = await file.toBuffer();
    if (buf.byteLength < 12 || buf.slice(0, 4).toString("ascii") !== "glTF") {
      return reply.code(400).send({ error: "Invalid GLB header (expected 'glTF' magic)" });
    }

    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const safeBase = basename(file.filename, ".glb")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 32);
    const storedName = `${safeBase}-${id}.glb`;
    const dest = join(dataRoot(), storedName);
    await writeFile(dest, buf);

    return reply.code(201).send({
      id,
      filename: storedName,
      url: publicUrlPath(storedName),
      displayName: safeBase,
      size: buf.byteLength,
      builtin: false,
    });
  });

  app.get("/api/v1/models", async () => {
    const dir = dataRoot();
    let files: Array<{ filename: string; url: string; size: number; builtin: boolean; mtime: number }> = [];
    for (const f of BUILTIN_MODELS) {
      const fp = join(process.cwd(), "public", "models", f);
      if (existsSync(fp)) {
        const s = await stat(fp);
        files.push({
          filename: f,
          url: `/models/${f}`,
          size: s.size,
          builtin: true,
          mtime: s.mtimeMs,
        });
      }
    }
    if (existsSync(dir)) {
      const userFiles = await readdir(dir);
      for (const f of userFiles) {
        if (!f.endsWith(".glb")) continue;
        const fp = join(dir, f);
        const s = await stat(fp);
        files.push({
          filename: f,
          url: publicUrlPath(f),
          size: s.size,
          builtin: false,
          mtime: s.mtimeMs,
        });
      }
    }
    files.sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
      return b.mtime - a.mtime;
    });
    return { models: files, total: files.length };
  });

  app.delete<{ Params: { filename: string } }>("/api/v1/models/:filename", async (req, reply) => {
    const name = basename(req.params.filename);
    if (BUILTIN_MODELS.has(name)) {
      return reply.code(403).send({ error: "Built-in models are protected" });
    }
    if (!name.endsWith(".glb")) {
      return reply.code(400).send({ error: "Invalid filename" });
    }
    const fp = join(dataRoot(), name);
    if (!existsSync(fp)) {
      return reply.code(404).send({ error: "Not found" });
    }
    await unlink(fp);
    return { ok: true, deleted: name };
  });
}
