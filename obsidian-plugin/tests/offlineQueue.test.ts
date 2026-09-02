import { describe, it, expect, beforeEach } from "vitest";
import { OfflineQueue } from "../src/server/offlineQueue";
import { makeMockApp, MockApp } from "./mockObsidian";
import { noopLogger } from "./helpers";

describe("OfflineQueue", () => {
  let app: MockApp;
  let queue: OfflineQueue;

  beforeEach(async () => {
    app = makeMockApp();
    queue = new OfflineQueue(app as any, noopLogger);
    await queue.load();
  });

  it("empieza vacía", async () => {
    const stats = await queue.stats();
    expect(stats.pending).toBe(0);
    expect(stats.archived).toBe(0);
  });

  it("encolar un file change", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "x.md", hash: "abc", content: "data", modifiedAt: "" });
    const stats = await queue.stats();
    expect(stats.pending).toBe(1);
  });

  it("encolar varios cambios", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "a.md", hash: "h1", content: "x", modifiedAt: "" });
    await queue.enqueueFileChange({ kind: "delete", path: "b.md", modifiedAt: "" });
    await queue.enqueueCardChange({ kind: "approve", card: { id: "c1", notePath: "x.md", front: "Q", back: "A", cardType: "basic", approvedAt: "" } });
    const stats = await queue.stats();
    expect(stats.pending).toBe(3);
  });

  it("peek respeta el orden FIFO", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "a.md", hash: "1", content: "x", modifiedAt: "" });
    await queue.enqueueFileChange({ kind: "upsert", path: "b.md", hash: "2", content: "y", modifiedAt: "" });
    const items = await queue.peek(10);
    expect(items[0].payload.kind === "upsert" && items[0].payload.path === "a.md").toBe(true);
    expect(items[1].payload.kind === "upsert" && items[1].payload.path === "b.md").toBe(true);
  });

  it("ack mueve a archived", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "a.md", hash: "1", content: "x", modifiedAt: "" });
    const items = await queue.peek();
    await queue.ack([items[0].id]);
    const stats = await queue.stats();
    expect(stats.pending).toBe(0);
    expect(stats.archived).toBe(1);
  });

  it("nack incrementa attempts y mueve al final", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "a.md", hash: "1", content: "x", modifiedAt: "" });
    await queue.enqueueFileChange({ kind: "upsert", path: "b.md", hash: "2", content: "y", modifiedAt: "" });
    const first = (await queue.peek())[0];
    await queue.nack(first.id, "network error");
    const after = await queue.peek();
    expect(after[0].id).not.toBe(first.id);
    expect(after[after.length - 1].id).toBe(first.id);
    expect(after[after.length - 1].attempts).toBe(1);
  });

  it("clear vacía pending y archived", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "a.md", hash: "1", content: "x", modifiedAt: "" });
    await queue.clear();
    const stats = await queue.stats();
    expect(stats.pending).toBe(0);
    expect(stats.archived).toBe(0);
  });

  it("persiste entre recargas (load)", async () => {
    await queue.enqueueFileChange({ kind: "upsert", path: "x.md", hash: "1", content: "x", modifiedAt: "" });
    const q2 = new OfflineQueue(app as any, noopLogger);
    await q2.load();
    const stats = await q2.stats();
    expect(stats.pending).toBe(1);
  });
});
