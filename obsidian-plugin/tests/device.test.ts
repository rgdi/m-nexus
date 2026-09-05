// Tests para el device detector (v0.37).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock de obsidian Platform
vi.mock("obsidian", () => ({
  Platform: {
    isAndroidApp: false,
    isIosApp: false,
    isMacOS: false,
    isWin: false,
    isLinux: false,
  },
}));

import { device } from "../src/device/detector";

describe("device detector", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    // Reset DOM
    document.body.className = "";
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
  });

  function setSize(w: number, h: number) {
    Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
  }

  it("detecta desktop cuando la pantalla es >= 1024px y no es touch", () => {
    setSize(1440, 900);
    // Simular que no es touch
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn((q: string) => ({
        matches: q === "(hover: hover)",
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      configurable: true,
    });
    const p = device.refresh();
    expect(p.type).toBe("desktop");
    expect(p.isDesktop).toBe(true);
    expect(p.isMobile).toBe(false);
    expect(p.isTablet).toBe(false);
    expect(p.width).toBe(1440);
    expect(p.height).toBe(900);
  });

  it("detecta mobile cuando la pantalla es < 600px", () => {
    setSize(400, 800);
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn((q: string) => ({
        matches: q === "(pointer: coarse)",
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      configurable: true,
    });
    const p = device.refresh();
    expect(p.type).toBe("mobile");
    expect(p.isMobile).toBe(true);
  });

  it("detecta tablet cuando la pantalla está entre 600-1024px con touch", () => {
    setSize(800, 1200);
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn((q: string) => ({
        matches: q === "(pointer: coarse)",
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      configurable: true,
    });
    const p = device.refresh();
    expect(p.type).toBe("tablet");
    expect(p.isTablet).toBe(true);
  });

  it("calcula isLandscape correctamente", () => {
    setSize(800, 400);
    let p = device.refresh();
    expect(p.isLandscape).toBe(true);

    setSize(400, 800);
    p = device.refresh();
    expect(p.isLandscape).toBe(false);
  });

  it("aplica clase CSS al body según el tipo", () => {
    setSize(400, 800);
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn((q: string) => ({
        matches: q === "(pointer: coarse)",
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      configurable: true,
    });
    device.refresh();
    expect(document.body.classList.contains("mnexus-mobile")).toBe(true);
  });

  it("permite suscribirse a cambios y notifica a los listeners", () => {
    const cb = vi.fn();
    device.subscribe(cb);

    setSize(400, 800);
    device.refresh();

    expect(cb).toHaveBeenCalled();
    const profile = cb.mock.calls[0][0];
    expect(profile.type).toBe("mobile");
  });

  it("el unsubscribe elimina el listener", () => {
    const cb = vi.fn();
    const unsub = device.subscribe(cb);
    unsub();
    setSize(400, 800);
    device.refresh();
    // El callback no debe ser llamado después de unsubscribe
    // (puede haber sido llamado antes, pero no después)
    const callsBefore = cb.mock.calls.length;
    setSize(500, 800);
    device.refresh();
    expect(cb.mock.calls.length).toBe(callsBefore);
  });

  it("profile() devuelve el perfil actual cacheado", () => {
    setSize(1200, 800);
    const p1 = device.profile();
    const p2 = device.profile();
    expect(p1).toBe(p2); // misma referencia
  });

  it("expone pixelRatio y dimensiones", () => {
    setSize(1024, 768);
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    const p = device.refresh();
    expect(p.pixelRatio).toBe(2);
    expect(p.width).toBe(1024);
    expect(p.height).toBe(768);
  });
});
