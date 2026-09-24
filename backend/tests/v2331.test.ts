// v2331.test.ts — v2.33.1 backend tests for per-note print config.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, VERSION } from "../src/server.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  try { await app.close(); } catch {}
});

async function authedReq(method: string, url: string, body?: unknown) {
  const username = `pp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reg = await app.inject({
    method: "POST",
    url: "/api/v1/register",
    payload: {
      username,
      password: "demo123",
      deviceId: `dev-${username}`,
      deviceName: "test",
      platform: "node",
    },
  });
  const { accessToken } = reg.json();
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: body,
  });
}

describe("v2.33.1 — print-config endpoints", () => {
  it("GET /print-defaults returns built-in defaults", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/print-defaults" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.pageSize).toBe("A4");
    expect(body.orientation).toBe("portrait");
    expect(body.showHeader).toBe(true);
    expect(body.showFooter).toBe(true);
    expect(body.watermark).toBe("M-NEXUS");
  });

  it("PATCH /notes/:id/print-config persists custom author + footer", async () => {
    const created = await authedReq("POST", "/api/v1/notes", {
      title: "Test note",
      body: "<p>Hello</p>",
    });
    expect(created.statusCode).toBe(201);
    const note = created.json();
    expect(note.id).toBeTruthy();

    const patched = await authedReq(
      "PATCH",
      `/api/v1/notes/${note.id}/print-config`,
      {
        customAuthor: "Dr. Garcia",
        customFooter: "Universidad de Salamanca — 2026",
        pageSize: "Letter",
        orientation: "landscape",
      },
    );
    expect(patched.statusCode).toBe(200);
    const updated = patched.json();
    expect(updated.printConfig.customAuthor).toBe("Dr. Garcia");
    expect(updated.printConfig.customFooter).toBe("Universidad de Salamanca — 2026");
    expect(updated.printConfig.pageSize).toBe("Letter");
    expect(updated.printConfig.orientation).toBe("landscape");
  });

  it("GET /notes/:id/print-config returns resolved config with defaults filled in", async () => {
    const created = await authedReq("POST", "/api/v1/notes", { title: "Note X", body: "" });
    const note = created.json();

    const r1 = await authedReq("GET", `/api/v1/notes/${note.id}/print-config`);
    expect(r1.statusCode).toBe(200);
    const cfg = r1.json();
    expect(cfg.pageSize).toBe("A4");
    expect(cfg.showHeader).toBe(true);
    expect(cfg.watermark).toBeTruthy();

    await authedReq("PATCH", `/api/v1/notes/${note.id}/print-config`, {
      customAuthor: "Test",
      showFlashcards: false,
    });
    const r2 = await authedReq("GET", `/api/v1/notes/${note.id}/print-config`);
    const cfg2 = r2.json();
    expect(cfg2.customAuthor).toBe("Test");
    expect(cfg2.showFlashcards).toBe(false);
    expect(cfg2.pageSize).toBe("A4");
    expect(cfg2.showHeader).toBe(true);
  });

  it("rejects invalid pageSize", async () => {
    const created = await authedReq("POST", "/api/v1/notes", { title: "Y", body: "" });
    const note = created.json();
    const r = await authedReq("PATCH", `/api/v1/notes/${note.id}/print-config`, {
      pageSize: "Tabloid",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("EC-PRINT-001");
  });

  it("rejects out-of-range watermarkOpacity", async () => {
    const created = await authedReq("POST", "/api/v1/notes", { title: "Z", body: "" });
    const note = created.json();
    const r = await authedReq("PATCH", `/api/v1/notes/${note.id}/print-config`, {
      watermarkOpacity: 2.0,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("EC-PRINT-004");
  });

  it("partial patch merges with existing config", async () => {
    const created = await authedReq("POST", "/api/v1/notes", { title: "M", body: "" });
    const note = created.json();
    await authedReq("PATCH", `/api/v1/notes/${note.id}/print-config`, {
      customAuthor: "Alice",
      customFooter: "Footer A",
    });
    await authedReq("PATCH", `/api/v1/notes/${note.id}/print-config`, {
      customFooter: "Footer B",
    });
    const cfg = await authedReq("GET", `/api/v1/notes/${note.id}/print-config`);
    const json = cfg.json();
    expect(json.customAuthor).toBe("Alice");
    expect(json.customFooter).toBe("Footer B");
  });

  it("PATCH returns 404 for unknown note", async () => {
    const r = await authedReq("PATCH", "/api/v1/notes/nonexistent/print-config", {
      customAuthor: "X",
    });
    expect(r.statusCode).toBe(404);
  });
});
