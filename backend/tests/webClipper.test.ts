// webClipper.test.ts: tests del web clipper endpoint (v0.60 P1.4).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { clipRoutes } from "../src/routes/clip.js";

describe("web clipper", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(clipRoutes, { prefix: "/api/v1" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("info endpoint lista endpoints", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/clip/info" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.endpoints).toBeDefined();
    expect(j.version).toBe("0.60");
  });

  it("clip/html con HTML basico extrae titulo", async () => {
    const html = "<html><head><title>Test</title></head><body><p>hola mundo</p></body></html>";
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/html",
      payload: { html },
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.title).toBe("Test");
    expect(j.content).toContain("hola mundo");
    expect(j.url).toBe("");
  });

  it("clip/html con <article> extrae ese", async () => {
    const html = `
      <html><body>
        <nav>menu trash</nav>
        <article>
          <h1>Post Importante</h1>
          <p>contenido del articulo</p>
        </article>
        <footer>footer trash</footer>
      </body></html>
    `;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/html",
      payload: { html, url: "https://ejemplo.com/post" },
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.content).toContain("contenido del articulo");
    expect(j.content).not.toContain("footer trash");
    expect(j.site).toBe("ejemplo.com");
  });

  it("clip/html rechaza sin html", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/html",
      payload: { url: "https://x.com" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("clip/html respeta title override", async () => {
    const html = "<html><head><title>Original</title></head><body><p>x</p></body></html>";
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/html",
      payload: { html, title: "Override" },
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.title).toBe("Override");
  });

  it("clip/url rechaza URL invalida", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/url",
      payload: { url: "no-es-url" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("clip/url rechaza protocolo no-http", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/url",
      payload: { url: "file:///etc/passwd" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("clip/url rechaza sin url", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/url",
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it("clip/html con <main> extrae ese", async () => {
    const html = `
      <html><body>
        <header>header</header>
        <main>
          <h1>Main content</h1>
          <p>el main es lo principal</p>
        </main>
        <aside>aside</aside>
      </body></html>
    `;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/clip/html",
      payload: { html },
    });
    const j = r.json();
    expect(j.content).toContain("el main es lo principal");
  });
});
