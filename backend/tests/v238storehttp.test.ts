// tests/v238storehttp.test.ts — v2.38.1 isolation over the real HTTP stack.
//
// The unit tests in v238store.test.ts prove the store separates users.
// They cannot prove the *server* puts each request in the right bucket —
// that plumbing is where this actually goes wrong, and it went wrong
// twice already (an async preHandler whose ALS scope died before the
// handler ran). So this file drives two real tokens through a real app.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, promises as fs, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server.js";
import { invalidateAll } from "../src/services/userStore.js";

let app: any;
let dir: string;
let before: string;
/** Vitest shares the process across files in a worker, so a mutated
 *  env var here would quietly re-scope everybody's fixtures. */
let authBefore: string | undefined;

const tokens: Record<string, string> = {};

async function register(name: string): Promise<string> {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/register",
    payload: { deviceId: `dev-${name}`, deviceName: name, platform: "web" },
  });
  expect(r.statusCode).toBeLessThan(300);
  const body = r.json();
  const token = body.token ?? body.accessToken;
  expect(token).toBeTruthy();
  return token as string;
}

beforeAll(async () => {
  before = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "storehttp-"));
  process.chdir(dir);
  await fs.mkdir(join(dir, "data"), { recursive: true });
  invalidateAll();
  // AUTH_REQUIRED must be on or every request collapses into the single
  // anonymous bucket and the whole file would assert nothing.
  // JWT_SECRET is deliberately NOT set: config captures it at module
  // load, and assigning it here would be too late and only break signing.
  authBefore = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = "true";
  app = await buildApp();
  await app.ready();
  tokens.alice = await register("alice");
  tokens.bob = await register("bob");
}, 30000);

afterAll(async () => {
  await app?.close();
  process.chdir(before);
  await fs.rm(dir, { recursive: true, force: true });
  invalidateAll();
  if (authBefore === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = authBefore;
});

const authed = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe("v2.38.1 — one user's notes are not another's", () => {
  it("issues different tokens for different devices", () => {
    expect(tokens.alice).not.toBe(tokens.bob);
  });

  it("Alice creates a note and can read it back", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: authed(tokens.alice),
      payload: { title: "Secretos de Alice", body: "esto es mio" },
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    const back = await app.inject({
      method: "GET",
      url: "/api/v1/notes",
      headers: authed(tokens.alice),
    });
    expect(back.json().notes.map((n: any) => n.id)).toContain(id);
  });

  it("Bob's list does not contain Alice's note", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/notes",
      headers: authed(tokens.bob),
    });
    const titles = r.json().notes.map((n: any) => n.title);
    expect(titles).not.toContain("Secretos de Alice");
  });

  it("Bob cannot fetch Alice's note by id", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: authed(tokens.alice),
      payload: { title: "Solo Alice", body: "privado" },
    });
    const id = r.json().id;
    const bob = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${id}`,
      headers: authed(tokens.bob),
    });
    expect(bob.statusCode).toBe(404);
  });

  it("Bob cannot edit or delete it either", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: authed(tokens.alice),
      payload: { title: "Nota sin prefijo", body: "x" },
    });
    const id = r.json().id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${id}`,
      headers: authed(tokens.bob),
      payload: { title: "secuestrada" },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/notes/${id}`,
      headers: authed(tokens.bob),
    });
    expect(del.statusCode).toBe(404);
    // Still there, untouched, for its owner.
    const mine = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${id}`,
      headers: authed(tokens.alice),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().title).toBe("Nota sin prefijo");
  });

  it("flashcards are separated the same way", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/v1/flashcards",
      headers: authed(tokens.alice),
      payload: { front: "mio", back: "secreto" },
    });
    expect(a.statusCode).toBeLessThan(300);
    const b = await app.inject({
      method: "GET",
      url: "/api/v1/flashcards",
      headers: authed(tokens.bob),
    });
    const fronts = b.json().cards.map((c: any) => c.front);
    expect(fronts).not.toContain("mio");
  });

  it("the capture inbox is separated too", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: authed(tokens.alice),
      payload: { text: "comprar pan", kind: "shopping", done: false },
    });
    const b = await app.inject({
      method: "GET",
      url: "/api/v1/tasks",
      headers: authed(tokens.bob),
    });
    const texts = b.json().tasks.map((t: any) => t.text);
    expect(texts).not.toContain("comprar pan");
  });

  it("each user has their own folder tree", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/folders",
      headers: authed(tokens.alice),
      payload: { name: "Apuntes privados" },
    });
    const b = await app.inject({
      method: "GET",
      url: "/api/v1/folders",
      headers: authed(tokens.bob),
    });
    const names = b.json().folders.map((f: any) => f.name);
    expect(names).not.toContain("Apuntes privados");
  });

  it("writes land in separate files on disk", async () => {
    // If this ever fails, two users shared a cache again.
    const a = join(dir, "data", "users", "dev-alice", "notes.json");
    const b = join(dir, "data", "users", "dev-bob", "notes.json");
    // Both have to have written for both files to exist: a read does not
    // create a file, which is why this writes for Bob first.
    await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: authed(tokens.bob),
      payload: { title: "De Bob", body: "suyo" },
    });
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
    // And the two files genuinely differ — a shared path would make one
    // of these assertions pass for the wrong reason.
    const [fa, fb] = await Promise.all([fs.readFile(a, "utf-8"), fs.readFile(b, "utf-8")]);
    expect(fa).not.toBe(fb);
    expect(fa).toContain("Alice");
    expect(fb).not.toContain("Secretos de Alice");
  });

  it("interleaved requests each see their own data", async () => {
    // The concurrency case: ten alternating calls in flight together.
    // A module-level "current user" passes the sequential tests above
    // and fails this one.
    const req = (tok: string, title: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/notes",
        headers: authed(tok),
        payload: { title, body: title },
      });
    await Promise.all([
      req(tokens.alice, "aaa-1"), req(tokens.bob, "bbb-1"),
      req(tokens.alice, "aaa-2"), req(tokens.bob, "bbb-2"),
      req(tokens.alice, "aaa-3"), req(tokens.bob, "bbb-3"),
    ]);
    const a = await app.inject({ method: "GET", url: "/api/v1/notes", headers: authed(tokens.alice) });
    const b = await app.inject({ method: "GET", url: "/api/v1/notes", headers: authed(tokens.bob) });
    const at = a.json().notes.map((n: any) => n.title);
    const bt = b.json().notes.map((n: any) => n.title);
    expect(at.filter((t: string) => t.startsWith("aaa-"))).toHaveLength(3);
    expect(bt.filter((t: string) => t.startsWith("bbb-"))).toHaveLength(3);
    expect(at.filter((t: string) => t.startsWith("bbb-"))).toHaveLength(0);
    expect(bt.filter((t: string) => t.startsWith("aaa-"))).toHaveLength(0);
  });
});
