// stylus.js — Pressure curve configuration (v2.16.0).
//
// Maps raw pressure (0..1 from PointerEvent.pressure) to a multiplier
// (0..1.5) for stroke width. Lets the user calibrate how their stylus
// "feels" — a soft curve is more responsive at low pressure (good for
// thin brushes), an exponential curve makes the stylus feel heavier
// (good for ink-shading effects).
//
// Stored in localStorage as "mnexus.stylus.v1".

const KEY = "mnexus.stylus.v1";

export const STYLUS_PRESETS = {
  linear: {
    /** f(p) = p — pass-through */
    fn: (p) => p,
    label: "Linear",
    description: "Raw pressure, no curve",
  },
  soft: {
    /** f(p) = sqrt(p) — more responsive at low pressure */
    fn: (p) => Math.sqrt(Math.max(0, Math.min(1, p))),
    label: "Soft",
    description: "sqrt curve: more ink at light touch",
  },
  firm: {
    /** f(p) = p² — less responsive at low pressure */
    fn: (p) => {
      const v = Math.max(0, Math.min(1, p));
      return v * v;
    },
    label: "Firm",
    description: "quadratic curve: needs more pressure to darken",
  },
  exponential: {
    /** f(p) = (e^(2p) - 1)/(e^2 - 1) */
    fn: (p) => {
      const v = Math.max(0, Math.min(1, p));
      return (Math.exp(2 * v) - 1) / (Math.exp(2) - 1);
    },
    label: "Exponential",
    description: "Heavy feel, exponential ramp",
  },
};

const DEFAULT_CONFIG = {
  curve: "linear",
  minPressure: 0.0,    // pressure values < this are treated as 0 (skip)
  tiltResponse: 0.6,   // 0..1 — how strongly tilt reduces opacity
  showHover: true,     // whether to render pen-hover preview circle
};

export function getPressureConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setPressureConfig(cfg) {
  const merged = { ...getPressureConfig(), ...cfg };
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

/**
 * Apply the pressure curve to a raw pressure value, then clamp.
 * Returns a multiplier in [0, 1.5] suitable for `baseSize * (0.5 + multiplier)`.
 */
export function applyPressureCurve(rawPressure, curveName, opts = {}) {
  const preset = STYLUS_PRESETS[curveName] || STYLUS_PRESETS.linear;
  const minP = opts.minPressure != null ? opts.minPressure : getPressureConfig().minPressure;
  let p = rawPressure == null ? 1.0 : rawPressure;
  // Apply sensitivity floor (drop tiny wobbles).
  if (p < minP) p = 0;
  return Math.max(0, Math.min(1.5, preset.fn(p) * 1.5));
}

/**
 * Compute opacity multiplier for given tilt (in degrees 0..90) and
 * response factor (0..1). 0 → no effect, 1 → max reduction.
 */
export function tiltAlpha(tiltDegrees, response) {
  const tilt = Math.min(1, Math.abs(tiltDegrees || 0) / 90);
  return Math.max(0.4, 1 - tilt * response);
}
