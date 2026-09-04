// Tests para fsrsQueue (v0.33).
// Incluyen fault-injection: failures con reintentos, queue full, etc.

import { describe, it, expect, beforeEach } from "vitest";
import { fsrsQueue, FsrsQueue } from "../src/workers/fsrsQueue";

describe("fsrsQueue", () => {
  it("processes a simple job", async () => {
    const id = fsrsQueue.enqueue({ userId: "u1", cardIds: ["c1", "c2", "c3"] });
    const result = await fsrsQueue.waitFor(id);
    expect(result.cardsEvaluated).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it("tracks state transitions", async () => {
    const id = fsrsQueue.enqueue({ userId: "u2", cardIds: ["c4"] });
    const status = fsrsQueue.getStatus(id);
    expect(status?.state).toMatch(/queued|running|done/);
    await fsrsQueue.waitFor(id);
    const final = fsrsQueue.getStatus(id);
    expect(final?.state).toBe("done");
  });

  it("retries on failure (with simulated engine error)", async () => {
    // El engine "falla" si cardId === "__fail__"
    // El job debe reintentar hasta maxAttempts
    const queue = new FsrsQueue();
    const id = queue.enqueue({ userId: "u3", cardIds: ["__fail__"] });
    // Esperar suficiente para que reintente
    await new Promise((r) => setTimeout(r, 1500));
    const status = queue.getStatus(id);
    expect(status?.state).toBe("failed");
    expect(status?.error).toContain("simulated");
  });

  it("records errors per card without failing the job", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u4",
      cardIds: ["ok1", "__bad__x", "ok2"],
    });
    const result = await fsrsQueue.waitFor(id);
    expect(result.cardsEvaluated).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].cardId).toBe("__bad__x");
  });

  it("returns null status for unknown job", () => {
    const status = fsrsQueue.getStatus("nonexistent");
    expect(status).toBeNull();
  });

  it("stats: queued, running, processed", () => {
    const before = fsrsQueue.stats();
    expect(before.processed).toBeGreaterThanOrEqual(0);
  });

  it("list returns job metadata", async () => {
    const id = fsrsQueue.enqueue({ userId: "u5", cardIds: ["c1"] });
    const list = fsrsQueue.list();
    const found = list.find((j) => j.id === id);
    expect(found).toBeDefined();
    expect(found?.userId).toBe("u5");
  });

  it("waitFor rejects on timeout for never-finishing job", async () => {
    // Un job con cardId que falla definitivamente → waitFor debe rechar después del timeout
    // Pero con el mecanismo de retry, podría tomar hasta maxAttempts * cooldownMs
    // Aquí probamos el timeout corto
    const queue = new FsrsQueue();
    const id = queue.enqueue({ userId: "u6", cardIds: ["__fail__"] });
    await expect(queue.waitFor(id, 100)).rejects.toThrow();
  });
});
