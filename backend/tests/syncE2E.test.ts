/* syncE2E.test.ts — End-to-end test of WebSocket sync (v2.12.0).
 */
import { describe, it, expect } from "vitest";
import WebSocket from "ws";

const URL = "ws://localhost:4100/ws/sync";

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const buffer = [];
    ws.on("message", (data) => {
      try { buffer.push(JSON.parse(String(data))); } catch { buffer.push(String(data)); }
    });
    ws.on("open", () => {
      ws.__buffer = buffer;
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

async function drainOne(ws, timeoutMs = 5000) {
  const start = Date.now();
  while (ws.__buffer.length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for message");
    await new Promise((r) => setTimeout(r, 50));
  }
  return ws.__buffer.shift();
}

describe("sync E2E (v2.12.0)", () => {
  it("two clients receive each other's broadcasts", async () => {
    const a = await open(URL);
    const b = await open(URL);
    try {
      const helloA = await drainOne(a, 5000);
      const helloB = await drainOne(b, 5000);
      expect(helloA.type).toBe("subject");
      expect(helloA.resourceId).toBe("hello");
      expect(helloB.type).toBe("subject");

      // A sends an update → B receives it
      a.send(JSON.stringify({
        op: "update",
        type: "note",
        resourceId: "note-test-123",
        data: { title: "Test", body: "Updated from A" },
      }));
      const received = await drainOne(b, 5000);
      expect(received.type).toBe("note");
      expect(received.op).toBe("update");
      expect(received.resourceId).toBe("note-test-123");
      expect(received.data.body).toBe("Updated from A");
      expect(received.origin).toMatch(/[0-9a-f-]{36}/);

      // B sends an update → A receives it
      b.send(JSON.stringify({
        op: "create",
        type: "note",
        resourceId: "note-test-456",
        data: { title: "From B" },
      }));
      const received2 = await drainOne(a, 5000);
      expect(received2.type).toBe("note");
      expect(received2.op).toBe("create");
      expect(received2.resourceId).toBe("note-test-456");
    } finally {
      a.close();
      b.close();
    }
  }, 15000);

  it("origin is excluded from broadcast (no echo)", async () => {
    const a = await open(URL);
    try {
      await drainOne(a, 5000);
      const before = a.__buffer.length;
      a.send(JSON.stringify({
        op: "ping",
        type: "system",
        resourceId: "ping",
      }));
      await new Promise((r) => setTimeout(r, 800));
      expect(a.__buffer.length).toBe(before);
    } finally {
      a.close();
    }
  }, 10000);
});
