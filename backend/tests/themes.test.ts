// themes.test.ts: tests del servicio de temas (v0.60 P2.4)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { getThemesService } from "../src/services/themesService.js";

describe("ThemesService (P2.4)", () => {
  it("lista temas built-in", () => {
    const svc = getThemesService();
    const list = svc.list();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some(t => t.id === "default-dark")).toBe(true);
  });
  it("get theme by id", () => {
    const svc = getThemesService();
    const t = svc.get("monokai");
    expect(t?.colors.primary).toBe("#F92672");
  });
  it("active theme", () => {
    const svc = getThemesService();
    const t = svc.active();
    expect(t).toBeDefined();
    expect(t?.id).toBe("default-dark");
  });
  it("setActive", () => {
    const svc = getThemesService();
    const ok = svc.setActive("monokai");
    expect(ok).toBe(true);
    expect(svc.active()?.id).toBe("monokai");
  });
  it("create user theme", () => {
    const svc = getThemesService();
    const t = svc.create({
      name: "Test", description: "x", mode: "dark", author: "u1",
      colors: {
        primary: "#FFF", secondary: "#000", background: "#111", surface: "#222",
        foreground: "#EEE", accent: "#AAA", error: "#F00", warning: "#FF0", success: "#0F0",
        borderRadius: 12, density: "compact",
      },
    });
    expect(t.id).toBeDefined();
    expect(t.builtin).toBe(false);
  });
  it("update user theme", () => {
    const svc = getThemesService();
    const t = svc.create({
      name: "U", description: "x", mode: "dark", author: "u1",
      colors: { primary: "#FFF", secondary: "#000", background: "#111", surface: "#222",
        foreground: "#EEE", accent: "#AAA", error: "#F00", warning: "#FF0", success: "#0F0",
        borderRadius: 8, density: "normal" },
    });
    const u = svc.update(t.id, { name: "U-updated" });
    expect(u?.name).toBe("U-updated");
  });
  it("NO se puede update built-in", () => {
    const svc = getThemesService();
    const r = svc.update("default-dark", { name: "hack" });
    expect(r).toBeNull();
  });
  it("NO se puede remove built-in", () => {
    const svc = getThemesService();
    const ok = svc.remove("default-dark");
    expect(ok).toBe(false);
  });
  it("remove user theme", () => {
    const svc = getThemesService();
    const t = svc.create({
      name: "T", description: "", mode: "dark", author: "u1",
      colors: { primary: "#000", secondary: "#FFF", background: "#000", surface: "#FFF",
        foreground: "#000", accent: "#888", error: "#F00", warning: "#FF0", success: "#0F0",
        borderRadius: 8, density: "normal" },
    });
    const ok = svc.remove(t.id);
    expect(ok).toBe(true);
  });
  it("toCss genera variables", () => {
    const svc = getThemesService();
    const css = svc.toCss(svc.get("default-dark")!);
    expect(css).toContain("--mnexus-primary");
    expect(css).toContain("--mnexus-radius");
  });
  it("export user themes", () => {
    const svc = getThemesService();
    const json = svc.exportUserThemes();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.themes)).toBe(true);
  });
});

describe("Themes HTTP routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const { themesRoutes } = await import("../src/routes/themes.js");
    await app.register(themesRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("GET /themes", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/themes" });
    expect(r.statusCode).toBe(200);
    expect(r.json().themes.length).toBeGreaterThan(0);
  });
  it("GET /themes/:id", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/themes/monokai" });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("Monokai");
  });
  it("GET /themes/:id/css", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/themes/monokai/css" });
    expect(r.statusCode).toBe(200);
    expect(r.json().css).toContain("#F92672");
  });
  it("POST /themes create", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/themes",
      payload: {
        name: "HTTP-Test", description: "x", mode: "dark", author: "u1",
        colors: { primary: "#000", secondary: "#FFF", background: "#000", surface: "#FFF",
          foreground: "#000", accent: "#888", error: "#F00", warning: "#FF0", success: "#0F0",
          borderRadius: 8, density: "normal" },
      },
    });
    expect(r.statusCode).toBe(201);
  });
  it("POST /themes invalid -> 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/themes",
      payload: { name: "bad" },
    });
    expect(r.statusCode).toBe(400);
  });
  it("POST /themes/active/:id", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/themes/active/solarized" });
    expect(r.statusCode).toBe(200);
    expect(r.json().active).toBe("solarized");
  });
  it("DELETE /themes/:id builtin -> 404", async () => {
    const r = await app.inject({ method: "DELETE", url: "/api/v1/themes/default-dark" });
    expect(r.statusCode).toBe(404);
  });
  it("GET /themes/export", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/themes/export" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.json().json).version).toBe(1);
  });
});
