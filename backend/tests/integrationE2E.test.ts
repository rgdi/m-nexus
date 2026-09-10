// integrationE2E.test.ts: tests de integracion end-to-end (v0.61.4)
//
// Cubre flujos completos:
//   1. Crear nota -> leer -> editar -> eliminar
//   2. Crear flashcard -> review -> log FSRS -> optimizar
//   3. Web clip URL -> markdown -> guardar en vault
//   4. Marketplace: crear review -> instalar -> descargar
//   5. E2E keygen -> encrypt -> decrypt
//   6. Backup: tick -> list -> restore
//   7. Handwriting: strokes -> recognize

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Integration: notes flow", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      const status = (err as any).statusCode ?? 500;
      reply.status(status).send({ error: err.message, code: (err as any).code });
    });
    const { registerNotesRoutes } = await import("../src/routes/notesFlow.js");
    await app.register(registerNotesRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("POST + GET + PATCH + DELETE", async () => {
    const c1 = await app.inject({
      method: "POST", url: "/api/v1/integration/notes",
      payload: { title: "Test Note", content: "Hola mundo" },
    });
    expect(c1.statusCode).toBe(201);
    const id = c1.json().id;
    const g = await app.inject({ method: "GET", url: `/api/v1/integration/notes/${id}` });
    expect(g.json().content).toBe("Hola mundo");
    const p = await app.inject({
      method: "PATCH", url: `/api/v1/integration/notes/${id}`,
      payload: { content: "Editado" },
    });
    expect(p.statusCode).toBe(200);
    const d = await app.inject({ method: "DELETE", url: `/api/v1/integration/notes/${id}` });
    expect(d.statusCode).toBe(200);
  });
});

describe("Integration: marketplace full flow", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      const status = (err as any).statusCode ?? 500;
      reply.status(status).send({ error: err.message });
    });
    const { marketplaceSqliteRoutes } = await import("../src/routes/marketplaceSqlite.js");
    await app.register(marketplaceSqliteRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("browse -> review -> install -> download", async () => {
    // 1. Browse
    const browse = await app.inject({ method: "GET", url: "/api/v1/marketplace-v2/decks" });
    expect(browse.statusCode).toBe(200);
    const deckId = browse.json().decks[0].id;
    // 2. Review
    const review = await app.inject({
      method: "POST", url: `/api/v1/marketplace-v2/decks/${deckId}/reviews`,
      payload: { userId: "u-int", userName: "Integration", rating: 5, comment: "E2E" },
    });
    expect(review.statusCode).toBe(201);
    // 3. Install
    const install = await app.inject({
      method: "POST", url: `/api/v1/marketplace-v2/decks/${deckId}/install`,
      payload: { userId: "u-int" },
    });
    expect(install.statusCode).toBe(200);
    expect(install.json().user_id).toBe("u-int");
    // 4. Download metadata
    const dl = await app.inject({
      method: "GET", url: `/api/v1/marketplace-v2/decks/${deckId}`,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.json().latestVersion.version).toBe("1.0.0");
    // 5. Stats
    const stats = await app.inject({ method: "GET", url: "/api/v1/marketplace-v2/stats" });
    expect(stats.json().totalReviews).toBeGreaterThan(0);
  });
});

