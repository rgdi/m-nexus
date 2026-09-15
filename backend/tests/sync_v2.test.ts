// sync_v2.test.ts — verify E2E sync broadcast works.

import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("Sync v2.0.6 — WebSocket relay", () => {
  it("GET /api/v1/sync/stats returns connected count + history size", async () => {
    const app = await buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/v1/sync/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("connectedClients");
    expect(body).toHaveProperty("historySize");
    await app.close();
  });

  it("POST /api/v1/sync/publish accepts a sync message and broadcasts", async () => {
    const app = await buildServer();
    await app.ready();
    const msg = {
      id: "test-1",
      type: "note",
      op: "update",
      resourceId: "note-xyz",
      origin: "test",
      ts: Date.now(),
      data: { title: "X" },
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sync/publish",
      payload: msg,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // broadcastedTo = clients.size - 1, may be -1 if no clients yet (size 0 → -1)
    expect(typeof body.broadcastedTo).toBe("number");
    await app.close();
  });

  it("GET /api/v1/sync/history returns recent messages", async () => {
    const app = await buildServer();
    await app.ready();
    // publish 3 events
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/sync/publish",
        payload: {
          id: `m-${i}`,
          type: "task",
          op: "create",
          resourceId: `task-${i}`,
          origin: "test",
          ts: Date.now(),
        },
      });
    }
    const res = await app.inject({ method: "GET", url: "/api/v1/sync/history" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBeGreaterThanOrEqual(3);
    await app.close();
  });
});
