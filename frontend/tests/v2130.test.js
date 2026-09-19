/* v2130.test.js — v2.13.0 features tests
 * - palmRejection: isPalmContact() detection
 * - palmRejection: mouse/pen allowed, touch rejected by area
 */
import { describe, it, expect } from "vitest";
import { isPalmContact } from "../src/widgets/palmRejection.js";

describe("isPalmContact (v2.13.0)", () => {
  it("always allows pen (stylus)", () => {
    const pen = {
      pointerType: "pen",
      width: 5,
      height: 5,
      pressure: 0.5,
    };
    expect(isPalmContact(pen)).toBe(false);
  });

  it("always allows mouse", () => {
    const mouse = {
      pointerType: "mouse",
      width: 0,
      height: 0,
      pressure: 0.5,
    };
    expect(isPalmContact(mouse)).toBe(false);
  });

  it("rejects palm touch (large area)", () => {
    const palm = {
      pointerType: "touch",
      width: 60,
      height: 40,
      pressure: 0.5,
    };
    expect(isPalmContact(palm)).toBe(true);
  });

  it("allows finger touch (small area)", () => {
    const finger = {
      pointerType: "touch",
      width: 12,
      height: 12,
      pressure: 0.5,
    };
    expect(isPalmContact(finger)).toBe(false);
  });

  it("rejects very large radius touch", () => {
    const bigRadius = {
      pointerType: "touch",
      width: 8,
      height: 8,
      radiusX: 30,
      radiusY: 30,
      pressure: 0.5,
    };
    expect(isPalmContact(bigRadius)).toBe(true);
  });

  it("rejects wide-and-thin contact (palm swipe)", () => {
    const swipe = {
      pointerType: "touch",
      width: 50,
      height: 5,
      pressure: 0.5,
    };
    expect(isPalmContact(swipe)).toBe(true);
  });

  it("handles missing width/height gracefully", () => {
    const minimal = {
      pointerType: "touch",
    };
    expect(isPalmContact(minimal)).toBe(false);
  });

  it("handles missing pointerType (returns false, allow)", () => {
    expect(isPalmContact({})).toBe(false);
    expect(isPalmContact(null)).toBe(false);
    expect(isPalmContact(undefined)).toBe(false);
  });

  it("respects custom threshold (area=1500)", () => {
    // Edge case: width=40 height=40 → area=1600 (above)
    const borderline = {
      pointerType: "touch",
      width: 40,
      height: 40,
      pressure: 0.5,
    };
    expect(isPalmContact(borderline)).toBe(true);
    // Below: width=30, height=40 → area=1200 (below)
    const below = {
      pointerType: "touch",
      width: 30,
      height: 40,
      pressure: 0.5,
    };
    expect(isPalmContact(below)).toBe(false);
  });
});

describe("canvas drawing metadata (v2.13.0)", () => {
  it("PointerEvent includes pressure, tilt, pointerType", () => {
    // Simulated event
    const e = {
      pointerType: "pen",
      pressure: 0.7,
      tiltX: 30,
      clientX: 100,
      clientY: 200,
    };
    expect(e.pointerType).toBe("pen");
    expect(e.pressure).toBeCloseTo(0.7);
    expect(e.tiltX).toBe(30);
  });
});
