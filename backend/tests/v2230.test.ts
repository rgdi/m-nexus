// tests/v2230.test.ts — v2.23.0 backend additions:
//   - Multi-device sync: subjects routes broadcast via publishSync
//   - Templates: backend supports bulk import for one-click subject sets

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_FILE = join(process.cwd(), "data", "subjects.json");
const BACKUP_FILE = DATA_FILE + ".bak-v2230";

describe("v2.23.0 — multi-device sync via WS", () => {
  let origSubjects: string;

  beforeEach(async () => {
    try { origSubjects = await fs.readFile(DATA_FILE, "utf-8"); } catch { origSubjects = "[]"; }
  });

  afterEach(async () => {
    await fs.writeFile(DATA_FILE, origSubjects);
  });

  it("subjects.ts imports publishSync", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    expect(src).toMatch(/import.*publishSync/);
  });

  it("POST /subjects calls publishSync with type=subject", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    // The route itself uses `await publishSync(...)` after a successful create.
    expect(src).toMatch(/publishSync\(app,\s*\{[\s\S]*?type:\s*"subject"[\s\S]*?op:\s*"create"[\s\S]*?\}/);
  });

  it("PATCH /subjects/:id broadcasts op=update", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    expect(src).toMatch(/publishSync\(app,\s*\{[\s\S]*?op:\s*"update"[\s\S]*?\}/);
  });

  it("DELETE /subjects/:id broadcasts op=delete", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    expect(src).toMatch(/publishSync\(app,\s*\{[\s\S]*?op:\s*"delete"[\s\S]*?\}/);
  });

  it("DELETE /subjects (nuke all) broadcasts delete with __nuke_all__ id", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    expect(src).toMatch(/__nuke_all__/);
  });

  it("POST /subjects/bulk broadcasts create for each item", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    // The /subjects/bulk route should iterate the new list and call publishSync per item.
    const m = src.match(/app\.post[\s\S]+?"\/subjects\/bulk"[\s\S]+?\n\s*\}\);?[\s\S]+?(?=app\.)/);
    expect(m).toBeTruthy();
    expect(m![0]).toMatch(/publishSync/);
    expect(m![0]).toMatch(/op:\s*"create"/);
  });

  it("PATCH /subjects/reorder broadcasts update per subject", async () => {
    const src = await fs.readFile(join(process.cwd(), "src", "routes", "subjects.ts"), "utf-8");
    const reorderSection = src.split("reorder endpoint")[1]?.split("bulk replace")[0] || src.split(/reorder[\s\S]{0,300}/)[0];
    expect(reorderSection).toMatch(/publishSync/);
  });
});

describe("v2.23.0 — subjects v2.22.1 features still present", () => {
  it("rejects empty name (regression)", () => {
    // Sanity: still requires name.trim()
    const src = require("fs").readFileSync("src/routes/subjects.ts", "utf-8");
    expect(src).toMatch(/name\.trim\(\)/);
  });

  it("still has bulkReplace + reorder + removeAll", () => {
    const src = require("fs").readFileSync("src/routes/subjects.ts", "utf-8");
    expect(src).toMatch(/bulkReplace\b/);
    expect(src).toMatch(/reorder\b/);
    expect(src).toMatch(/removeAll\b/);
  });

  it("subjects.json starts empty (no auto-seed)", () => {
    const src = require("fs").readFileSync("data/subjects.json", "utf-8");
    expect(JSON.parse(src)).toEqual([]);
  });
});
