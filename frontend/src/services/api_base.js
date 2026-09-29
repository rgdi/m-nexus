// api_base.js — Shared backend URL detection (v2.20.0).
//
// v2.18.0 added Capacitor detection in api.js. v2.19.0 duplicated it in
// device_id.js. This module centralizes the logic so any service can
// resolve the right backend URL without depending on api.js.
//
// Priority:
//   0b. window.MNEXUS_BACKEND_PORT (runtime port only, no scheme/host)
//       Rescued from the stale branch fix/v2.27.1-audit-issues, which had
//       the idea right but the default pointing at 4500 — a port the
//       backend stopped using. The port is now read from the current
//       default, so the two cannot drift again.
//   1. window.MNEXUS_BACKEND_URL (runtime override)
//   1b. localStorage["mnexus.backend.url"] (persisted runtime override,
//       written by the capture scripts / dev tooling so a page reload
//       keeps pointing at the dev backend instead of the default port)
//   2. Capacitor (Android emulator: 10.0.2.2, or user override)
//   3. Web localhost dev (http://localhost:4000)
//   4. Web production (same origin)

export function detectApiBase() {
  if (typeof window !== "undefined" && window.MNEXUS_BACKEND_URL) {
    return String(window.MNEXUS_BACKEND_URL).replace(/\/$/, "");
  }
  if (typeof localStorage !== "undefined") {
    try {
      const persisted = localStorage.getItem("mnexus.backend.url");
      if (persisted) return persisted.replace(/\/$/, "");
    } catch { /* private mode / disabled storage */ }
  }
  const isCapacitor =
    typeof window !== "undefined" &&
    (window.Capacitor || (location.protocol === "https:" && location.hostname === "localhost" && location.port === ""));
  if (isCapacitor) {
    return "http://10.0.2.2:4000";
  }
  if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    // v2.38.0: was :4100. The backend binds config.port, which defaults
    // to 4000 (backend/src/config.ts), so every call made without a
    // persisted override went to a port where nothing listens. The
    // route sweep caught it as ERR_CONNECTION_REFUSED on the study
    // badge and the dashboard fetch.
    const port = window.MNEXUS_BACKEND_PORT || 4000;
    return `http://${location.hostname}:${port}`;
  }
  if (typeof location !== "undefined") {
    return `${location.protocol}//${location.host}`;
  }
  return "http://localhost:4000";
}
