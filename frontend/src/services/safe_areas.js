// safe_areas.js — v2.22.0
//
// Detects "non-usable" screen regions (notch, camera cutout,
// gesture bar, curved edges) and exposes them to JS so the app can
// avoid placing interactive elements there.
//
// Two sources of truth:
//   1. CSS env(safe-area-inset-*) — already applied to layouts.
//   2. JS Window.screen / visualViewport API — runtime geometry.
//
// Exposes window.MNEXUS_SAFE_AREAS as a frozen object that UI
// components can read for advanced cases (e.g. drawing toolbars).

const KEY = "mnexus.safe-areas.v1";

function safePx(value) {
  // CSS env() returns "0px" when not present; parse defensively.
  if (!value || value === "0px") return 0;
  const m = String(value).match(/^([\d.]+)px$/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Read CSS env() values via a probe element inserted into the DOM.
 * Returns { top, right, bottom, left } in CSS pixels.
 */
function readEnvInsets() {
  if (typeof document === "undefined") return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement("div");
  probe.style.cssText = `
    position: fixed;
    top: env(safe-area-inset-top, 0);
    right: env(safe-area-inset-right, 0);
    bottom: env(safe-area-inset-bottom, 0);
    left: env(safe-area-inset-left, 0);
    width: 0;
    height: 0;
    pointer-events: none;
    visibility: hidden;
  `;
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  document.body.removeChild(probe);
  // env() values are returned as `top: <Xpx>` where X is the inset.
  // Inset on the TOP edge means: top inset = screen-top - element-top.
  // The probe's top is 0px (no inset) by CSS, but the resolved value
  // reflects the inset because getComputedStyle returns the resolved
  // value.
  const cs = getComputedStyle(probe);
  return {
    top:    safePx(cs.top),
    right:  safePx(cs.right),
    bottom: safePx(cs.bottom),
    left:   safePx(cs.left),
  };
}

/**
 * Detect notch / display cutout presence via the screen and
 * visualViewport APIs. Returns a best-effort list of regions that
 * are not safe to place interactive elements in.
 *
 * @returns {{
 *   insets: { top: number, right: number, bottom: number, left: number },
 *   hasNotch: boolean,
 *   hasCameraCutout: boolean,
 *   hasGestureBar: boolean,
 *   hasCurvedEdges: boolean,
 *   viewportWidth: number,
 *   viewportHeight: number,
 *   safeWidth: number,
 *   safeHeight: number,
 * }}
 */
export function detectSafeAreas() {
  const insets = readEnvInsets();
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;

  // Heuristics: notch is typically ≥24px on top, camera cutout in the
  // top-left/top-right, gesture bar ≥16px on bottom.
  const hasNotch = insets.top >= 24;
  const hasCameraCutout = hasNotch || (insets.top >= 18 && (insets.left > 0 || insets.right > 0));
  const hasGestureBar = insets.bottom >= 16;
  const hasCurvedEdges = insets.left >= 16 || insets.right >= 16;

  return {
    insets,
    hasNotch,
    hasCameraCutout,
    hasGestureBar,
    hasCurvedEdges,
    viewportWidth: vw,
    viewportHeight: vh,
    safeWidth: vw - insets.left - insets.right,
    safeHeight: vh - insets.top - insets.bottom,
  };
}

/**
 * Compute where a fixed-position element should sit to avoid notches.
 * Returns { top, right, bottom, left } numbers safe to use in style.left/top.
 *
 * @param {("top-left"|"top-right"|"bottom-left"|"bottom-right"|"top-center"|"bottom-center")} position
 */
export function safePositionFor(position) {
  const insets = readEnvInsets();
  const margin = 16;
  switch (position) {
    case "top-left":     return { top: insets.top + margin, left: insets.left + margin };
    case "top-right":    return { top: insets.top + margin, right: insets.right + margin };
    case "bottom-left":  return { bottom: insets.bottom + margin, left: insets.left + margin };
    case "bottom-right": return { bottom: insets.bottom + margin, right: insets.right + margin };
    case "top-center":   return { top: insets.top + margin };
    case "bottom-center": return { bottom: insets.bottom + margin };
    default: return {};
  }
}

/**
 * Install the safe-area snapshot on window. Called once at boot.
 * Updates on resize + orientationchange (debounced 200ms).
 */
export function installSafeAreas() {
  if (typeof window === "undefined") return;
  const snap = () => {
    const data = detectSafeAreas();
    try {
      window.MNEXUS_SAFE_AREAS = Object.freeze(data);
      document.documentElement.dataset.notch = data.hasNotch ? "1" : "0";
      document.documentElement.dataset.cameraCutout = data.hasCameraCutout ? "1" : "0";
      document.documentElement.dataset.gestureBar = data.hasGestureBar ? "1" : "0";
      localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), hasNotch: data.hasNotch }));
    } catch {}
  };
  snap();
  let t = null;
  const debounced = () => {
    if (t) clearTimeout(t);
    t = setTimeout(snap, 200);
  };
  window.addEventListener("resize", debounced);
  window.addEventListener("orientationchange", debounced);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", debounced);
  }
}

export function getStoredSafeAreas() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
