// Tests para los endpoints REST /api/v1/update

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/server.js";
import { clearUpdateCache } from "../src/utils/updateChecker.js";

describe("Update routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearUpdateCache();
  });

  it("GET /api/v1/update returns update info", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v9.9.9",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://example.com/release",
        body: "notes",
        prerelease: false,
        assets: [{ name: "m-nexus-backend-v9.9.9.zip", browser_download_url: "https://x/b.zip", size: 200 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/update" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("currentVersion");
    expect(body).toHaveProperty("latestVersion");
    expect(body).toHaveProperty("hasUpdate");
    expect(body).toHaveProperty("downloadUrl");
    expect(body.latestVersion).toBe("9.9.9");
    expect(body.hasUpdate).toBe(true);
    await app.close();
  });

  it("POST /api/v1/update/check forces re-check", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "x",
        body: "",
        prerelease: false,
        assets: [{ name: "m-nexus-backend.zip", browser_download_url: "x", size: 1 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const app = await buildApp();
    // 1st via GET (uses cache after)
    await app.inject({ method: "GET", url: "/api/v1/update" });
    const before = calls;
    // 2nd via POST /check (clears cache)
    const res = await app.inject({ method: "POST", url: "/api/v1/update/check", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toBeGreaterThan(before);
    await app.close();
  });

  it("GET /api/v1/update handles network failure gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/update" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // When network fails, we return "no update" (current == latest)
    expect(body.hasUpdate).toBe(false);
    expect(body.currentVersion).toBe(body.latestVersion);
    await app.close();
  });

  it("POST /api/v1/update/apply returns 400 when no update available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v0.0.1",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "x",
        body: "",
        prerelease: false,
        assets: [{ name: "m-nexus-backend.zip", browser_download_url: "x", size: 1 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/update/apply", payload: {} });
    // v0.0.1 < current VERSION, so no update
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("no_update_available");
    await app.close();
  });
});
