// services/pwa.js — PWA registration + install prompt + update flow.
//
// v2.36.0 — Chrome / ChromeOS / Android installability.
//   - Registers /sw.js on load (once per origin).
//   - Detects the `beforeinstallprompt` event so the UI can offer an
//     "Install app" button at the right moment.
//   - Surfaces service-worker updates without a surprise reload:
//     we show a toast with "Reload" / "Later" and only skipWaiting
//     when the user accepts.
//   - Bridges Background Sync: when the outbox has pending mutations
//     we ask the SW to register a sync tag, so queued writes flush
//     automatically the moment connectivity returns — even if the tab
//     was closed in the meantime.

const logger = createLogger("pwa");

let deferredPrompt = null;
let registration = null;
const listeners = new Set();

/** Subscribe to installability + update events. Returns an unsubscribe fn. */
export function onPwaEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(type, payload) {
  for (const fn of listeners) {
    try { fn({ type, ...payload }); } catch (e) { logger.warn("listener threw", e); }
  }
}

export function getRegistration() {
  return registration;
}

export function isInstallable() {
  return deferredPrompt !== null;
}

export function isStandalone() {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

/** Trigger the native install dialog. Resolves true if accepted. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  logger.info("install prompt", outcome);
  deferredPrompt = null;
  emit("install-result", { outcome });
  return outcome === "accepted";
}

/** Ask the SW to drain the outbox on the next reconnect. */
export async function requestBackgroundSync() {
  try {
    if (!registration) return false;
    if (!("sync" in registration)) {
      logger.debug("Background Sync not supported; relying on the online listener");
      return false;
    }
    await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "mnexus-register-sync" });
    return true;
  } catch (e) {
    logger.warn("Background Sync request failed", e);
    return false;
  }
}

/** Call once from main.js bootstrap. */
export async function registerPwa() {
  installPromptListener();
  if (!("serviceWorker" in navigator)) {
    logger.info("service workers unsupported; running without offline cache");
    return null;
  }
  // Only secure contexts support SW (https, or localhost).
  if (!window.isSecureContext) {
    logger.info("insecure context; skipping service worker registration");
    return null;
  }

  try {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    logger.info("service worker registered", registration.scope);

    // An updated worker may already be waiting.
    if (registration.waiting) {
      emit("update-available", { waiting: registration.waiting });
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        logger.debug("sw state", installing.state);
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          emit("update-available", { waiting: installing });
        }
      });
    });

    // Messages from the SW.
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      logger.debug("sw message", data.type);
      if (data.type === "mnexus-sw-activated") {
        emit("activated", { version: data.version });
      } else if (data.type === "mnexus-sync-request") {
        // The SW is asking the page to drain the outbox.
        emit("sync-request");
        import("./offline_queue.js")
          .then((q) => q.drainNow())
          .catch((e) => logger.warn("outbox drain failed", e));
      } else if (data.type === "mnexus-sw-version") {
        emit("version", { version: data.version });
      }
    });

    // Register a sync tag whenever the outbox grows.
    window.addEventListener("mnexus-outbox-changed", () => {
      requestBackgroundSync().catch(() => {});
    });

    return registration;
  } catch (e) {
    logger.warn("service worker registration failed", e);
    return null;
  }
}

/* ============================================================
 * installPromptListener
 *
 * v2.37.0. This file shipped in v2.36.0 with `deferredPrompt`,
 * `isInstallable()` and `promptInstall()` — and no listener ever
 * assigned to `deferredPrompt`. `isInstallable()` therefore returned
 * false forever and `promptInstall()` returned false on its first
 * line, so any "Install app" button built on these could never do
 * anything. Chrome fires `beforeinstallprompt` once, shortly after
 * load; miss it and the app is not installable for that session.
 *
 * The listener also has to swallow the event, or Chrome shows its
 * default mini-infobar and never fires the event again.
 *
 * Idempotent: safe to call from anywhere, only binds once.
 * ============================================================ */
let promptListenerBound = false;

export function installPromptListener() {
  if (promptListenerBound || typeof window === "undefined") return;
  promptListenerBound = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the event object — it holds prompt()/userChoice.
    e.preventDefault();
    deferredPrompt = e;
    logger.info("install prompt captured");
    emit("installable", { installable: true });
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    logger.info("app installed");
    emit("installed", { standalone: true });
  });

  // iOS Safari never fires beforeinstallprompt; there the only route
  // is Share → Add to Home Screen. Report the platform so the UI can
  // show instructions instead of a button that would do nothing.
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent || "");
  if (isIos && safari && !isStandalone()) {
    emit("installable", { installable: false, manual: "ios" });
  }
}

/** Apply a waiting update immediately (called by the "Reload" action). */
export async function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  logger.info("applying service worker update");
  waiting.postMessage({ type: "mnexus-skip-waiting" });
  // Give the SW a tick to activate, then hard-reload.
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => window.location.reload(),
    { once: true },
  );
  setTimeout(() => window.location.reload(), 1200);
}

/* ============================================================
 * Tiny structured logger (shared with the audit work).
 * ============================================================ */
export function createLogger(scope) {
  const PREFIX = `[${scope}]`;
  const enabled = () => {
    try {
      return localStorage.getItem("mnexus.debug") === "1" || location.hostname === "localhost";
    } catch {
      return true;
    }
  };
  return {
    debug: (...a) => { if (enabled()) console.debug(PREFIX, ...a); },
    info: (...a) => { if (enabled()) console.info(PREFIX, ...a); },
    warn: (...a) => console.warn(PREFIX, ...a),
    error: (...a) => console.error(PREFIX, ...a),
  };
}
