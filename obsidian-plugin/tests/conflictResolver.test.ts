import { describe, it, expect } from "vitest";
import { ConflictResolver } from "../src/sync/conflictResolver";

describe("ConflictResolver", () => {
  const resolver = new ConflictResolver();
  const base = {
    path: "x.md",
    localHash: "h1",
    remoteHash: "h2",
    modifiedAt: "2024-01-01T00:00:00Z",
  };

  it("hashes idénticos → keep-local (no conflict)", async () => {
    const r = await resolver.resolve({ ...base, localHash: "h1", remoteHash: "h1", strategy: "newer-wins" });
    expect(r.action).toBe("keep-local");
  });

  it("local-wins siempre keep-local", async () => {
    const r = await resolver.resolve({ ...base, strategy: "local-wins" });
    expect(r.action).toBe("keep-local");
  });

  it("server-wins siempre keep-remote", async () => {
    const r = await resolver.resolve({ ...base, strategy: "server-wins" });
    expect(r.action).toBe("keep-remote");
  });

  it("newer-wins: local más nuevo → keep-local", async () => {
    const r = await resolver.resolve({
      ...base,
      strategy: "newer-wins",
      localModifiedAt: "2024-12-31T00:00:00Z",
      modifiedAt: "2024-01-01T00:00:00Z",
    });
    expect(r.action).toBe("keep-local");
  });

  it("newer-wins: remote más nuevo → keep-remote", async () => {
    const r = await resolver.resolve({
      ...base,
      strategy: "newer-wins",
      localModifiedAt: "2024-01-01T00:00:00Z",
      modifiedAt: "2024-12-31T00:00:00Z",
    });
    expect(r.action).toBe("keep-remote");
  });

  it("manual → ask", async () => {
    const r = await resolver.resolve({ ...base, strategy: "manual" });
    expect(r.action).toBe("ask");
  });
});
