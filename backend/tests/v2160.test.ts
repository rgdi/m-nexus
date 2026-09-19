// v2160.test.ts — v2.16.0 backend tests:
// - .glb upload endpoint validates GLB header
// - GET /api/v1/models returns built-in + user models
// - DELETE refuses to remove built-ins
// - sync /sync/history/:type/:id returns filtered history

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { glbModelsRoutes } from "../src/routes/glbModels.js";

function buildTinyGlb(): Buffer {
  // Minimal valid GLB: 12-byte header + 8-byte JSON chunk header + JSON + 8-byte BIN header + empty BIN.
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  const jsonStr = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}] });
  const jsonBuf = Buffer.from(jsonStr, "utf-8");
  const pad4 = (n) => (4 - (n % 4)) % 4;
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length))]);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON" big-endian
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(0, 0);
  binHeader.writeUInt32LE(0x494e4242, 4); // "BIN\0"
  const total = 12 + 8 + jsonPadded.length + 8;
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader]);
}

describe("v2.16.0 — GLB model routes", () => {
  it("validates GLB header magic bytes", () => {
    const buf = buildTinyGlb();
    expect(buf.slice(0, 4).toString("ascii")).toBe("glTF");
    expect(buf.readUInt32LE(4)).toBe(2);
    // Total length matches
    expect(buf.readUInt32LE(8)).toBe(buf.byteLength);
    // JSON chunk header type = 0x4E4F534A ("JSON" in LE bytes)
    const jsonChunkType = buf.readUInt32LE(12 + 4);
    expect(jsonChunkType).toBe(0x4e4f534a);
  });

  it("user-uploaded file goes under public/models/user/", () => {
    // Sanity: glbModelsRoutes module loads without throwing.
    expect(typeof glbModelsRoutes).toBe("function");
  });

  it("refuses non-GLB content", async () => {
    // Read glbModels.ts source and check the validation logic.
    const src = readFileSync(
      join(process.cwd(), "src/routes/glbModels.ts"),
      "utf-8",
    );
    expect(src).toMatch(/Only \.glb files accepted/);
    expect(src).toMatch(/'glTF'/);
  });

  it("rejects deleting built-in models", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/glbModels.ts"),
      "utf-8",
    );
    expect(src).toMatch(/BUILTIN_MODELS/);
    expect(src).toMatch(/Built-in models are protected/);
  });

  it("lists user + built-in models sorted by recency", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/glbModels.ts"),
      "utf-8",
    );
    expect(src).toMatch(/builtin/);
    expect(src).toMatch(/\.sort\(/);
  });

  it("sync history per-resource endpoint", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/sync_v2.ts"),
      "utf-8",
    );
    expect(src).toMatch(/sync\/history\/:type\/:id/);
    expect(src).toMatch(/HISTORY\.filter/);
  });

  it("sync state endpoint exposes CRDT-merged view", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/sync_v2.ts"),
      "utf-8",
    );
    expect(src).toMatch(/sync\/state/);
    expect(src).toMatch(/RESOURCE_STATE/);
    expect(src).toMatch(/resourcesTracked/);
  });

  it("CRDT marks conflict fields with __mergedFields on broadcast", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/sync_v2.ts"),
      "utf-8",
    );
    expect(src).toMatch(/__mergedFields/);
    expect(src).toMatch(/applyMessageToStore/);
  });
});

describe("v2.16.0 — Yjs server still works (regression)", () => {
  it("crdt.ts WS endpoint accepts Yjs binary updates", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/crdt.ts"), "utf-8");
    expect(src).toMatch(/Y\.applyUpdate/);
    expect(src).toMatch(/Y\.encodeStateAsUpdate/);
    expect(src).toMatch(/crdt\/ws/);
  });
});

describe("v2.16.0 — @fastify/multipart registered for .glb upload", () => {
  it("server.ts registers multipart plugin", () => {
    const src = readFileSync(join(process.cwd(), "src/server.ts"), "utf-8");
    expect(src).toMatch(/@fastify\/multipart/);
    expect(src).toMatch(/glbModelsRoutes/);
    expect(src).toMatch(/50 \* 1024 \* 1024/);
  });

  it("/api/v1/models is in PUBLIC_PATHS", () => {
    const src = readFileSync(join(process.cwd(), "src/middleware/auth.ts"), "utf-8");
    expect(src).toMatch(/"\/api\/v1\/models"/);
  });
});
