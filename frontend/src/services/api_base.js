// api_base.js — Shared backend URL detection (v2.20.0).
//
// v2.18.0 added Capacitor detection in api.js. v2.19.0 duplicated it in
// device_id.js. This module centralizes the logic so any service can
// resolve the right backend URL without depending on api.js.
//
// Priority:
//   1. window.MNEXUS_BACKEND_URL (runtime override)
//   2. Capacitor (Android emulator: 10.0.2.2, or user override)
//   3. Web localhost dev (http://localhost:4100)
//   4. Web production (same origin)

export function detectApiBase() {
  if (typeof window !== "undefined" && window.MNEXUS_BACKEND_URL) {
    return String(window.MNEXUS_BACKEND_URL).replace(/\/$/, "");
  }
  const isCapacitor =
    typeof window !== "undefined" &&
    (window.Capacitor || (location.protocol === "https:" && location.hostname === "localhost" && location.port === ""));
  if (isCapacitor) {
    return "http://10.0.2.2:4100";
  }
  if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    return `http://${location.hostname}:4100`;
  }
  if (typeof location !== "undefined") {
    return `${location.protocol}//${location.host}`;
  }
  return "http://localhost:4100";
}
