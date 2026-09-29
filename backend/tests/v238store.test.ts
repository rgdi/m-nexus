// tests/v238store.test.ts — v2.38.1 per-user data isolation.
//
// The claim being tested is the one v2.37.0 could not make: requiring a
// token on an endpoint whose data is shared is a lock on the same door.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, promises as fs, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCollection,
  writeCollection,
  sanitise,
  subjectFor,
  runWithSubject,
  currentSubject,
  enterSubject,
  listUsers,
  hasLegacyData,
  invalidateAll,
  allowAdoption,
  DEFAULT_SUBJECT,
} from "../src/services/userStore.js";

let dir: string;
let before: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  before = process.cwd();
  process.chdir(dir);
  await fs.mkdir(join(dir, "data"), { recursive: true });
  invalidateAll();
});

afterEach(async () => {
  process.chdir(before);
  await fs.rm(dir, { recursive: true, force: true });
  invalidateAll();
});

describe("v2.38.1 — isolation", () => {
  it("user A's data is not user B's data", async () => {
    await writeCollection("alice", "notes.json", [{ id: "n-alice" }]);
    await writeCollection("bob", "notes.json", [{ id: "n-bob" }]);
    const a = await readCollection<any[]>("alice", "notes.json", []);
    const b = await readCollection<any[]>("bob", "notes.json", []);
    expect(a[0].id).toBe("n-alice");
    expect(b[0].id).toBe("n-bob");
  });

  it("an unknown user gets an empty list, not someone else's", async () => {
    await writeCollection("alice", "notes.json", [{ id: "n-alice" }]);
    const c = await readCollection<any[]>("carol", "notes.json", []);
    expect(c).toEqual([]);
  });

  it("each user gets their own file on disk", async () => {
    await writeCollection("alice", "notes.json", [{ id: "a" }]);
    await writeCollection("bob", "notes.json", [{ id: "b" }]);
    expect(existsSync(join(dir, "data", "users", "alice", "notes.json"))).toBe(true);
    expect(existsSync(join(dir, "data", "users", "bob", "notes.json"))).toBe(true);
  });

  it("lists who has data", async () => {
    await writeCollection("alice", "notes.json", [{ id: "a" }]);
    await writeCollection("bob", "notes.json", [{ id: "b" }]);
    const users = await listUsers();
    expect(users.sort()).toEqual(["alice", "bob"]);
  });

  it("collections inside one user stay separate", async () => {
    await writeCollection("alice", "notes.json", [{ id: "n" }]);
    await writeCollection("alice", "flashcards.json", [{ id: "c" }]);
    expect((await readCollection<any[]>("alice", "notes.json", [])).length).toBe(1);
    expect((await readCollection<any[]>("alice", "flashcards.json", [])).length).toBe(1);
  });
});

