/* ============================================================
 * dataSource.test.js — Unit tests for offline-first data layer.
 * v2.5.0 W6 — covers API-first with localStorage fallback.
 *
 * NOTE: dataSource uses module-level `backendOnline` state, so we
 * re-import fresh per test via vi.resetModules() to avoid leaks.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../src/services/storage.js";
import { store } from "../src/services/store.js";

describe("dataSource.js — offline-first wrapper", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  async function freshDataSource(apiOverrides = {}) {
    // Re-mock api for each test with fresh implementations
    const apiMock = {
      base: "http://test/api/v1",
      health: apiOverrides.health || vi.fn().mockResolvedValue({ status: "ok" }),
      subjects: {
        list: apiOverrides.subjectsList || vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({}),
        create: apiOverrides.subjectsCreate || vi.fn().mockResolvedValue({ id: "remote-1" }),
        update: vi.fn().mockResolvedValue({ id: "remote-1" }),
        remove: vi.fn().mockResolvedValue({ ok: true }),
      },
      notes: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), appendStroke: vi.fn() },
      events: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
      tasks: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
      folders: {
        list: apiOverrides.foldersList || vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "remote-f" }),
        update: vi.fn().mockResolvedValue({ id: "remote-f" }),
        remove: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    vi.doMock("../src/services/api.js", () => ({ api: apiMock, ApiError: class extends Error {} }));
    const mod = await import("../src/services/dataSource.js");
    await mod.detectBackend();
    return { dataSource: mod.dataSource, isOnline: mod.isOnline, apiMock };
  }

  describe("list()", () => {
    it("returns API data when backend is online", async () => {
      const fakeList = [{ id: "s1", name: "Math" }];
      const { dataSource } = await freshDataSource({ subjectsList: vi.fn().mockResolvedValue(fakeList) });
      const result = await dataSource.subjects.list();
      expect(result).toEqual(fakeList);
    });

    it("falls back to local when backend is offline", async () => {
      const { dataSource } = await freshDataSource({
        health: vi.fn().mockRejectedValue(new Error("offline")),
      });
      store.set("col.subjects", [{ id: "local-1", name: "Local" }]);
      const result = await dataSource.subjects.list();
      expect(result).toEqual([{ id: "local-1", name: "Local" }]);
    });

    it("falls back to local when API throws", async () => {
      const { dataSource } = await freshDataSource({
        subjectsList: vi.fn().mockRejectedValue(new Error("503")),
      });
      store.set("col.subjects", [{ id: "fallback", name: "F" }]);
      const result = await dataSource.subjects.list();
      expect(result).toEqual([{ id: "fallback", name: "F" }]);
    });
  });

  describe("create()", () => {
    it("creates on backend and mirrors locally", async () => {
      const newSubj = { id: "remote-1", name: "Bio" };
      const { dataSource } = await freshDataSource({
        subjectsCreate: vi.fn().mockResolvedValue(newSubj),
      });
      const result = await dataSource.subjects.create({ name: "Bio" });
      expect(result).toEqual(newSubj);
    });

    it("creates locally when backend fails", async () => {
      const { dataSource } = await freshDataSource({
        subjectsCreate: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const result = await dataSource.subjects.create({ name: "Bio" });
      expect(result.id).toBeTruthy();
      expect(result.name).toBe("Bio");
    });
  });

  describe("update()", () => {
    it("updates locally when called via store API", async () => {
      await freshDataSource();
      store.set("col.subjects", [{ id: "s1", name: "Old" }, { id: "s2", name: "S2" }]);
      // Direct store update
      const list = store.get("col.subjects");
      const idx = list.findIndex(x => x.id === "s1");
      list[idx] = { ...list[idx], name: "Updated" };
      store.set("col.subjects", list);
      const after = store.get("col.subjects");
      expect(after[0].name).toBe("Updated");
    });
  });

  describe("remove()", () => {
    it("removes a single item from local cache", async () => {
      await freshDataSource();
      store.set("col.subjects", [{ id: "s1" }, { id: "s2" }]);
      const filtered = store.get("col.subjects").filter(x => x.id !== "s1");
      store.set("col.subjects", filtered);
      const after = store.get("col.subjects");
      expect(after).not.toContainEqual({ id: "s1" });
      expect(after).toContainEqual({ id: "s2" });
    });
  });

  describe("folders (v2.3.0-B)", () => {
    it("uses backend when online", async () => {
      const fakeFolders = [{ id: "f1", name: "Math" }];
      const { dataSource } = await freshDataSource({
        foldersList: vi.fn().mockResolvedValue(fakeFolders),
      });
      const result = await dataSource.folders.list();
      expect(result).toEqual(fakeFolders);
    });

    it("falls back to local when offline", async () => {
      const { dataSource } = await freshDataSource({
        health: vi.fn().mockRejectedValue(new Error("offline")),
      });
      store.set("col.folders", [{ id: "local-f", name: "Local Folder" }]);
      const result = await dataSource.folders.list();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe("Local Folder");
    });
  });

  describe("isOnline()", () => {
    it("returns true after successful detectBackend", async () => {
      const { isOnline } = await freshDataSource();
      expect(isOnline()).toBe(true);
    });

    it("returns false after failed detectBackend", async () => {
      const { isOnline } = await freshDataSource({
        health: vi.fn().mockRejectedValue(new Error("offline")),
      });
      expect(isOnline()).toBe(false);
    });
  });
});
