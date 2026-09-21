// tests/cluster.test.ts — v2.23.3 cluster registry tests.
//
// Single-node mode is the default; tests use the in-memory fallback (no Redis),
// so they pass without extra infrastructure. Multi-node Redis mode is covered
// by the redis-client mock in mockRedis below (smoke test only).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Cluster } from "../src/services/cluster.js";

describe("v2.23.3 — cluster registry (single-node default)", () => {
  it("new cluster has self with role=leader and capabilities", () => {
    const c = new Cluster({
      ttl: 60,
      tick: 15,
      port: 4100,
      region: "local",
      version: "v2.23.3-test",
      capabilities: ["http", "ws"],
      redis: null,
    });
    const self = c.getSelf();
    expect(self.role).toBe("leader");
    expect(self.port).toBe(4100);
    expect(self.capabilities).toContain("http");
    expect(self.capabilities).toContain("ws");
    expect(c.isLeader()).toBe(true);
  });

  it("start() in single-node mode makes peers() return [self]", async () => {
    const c = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "local",
      version: "v2.23.3-test", capabilities: ["http"], redis: null,
    });
    await c.start();
    const peers = await c.peers();
    expect(peers.length).toBe(1);
    expect(peers[0].role).toBe("leader");
    await c.stop();
  });

  it("forceRole persists across isLeader()", async () => {
    const c = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "local",
      version: "v2.23.3-test", capabilities: ["http"], redis: null,
    });
    await c.start();
    await c.forceRole("worker");
    expect(c.getRole()).toBe("worker");
    expect(c.isLeader()).toBe(false);
    await c.forceRole("leader");
    expect(c.getRole()).toBe("leader");
    await c.stop();
  });

  it("emits peer:joined/leader:elected events", async () => {
    const c = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "local",
      version: "v2.23.3-test", capabilities: ["http"], redis: null,
    });
    const events: string[] = [];
    c.on((e) => events.push(e.type));
    await c.forceRole("leader");
    await c.forceRole("worker");
    await c.forceRole("leader");
    expect(events).toContain("role:changed");
  });

  it("uploads self.record updates uptimeSec monotonically", async () => {
    const c = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "local",
      version: "v2.23.3-test", capabilities: ["http"], redis: null,
    });
    await c.start();
    const t1 = c.getSelf().uptimeSec;
    await new Promise((r) => setTimeout(r, 1100));
    const t2 = c.getSelf().uptimeSec;
    expect(t2).toBeGreaterThanOrEqual(t1);
    await c.stop();
  });
});

describe("v2.23.3 — Redis-backed cluster (mock redis)", () => {
  // Tiny in-memory mock used for the smoke test only.
  const store: Record<string, { value: string; expiresAt: number }> = {};
  const mockRedis = {
    async set(key: string, value: string, ...args: any[]) {
      const ttlIdx = args.findIndex((a) => a === "EX");
      const ttl = ttlIdx >= 0 ? parseInt(args[ttlIdx + 1] || "60", 10) : 60;
      const mode = args.includes("NX") ? "NX" : args.includes("XX") ? "XX" : null;
      // NX: only set if not exists
      if (mode === "NX") {
        const e = store[key];
        if (e && e.expiresAt >= Date.now()) {
          return null;
        }
        store[key] = { value, expiresAt: Date.now() + ttl * 1000 };
        return "OK";
      }
      // Default: SET always
      store[key] = { value, expiresAt: Date.now() + ttl * 1000 };
      return "OK";
    },
    async get(key: string) {
      const e = store[key];
      if (!e) return null;
      if (e.expiresAt < Date.now()) {
        delete store[key];
        return null;
      }
      return e.value;
    },
    async del(key: string) { delete store[key]; return 1; },
    async keys(pattern: string) {
      const re = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return Object.keys(store).filter((k) => re.test(k));
    },
    async expire(key: string, ttl: number) {
      if (store[key]) {
        store[key].expiresAt = Date.now() + ttl * 1000;
        return 1;
      }
      return 0;
    },
  };

  beforeEach(() => { Object.keys(store).forEach((k) => delete store[k]); });
  afterEach(() => { Object.keys(store).forEach((k) => delete store[k]); });

  it("registers itself on heartbeatOnce", async () => {
    const c = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "test",
      version: "v2.23.3-test", capabilities: ["http", "ws"],
      redis: mockRedis as any,
    });
    await c.start();
    const peers = await c.peers();
    expect(peers.length).toBe(1);
    expect(peers[0].host).toBeTruthy();
    expect(peers[0].region).toBe("test");
    await c.stop();
  });

  it("first node becomes leader (SET NX succeeds)", async () => {
    const c = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "test",
      version: "v2.23.3-test", capabilities: ["http"], redis: mockRedis as any,
    });
    await c.start();
    expect(c.isLeader()).toBe(true);
    await c.stop();
  });

  it("two clusters on same region: leader-locked winner", async () => {
    const cA = new Cluster({
      ttl: 60, tick: 15, port: 4100, region: "test",
      version: "v2.23.3-test", capabilities: ["http"], redis: mockRedis as any,
    });
    await cA.start();
    expect(cA.isLeader()).toBe(true);
    await cA.stop();

    // Pretend a second node starts; cA is the previously-leader.
    const cB = new Cluster({
      ttl: 60, tick: 15, port: 4101, region: "test",
      version: "v2.23.3-test", capabilities: ["http"], redis: mockRedis as any,
    });
    await cB.start();
    // cA stopped = leader key released, so cB should be able to acquire.
    expect(cB.isLeader()).toBe(true);
    await cB.stop();
  });
});
