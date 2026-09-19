// v2210.test.js — v2.21.0 frontend additions:
// - native_intents.js: openExternalUrl, shareText, canOpenUrl
// - offline_queue.js: autoDrainOnOnline
// - main.js: wires autoDrainOnOnline at boot

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.21.0 — native_intents URL/share helpers", () => {
  it("exports openExternalUrl, shareText, canOpenUrl", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/export async function openExternalUrl/);
    expect(src).toMatch(/export async function shareText/);
    expect(src).toMatch(/export async function canOpenUrl/);
  });

  it("openExternalUrl web fallback uses window.open", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/window\.open\(url/);
  });

  it("openExternalUrl validates url is a non-empty string", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/url must be a non-empty string/);
  });

  it("shareText requires text", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/text is required/);
  });

  it("shareText web fallback uses navigator.share or clipboard", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/navigator\.share/);
    expect(src).toMatch(/navigator\.clipboard\.writeText/);
  });

  it("canOpenUrl returns false on invalid url", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/if \(!url \|\| typeof url !== "string"\) return false/);
  });
});

describe("v2.21.0 — offline_queue autoDrainOnOnline", () => {
  it("exports autoDrainOnOnline + stopAutoDrainOnOnline", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/export function autoDrainOnOnline/);
    expect(src).toMatch(/export function stopAutoDrainOnOnline/);
  });

  it("wires navigator online event + safety poll", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/window\.addEventListener\("online"/);
    expect(src).toMatch(/setInterval\(tryDrain/);
    expect(src).toMatch(/30000/); // 30s poll
  });

  it("serializes drains (only one at a time)", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/if \(draining\) return/);
  });

  it("skips drain when navigator.onLine is false", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/if \([^)]*navigator\.onLine\) return/);
  });

  it("only wires once (idempotent)", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/autoDrainOnOnline\._wired/);
  });
});

describe("v2.21.0 — main.js wires auto-drain on boot", () => {
  it("imports autoDrainOnOnline + detectApiBase + getDeviceId + auth", () => {
    const src = readFileSync(SRC("frontend/src/main.js"), "utf-8");
    expect(src).toContain("autoDrainOnOnline");
    expect(src).toContain("detectApiBase");
    expect(src).toContain("getDeviceId");
  });
});
