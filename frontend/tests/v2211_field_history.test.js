// v2211_field_history.test.js — behavioral tests for field_history.js.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  trackField,
  applyRemoteUpdate,
  getHistorySize,
  _resetAll,
  _getRecord,
} from "../src/services/field_history.js";

describe("v2.21.1 — field_history runtime behavior", () => {
  beforeEach(() => {
    _resetAll();
  });

  it("creates a record on first trackField call", () => {
    const t = trackField("n1", "title", "initial");
    expect(t).toBeTruthy();
    const rec = _getRecord("n1", "title");
    expect(rec).toBeTruthy();
    expect(rec.current.value).toBe("initial");
  });

  it("undo() with no history returns null", () => {
    const t = trackField("n1", "title", "v1");
    // No edits yet → no history.
    expect(t.canUndo()).toBe(false);
    expect(t.undo()).toBeNull();
  });

  it("redo() with no future returns null", () => {
    const t = trackField("n1", "title", "v1");
    expect(t.canRedo()).toBe(false);
    expect(t.redo()).toBeNull();
  });

  it("setValue + flush + undo restores previous value", () => {
    const t = trackField("n1", "title", "v1");
    t.setValue("v2");
    t.flush();
    expect(t.canUndo()).toBe(true);
    const v = t.undo();
    expect(v).toBe("v1");
    expect(t.canRedo()).toBe(true);
  });

  it("undo then redo restores latest value", () => {
    const t = trackField("n1", "title", "v1");
    t.setValue("v2");
    t.flush();
    t.undo();
    const v = t.redo();
    expect(v).toBe("v2");
    expect(t.canRedo()).toBe(false);
  });

  it("a new edit invalidates the redo stack", () => {
    const t = trackField("n1", "title", "v1");
    t.setValue("v2");
    t.flush();
    t.setValue("v3");
    t.flush();
    t.undo(); // → v2
    expect(t.canRedo()).toBe(true);
    t.setValue("v4");
    t.flush(); // new edit
    expect(t.canRedo()).toBe(false);
  });

  it("applyRemoteUpdate clears history", () => {
    const t = trackField("n1", "title", "v1");
    t.setValue("v2");
    t.flush();
    t.setValue("v3");
    t.flush();
    expect(getHistorySize("n1", "title")).toBeGreaterThan(0);
    applyRemoteUpdate("n1", "title");
    expect(getHistorySize("n1", "title")).toBe(0);
    expect(t.canUndo()).toBe(false);
    expect(t.canRedo()).toBe(false);
  });

  it("clear() drops all history", () => {
    const t = trackField("n1", "title", "v1");
    t.setValue("v2");
    t.flush();
    t.clear();
    expect(getHistorySize("n1", "title")).toBe(0);
  });

  it("size() returns past + future length", () => {
    const t = trackField("n1", "title", "v1");
    expect(t.size()).toBe(0);
    t.setValue("v2");
    t.flush();
    expect(t.size()).toBe(1);
    t.setValue("v3");
    t.flush();
    expect(t.size()).toBe(2);
    t.undo();
    expect(t.size()).toBe(2); // past + future
  });
});

describe("v2.21.1 — field_history SSR-safety", () => {
  it("returns null when window is undefined", () => {
    const originalWindow = globalThis.window;
    // @ts-ignore — simulating SSR
    delete globalThis.window;
    try {
      const t = trackField("n1", "title", "v1");
      expect(t).toBeNull();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
