// Tests para PluginService (Fase 6).

import { describe, it, expect, beforeEach } from "vitest";
import { PluginService, PluginManifest } from "../src/services/pluginService";

describe("PluginService registration", () => {
  let service: PluginService;

  beforeEach(() => {
    service = new PluginService();
  });

  it("registers a plugin", () => {
    const manifest: PluginManifest = {
      id: "my-plugin",
      name: "Mi Plugin",
      version: "1.0.0",
      author: "Me",
      description: "Test",
      hooks: ["onNoteCreated"],
      permissions: ["read_notes"],
    };
    service.register(manifest);
    expect(service.get("my-plugin")).not.toBeNull();
  });

  it("list returns all registered plugins", () => {
    service.register({
      id: "p1",
      name: "P1",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    service.register({
      id: "p2",
      name: "P2",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    expect(service.list()).toHaveLength(2);
  });

  it("enable and disable", () => {
    service.register({
      id: "p",
      name: "P",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    expect(service.enable("p")).toBe(true);
    expect(service.listEnabled()).toHaveLength(1);
    expect(service.disable("p")).toBe(true);
    expect(service.listEnabled()).toHaveLength(0);
  });

  it("enable returns false for unknown plugin", () => {
    expect(service.enable("nope")).toBe(false);
  });

  it("disable returns false for unknown plugin", () => {
    expect(service.disable("nope")).toBe(false);
  });

  it("unregister removes plugin and storage", () => {
    service.register({
      id: "p",
      name: "P",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    service.enable("p");
    expect(service.unregister("p")).toBe(true);
    expect(service.get("p")).toBeNull();
    expect(service.listEnabled()).toHaveLength(0);
  });
});

describe("PluginService event emission", () => {
  let service: PluginService;

  beforeEach(() => {
    service = new PluginService();
  });

  it("emits event to log", () => {
    service.emit("onNoteCreated", { path: "a.md" });
    const events = service.recentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].hook).toBe("onNoteCreated");
  });

  it("recentEvents respects limit", () => {
    for (let i = 0; i < 100; i++) {
      service.emit("onNoteCreated", { i });
    }
    expect(service.recentEvents(10)).toHaveLength(10);
  });

  it("event log is bounded to 1000", () => {
    for (let i = 0; i < 1500; i++) {
      service.emit("onNoteCreated", { i });
    }
    expect(service.recentEvents(2000)).toHaveLength(1000);
  });
});

describe("PluginService context", () => {
  let service: PluginService;

  beforeEach(() => {
    service = new PluginService();
    service.register({
      id: "test-plugin",
      name: "Test",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
  });

  it("creates context for registered plugin", () => {
    const ctx = service.createContext("test-plugin", { theme: "dark" });
    expect(ctx).not.toBeNull();
    expect(ctx!.settings.theme).toBe("dark");
  });

  it("returns null for unknown plugin", () => {
    expect(service.createContext("nope")).toBeNull();
  });

  it("getInfo returns manifest data", () => {
    const ctx = service.createContext("test-plugin")!;
    const info = ctx.api.getInfo();
    expect(info.id).toBe("test-plugin");
    expect(info.name).toBe("Test");
    expect(info.version).toBe("1.0.0");
  });

  it("storage get/set/delete", () => {
    const ctx = service.createContext("test-plugin")!;
    ctx.api.storage.set("counter", 42);
    expect(ctx.api.storage.get("counter")).toBe(42);
    ctx.api.storage.delete("counter");
    expect(ctx.api.storage.get("counter")).toBeUndefined();
  });

  it("setSetting updates settings", () => {
    const ctx = service.createContext("test-plugin", { x: 1 })!;
    ctx.api.setSetting("x", 2);
    expect(ctx.api.getSettings().x).toBe(2);
  });
});

describe("PluginService.validate", () => {
  it("valid manifest passes", () => {
    const errors = PluginService.validate({
      id: "my-plugin",
      name: "Mi Plugin",
      version: "1.2.3",
      author: "Me",
      description: "Test",
      hooks: ["onNoteCreated"],
      permissions: ["read_notes"],
    });
    expect(errors).toEqual([]);
  });

  it("kebab-case id required", () => {
    const errors = PluginService.validate({
      id: "MyPlugin",
      name: "X",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("semver version required", () => {
    const errors = PluginService.validate({
      id: "p",
      name: "X",
      version: "1.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("name required", () => {
    const errors = PluginService.validate({
      id: "p",
      name: "",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("PluginService stats", () => {
  it("counts plugins and events", () => {
    const service = new PluginService();
    service.register({
      id: "p1",
      name: "P1",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    service.register({
      id: "p2",
      name: "P2",
      version: "1.0.0",
      author: "A",
      description: "D",
      hooks: [],
      permissions: [],
    });
    service.enable("p1");
    service.emit("onNoteCreated", {});
    service.emit("onReviewComplete", {});
    const stats = service.stats();
    expect(stats.totalPlugins).toBe(2);
    expect(stats.enabledPlugins).toBe(1);
    expect(stats.totalEvents).toBe(2);
  });
});

describe("PluginService.generateId", () => {
  it("generates unique IDs", () => {
    const a = PluginService.generateId();
    const b = PluginService.generateId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^plugin-/);
  });
});