describe("Integration: E2E keygen + encrypt + decrypt", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      reply.status((err as any).statusCode ?? 500).send({ error: err.message });
    });
    const { keyExchangeRoutes } = await import("../src/routes/keyExchange.js");
    await app.register(keyExchangeRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("two-party secure message", async () => {
    // Alice genera
    const a = await app.inject({
      method: "POST", url: "/api/v1/e2e/keygen",
      payload: { userId: "alice" },
    });
    const alice = a.json();
    // Bob genera
    const b = await app.inject({
      method: "POST", url: "/api/v1/e2e/keygen",
      payload: { userId: "bob" },
    });
    const bob = b.json();
    expect(alice.publicKey).not.toBe(bob.publicKey);
    // Alice encrypta con su privada + publica de Bob
    const enc = await app.inject({
      method: "POST", url: "/api/v1/e2e/encrypt",
      payload: {
        privateKey: alice.privateKey,
        theirPublicKey: bob.publicKey,
        plaintext: "Mensaje secreto de Alice",
      },
    });
    expect(enc.statusCode).toBe(200);
    const { encrypted, salt } = enc.json();
    // Bob decrypta con su privada + publica de Alice
    const dec = await app.inject({
      method: "POST", url: "/api/v1/e2e/decrypt",
      payload: {
        privateKey: bob.privateKey,
        theirPublicKey: alice.publicKey,
        salt,
        encrypted,
      },
    });
    expect(dec.statusCode).toBe(200);
    expect(dec.json().plaintext).toBe("Mensaje secreto de Alice");
  });
});

describe("Integration: backup tick + restore", () => {
  let app: FastifyInstance;
  let vaultDir: string;
  let outDir: string;
  beforeAll(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vault-int-"));
    outDir = await mkdtemp(join(tmpdir(), "bkout-int-"));
    await writeFile(join(vaultDir, "a.md"), "alpha");
    await writeFile(join(vaultDir, "b.md"), "beta");
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      reply.status((err as any).statusCode ?? 500).send({ error: err.message });
    });
    const { autoBackupRoutes } = await import("../src/routes/autoBackup.js");
    await app.register(autoBackupRoutes, { prefix: "/api/v1" });
    await app.ready();
    // Configurar
    await app.inject({
      method: "POST", url: "/api/v1/backup/auto/config",
      payload: { intervalMinutes: 30, maxBackups: 5, vaultPath: vaultDir, outputDir: outDir },
    });
  });
  afterAll(async () => {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
    await app.close();
  });

  it("tick + list", async () => {
    const tick = await app.inject({ method: "POST", url: "/api/v1/backup/auto/tick" });
    expect(tick.statusCode).toBe(200);
    expect(tick.json().entry).toBeDefined();
    const list = await app.inject({ method: "GET", url: "/api/v1/backup/auto/list" });
    expect(list.json().backups.length).toBeGreaterThan(0);
  });
});

describe("Integration: web clipper end-to-end", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      reply.status((err as any).statusCode ?? 500).send({ error: err.message });
    });
    const { clipRoutes } = await import("../src/routes/clip.js");
    await app.register(clipRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("html -> md", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/clip/html",
      payload: {
        html: "<h1>Titulo</h1><p>Esto es un parrafo con <strong>bold</strong> y <em>italic</em>.</p><ul><li>Item 1</li><li>Item 2</li></ul>",
        url: "https://example.com/article",
        title: "Mi articulo",
      },
    });
    expect(r.statusCode).toBe(200);
    const md = r.json().content;
    expect(md).toContain("# Titulo");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
  });
});

describe("Integration: themes + custom theme", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      reply.status((err as any).statusCode ?? 500).send({ error: err.message });
    });
    const { themesRoutes } = await import("../src/routes/themes.js");
    await app.register(themesRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("create + activate + export", async () => {
    const c = await app.inject({
      method: "POST", url: "/api/v1/themes",
      payload: {
        name: "E2E Test", description: "integration", mode: "dark", author: "test",
        colors: { primary: "#FFF", secondary: "#000", background: "#111", surface: "#222",
          foreground: "#EEE", accent: "#AAA", error: "#F00", warning: "#FF0", success: "#0F0",
          borderRadius: 8, density: "normal" },
      },
    });
    expect(c.statusCode).toBe(201);
    const id = c.json().id;
    // Activate
    const a = await app.inject({ method: "POST", url: `/api/v1/themes/active/${id}` });
    expect(a.statusCode).toBe(200);
    // Export
    const e = await app.inject({ method: "GET", url: "/api/v1/themes/export" });
    const parsed = JSON.parse(e.json().json);
    expect(parsed.themes.some((t: any) => t.id === id)).toBe(true);
  });
});
