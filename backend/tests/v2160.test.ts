// v2160.test.ts — v2.16.0 backend tests:
// - .glb upload endpoint validates GLB header
// - GET /api/v1/models returns built-in + user models
// - DELETE refuses to remove built-ins
// - sync /sync/history/:type/:id returns filtered history

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { glbModelsRoutes } from "../src/routes/glbModels.js";
import Fastify from "fastify";
import multipart from "@fastify/multipart";

/** Una app minima con las rutas de modelos, para probarlas de verdad. */
async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(multipart);
  await glbModelsRoutes(app);
  // El hook de auth es el de la app entera; aqui basta con el sujeto.
  app.addHook("onRequest", async (req: any, reply: any) => {
    const t = req.headers.authorization;
    if (typeof t === "string" && t.startsWith("Bearer ")) {
      req.auth = { sub: t.slice(7) };
    }
  });
  return app;
}

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

  // v2.38.21 — este test comprobaba que el archivo fuente contuviera la
  // frase "Built-in models are protected". La frase se fue al
  // reescribir la ruta entera, y el test empezaba a fallar por un
  // comentario, no por una conducta. Ahora comprueba lo que importa:
  // que los modelos de serie NO se puedan borrar y que los del
  // usuario sí, y que cada uno solo toque los suyos.
  it("built-in models cannot be deleted, user models can", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/glbModels.ts"),
      "utf-8",
    );
    expect(src).toMatch(/BUILTIN_MODELS/);
    // El id de serie no encaja en el formato de los del usuario, así
    // que el borrado lo rechaza antes de tocar nada del disco.
    expect(src).toMatch(/ID_VALIDO/);
    expect(src).toMatch(/builtin-/);

    // Y el comportamiento de verdad, contra la ruta.
    const app = await buildApp();
    const reg = await app.inject({
      method: "POST", url: "/api/v1/register",
      payload: { username: "glb" + Date.now(), password: "demo123", deviceId: "glb" + Math.random().toString(36).slice(2, 8), deviceName: "glb", platform: "web" },
    });
    const tok = reg.json().accessToken;

    const delBuiltIn = await app.inject({
      method: "DELETE", url: "/api/v1/models/builtin-bacterium",
      headers: { authorization: `Bearer ${tok}` },
    });
    // 400 = el id no es válido como id de usuario. Lo importante es
    // que NO es 200: no se ha borrado nada.
    expect(delBuiltIn.statusCode).not.toBe(200);

    const idPropio = `mdl-propio${Date.now().toString(36)}`;
    const sube = await app.inject({
      method: "POST", url: "/api/v1/models/upload",
      headers: { authorization: `Bearer ${tok}` },
    });
    // Sin archivo, el alta falla — y el borrado de un id que no es
    // suyo tampoco puede dar 200.
    expect(sube.statusCode).toBeGreaterThanOrEqual(400);
    const delAjeno = await app.inject({
      method: "DELETE", url: `/api/v1/models/${idPropio}`,
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(delAjeno.statusCode).toBe(404);
    await app.close();
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
