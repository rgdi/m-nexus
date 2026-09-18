/* ============================================================
 * device.js — runtime device detection (DPR, orientation, hover,
 * touch, online, prefers-color-scheme, prefers-reduced-motion).
 *
 * v1.2.0 — el frontend se adapta en JS además de CSS.
 * ============================================================ */

class DeviceInfo {
  constructor() {
    this._listeners = new Set();
    this._values = {};
    this._collect();
    if (typeof window !== "undefined") {
      window.matchMedia("(orientation: portrait)").addEventListener("change", () => this._onChange());
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this._onChange());
      window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => this._onChange());
      window.addEventListener("online", () => this._onChange());
      window.addEventListener("offline", () => this._onChange());
      window.addEventListener("resize", () => this._onChange());
    }
  }

  _collect() {
    if (typeof window === "undefined") return;
    const mq = (q) => window.matchMedia(q);
    this._values = {
      dpr: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
      orientation: mq("(orientation: portrait)").matches ? "portrait" : "landscape",
      isTouch: mq("(pointer: coarse)").matches,
      isMouse: mq("(pointer: fine)").matches,
      canHover: mq("(hover: hover)").matches,
      prefersDark: mq("(prefers-color-scheme: dark)").matches,
      prefersLight: mq("(prefers-color-scheme: light)").matches,
      isTablet: window.innerWidth >= 720 && window.innerWidth < 1100,
      prefersReducedMotion: mq("(prefers-reduced-motion: reduce)").matches,
      prefersContrast: mq("(prefers-contrast: more)").matches,
      online: navigator.onLine,
      // Breakpoint tier
      tier: this._tier(window.innerWidth),
    };
  }

  _tier(w) {
    if (w <= 360) return "tiny";   // compact phones
    if (w <= 480) return "phone";
    if (w <= 719) return "phablet";
    if (w <= 1099) return "tablet";
    if (w <= 1439) return "laptop";
    return "desktop";
  }

  _onChange() {
    this._collect();
    this._listeners.forEach((cb) => cb(this._values));
  }

  subscribe(cb) {
    this._listeners.add(cb);
    cb(this._values);
    return () => this._listeners.delete(cb);
  }

  get values() { return { ...this._values }; }

  /** Returns CSS class names that reflect current device. */
  bodyClasses() {
    const v = this._values;
    return [
      `dpr-${Math.round(v.dpr)}x`,
      `tier-${v.tier}`,
      `orient-${v.orientation}`,
      v.isTouch ? "touch" : "mouse",
      v.canHover ? "can-hover" : "no-hover",
      v.prefersReducedMotion ? "reduced-motion" : "",
      v.online ? "online" : "offline",
    ].filter(Boolean).join(" ");
  }
}

export const device = new DeviceInfo();

/** Set explicit theme (overrides prefers-color-scheme). */
export function setTheme(theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

/** Sync body classes when device changes. */
export function startDeviceWatch() {
  if (typeof document === "undefined") return;
  // v2.6.0: preserve non-device classes (route-*, dock-collapsed, ai-chat-open, etc).
  // Only remove/toggle the device-specific ones.
  const DEVICE_CLASSES = ["dpr-", "tier-", "orient-", "touch", "mouse", "can-hover", "no-hover", "reduced-motion", "online", "offline"];
  const apply = () => {
    const fresh = device.bodyClasses().split(" ");
    // Remove all device-* classes
    Array.from(document.body.classList).forEach((c) => {
      if (DEVICE_CLASSES.some((d) => c === d || c.startsWith(d))) {
        document.body.classList.remove(c);
      }
    });
    // Add the current device classes
    fresh.forEach((c) => { if (c) document.body.classList.add(c); });
  };
  apply();
  return device.subscribe(apply);
}
