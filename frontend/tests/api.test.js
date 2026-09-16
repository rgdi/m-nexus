/* ============================================================
 * api.test.js — Unit tests for HTTP client wrapper.
 * v2.5.0 W6 — covers ApiError, timeout, JSON parsing.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../src/services/api.js";

describe("api.js — ApiError", () => {
  it("is an Error subclass with status + payload", () => {
    const err = new ApiError("Not found", 404, { code: "EC-NF" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Not found");
    expect(err.status).toBe(404);
    expect(err.payload).toEqual({ code: "EC-NF" });
    expect(err.name).toBe("Error");
  });

  it("can be thrown and caught", () => {
    expect(() => { throw new ApiError("fail", 500, {}); }).toThrow();
  });
});

describe("api.js — fetch wrapper behavior", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses correct API base (http://localhost:4100/api/v1 in dev)", async () => {
    // Verify the module's API_BASE
    const mod = await import("../src/services/api.js");
    expect(mod.api.base).toMatch(/\/api\/v1$/);
  });

  it("sends GET requests without body", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true }),
    });
    const { api } = await import("../src/services/api.js");
    await api.health();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/health"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends POST requests with JSON body", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ id: "new-1" }),
    });
    const { api } = await import("../src/services/api.js");
    const data = { name: "test" };
    await api.notes.create(data);
    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(fetchCall[1].body)).toEqual(data);
  });

  it("throws ApiError on non-2xx responses", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      json: async () => ({ message: "Not found", code: "EC-NF" }),
    });
    const { api } = await import("../src/services/api.js");
    await expect(api.notes.get("missing")).rejects.toThrow(ApiError);
  });

  it("includes timeout via AbortController", async () => {
    let abortSignal = null;
    global.fetch.mockImplementationOnce((url, init) => {
      abortSignal = init.signal;
      return Promise.resolve({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
      });
    });
    const { api } = await import("../src/services/api.js");
    await api.health();
    expect(abortSignal).toBeTruthy();
    expect(abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("returns parsed text for non-JSON responses", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () => "<html>hi</html>",
    });
    const { api } = await import("../src/services/api.js");
    const result = await api.health();
    expect(result).toBe("<html>hi</html>");
  });
});

describe("api.js — resource methods", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subjects.list calls GET /subjects", async () => {
    const { api } = await import("../src/services/api.js");
    await api.subjects.list();
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/\/api\/v1\/subjects$/);
    expect(global.fetch.mock.calls[0][1].method).toBe("GET");
  });

  it("events.create POSTs to /events", async () => {
    const { api } = await import("../src/services/api.js");
    await api.events.create({ title: "Test" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/\/api\/v1\/events$/);
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");
  });

  it("tasks.toggle POSTs with toggle action", async () => {
    const { api } = await import("../src/services/api.js");
    await api.tasks.toggle("task-1");
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/\/api\/v1\/tasks\/task-1\/toggle$/);
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");
  });

  it("folders.list calls GET /folders", async () => {
    const { api } = await import("../src/services/api.js");
    await api.folders.list();
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/\/api\/v1\/folders$/);
  });
});