describe("v2.38.1 — the subject is not a raw path", () => {
  it("strips traversal", () => {
    const s = sanitise("../../etc/passwd");
    expect(s).not.toContain("/");
    // No separator and no "..", so it cannot climb out of data/users.
    expect(s.includes("..")).toBe(false);
  });

  it("cannot escape the data directory", () => {
    const s = sanitise("../outside");
    expect(s.includes("/")).toBe(false);
    expect(s.includes("..")).toBe(false);
  });

  it("strips a leading dot so nothing becomes hidden", () => {
    expect(sanitise(".hidden")).toBe("hidden");
  });

  it("caps the length", () => {
    expect(sanitise("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it("never returns an empty name", () => {
    expect(sanitise("")).toBe(DEFAULT_SUBJECT);
    expect(sanitise("///").length).toBeGreaterThan(0);
  });

  it("falls back to the default bucket without auth", () => {
    expect(subjectFor(null)).toBe(DEFAULT_SUBJECT);
    expect(subjectFor({})).toBe(DEFAULT_SUBJECT);
  });

  it("uses the JWT subject when present", () => {
    expect(subjectFor({ sub: "device-abc" })).toBe("device-abc");
  });
});

describe("v2.38.1 — concurrent requests do not bleed", () => {
  it("two overlapping reads see their own data", async () => {
    // The reason this is an AsyncLocalStorage and not a module variable:
    // a shared "current user" slot is the exact race the feature exists
    // to prevent.
    await writeCollection("alice", "notes.json", [{ id: "n-alice" }]);
    await writeCollection("bob", "notes.json", [{ id: "n-bob" }]);

    const [a, b] = await Promise.all([
      runWithSubject("alice", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return readCollection<any[]>(currentSubject(), "notes.json", []);
      }),
      runWithSubject("bob", async () => {
        await new Promise((r) => setTimeout(r, 1));
        return readCollection<any[]>(currentSubject(), "notes.json", []);
      }),
    ]);
    expect(a[0].id).toBe("n-alice");
    expect(b[0].id).toBe("n-bob");
  });

  it("the scope is restored when the inner work finishes", () => {
    runWithSubject("outer", () => {
      expect(currentSubject()).toBe("outer");
      runWithSubject("inner", () => {
        expect(currentSubject()).toBe("inner");
      });
      expect(currentSubject()).toBe("outer");
    });
  });

  it("with no scope in flight the default applies", () => {
    expect(currentSubject()).toBe(DEFAULT_SUBJECT);
  });
});

describe("v2.38.1 — the legacy file is adopted exactly once", () => {
  // Adoption is off under vitest on purpose (see userStore); these are
  // the tests that are specifically about it.
  beforeEach(() => allowAdoption(true));
  afterEach(() => allowAdoption(false));

  it("a user with no file inherits the old global one", async () => {
    await fs.writeFile(
      join(dir, "data", "notes.json"),
      JSON.stringify([{ id: "old-1", body: "notas de antes" }]),
    );
    const mine = await readCollection<any[]>("alice", "notes.json", []);
    expect(mine.length).toBe(1);
    expect(mine[0].id).toBe("old-1");
  });

  it("and only the first user — a second user starts empty", async () => {
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([{ id: "old-1" }]));
    await readCollection<any[]>("alice", "notes.json", []);
    const bob = await readCollection<any[]>("bob", "notes.json", []);
    expect(bob).toEqual([]);
  });

  it("moves the original aside so it is not re-adopted", async () => {
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([{ id: "old-1" }]));
    await readCollection<any[]>("alice", "notes.json", []);
    expect(existsSync(join(dir, "data", "notes.json"))).toBe(false);
    expect(existsSync(join(dir, "data", "notes.json.migrated"))).toBe(true);
  });

  it("an empty legacy file is not adopted", async () => {
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([]));
    const mine = await readCollection<any[]>("alice", "notes.json", []);
    expect(mine).toEqual([]);
  });

  it("reports whether legacy data is still around", async () => {
    expect(await hasLegacyData()).toBe(false);
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([{ id: "x" }]));
    expect(await hasLegacyData()).toBe(true);
  });

  it("is off during a test run unless a test asks for it", async () => {
    allowAdoption(false);
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([{ id: "old-1" }]));
    const bob = await readCollection<any[]>("bob", "notes.json", []);
    expect(bob).toEqual([]);
    // And the real file is still there, un-renamed.
    expect(existsSync(join(dir, "data", "notes.json"))).toBe(true);
  });

  it("the default bucket never adopts — it is the anonymous one", async () => {
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([{ id: "old-1" }]));
    const anon = await readCollection<any[]>(DEFAULT_SUBJECT, "notes.json", []);
    expect(anon).toEqual([]);
  });
});

describe("v2.38.1 — the cache is per subject", () => {
  it("a write then a read returns the written value", async () => {
    await writeCollection("alice", "notes.json", [{ id: "written" }]);
    const r = await readCollection<any[]>("alice", "notes.json", []);
    expect(r[0].id).toBe("written");
  });

  it("invalidating one subject does not clear another", async () => {
    await writeCollection("alice", "notes.json", [{ id: "a" }]);
    await writeCollection("bob", "notes.json", [{ id: "b" }]);
    const mod = await import("../src/services/userStore.js");
    mod.invalidate("alice", "notes.json");
    expect((await readCollection<any[]>("bob", "notes.json", []))[0].id).toBe("b");
  });
});
