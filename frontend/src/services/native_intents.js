// native_intents.js — JS wrapper for the NativeIntentPlugin (v2.20.0).
//
// On Android, the plugin dispatches Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
// (or the app's settings page on OEMs that don't expose that action).
// On web, the methods no-op with a console warning.
//
// Plugin registration: see android/app/src/main/java/com/mnexus/app/intents/NativeIntentPlugin.java
// (registered via MainActivity.registerPlugin).

let cachedCapacitor = null;
async function getCapacitor() {
  if (cachedCapacitor) return cachedCapacitor;
  if (typeof window === "undefined" || !window.Capacitor) {
    cachedCapacitor = false;
    return null;
  }
  try {
    // Plugins.registerPlugin is the modern API. NativeIntents is registered
    // by MainActivity at app startup.
    const cap = await import("@capacitor/core");
    cachedCapacitor = cap.Capacitor;
    return cachedCapacitor;
  } catch (e) {
    cachedCapacitor = false;
    return null;
  }
}

/**
 * Open the system "Ignore battery optimizations" dialog for M-NEXUS.
 * Returns true if the intent was dispatched, false if no-op (web).
 */
export async function openIgnoreBatteryOptimizations() {
  const cap = await getCapacitor();
  if (!cap) {
    console.warn("[native_intents] not running in Capacitor");
    return false;
  }
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) {
      console.warn("[native_intents] plugin not registered");
      return false;
    }
    await NativeIntents.openIgnoreBatteryOptimizations();
    return true;
  } catch (e) {
    console.warn("[native_intents] openIgnoreBatteryOptimizations failed:", e);
    return false;
  }
}

/**
 * Open the app's system settings page (last-resort fallback).
 */
export async function openAppDetails() {
  const cap = await getCapacitor();
  if (!cap) return false;
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) return false;
    await NativeIntents.openAppDetails();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Query whether the user has already whitelisted M-NEXUS from battery optimizations.
 * Returns { ignoring: boolean, supported: boolean }. On web: { ignoring: true, supported: false }.
 */
export async function isIgnoringBatteryOptimizations() {
  const cap = await getCapacitor();
  if (!cap) return { ignoring: true, supported: false };
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) return { ignoring: true, supported: false };
    const r = await NativeIntents.isIgnoringBatteryOptimizations();
    return { ignoring: !!r.ignoring, supported: !!r.supported };
  } catch {
    return { ignoring: true, supported: false };
  }
}

/**
 * v2.21.0: open any external URL (http/https/mailto/tel/geo/etc.) in the
 * system's preferred handler. On web this opens the URL in a new tab.
 *
 * Schemes are whitelisted in the native plugin (http, https, mailto, tel,
 * sms, geo, market, intent). File:// / content:// / custom schemes are
 * rejected to avoid the JS layer accidentally opening dangerous URIs.
 *
 * Returns { opened: boolean } on success, throws on validation error.
 */
export async function openExternalUrl(url) {
  if (!url || typeof url !== "string") throw new Error("url must be a non-empty string");
  const cap = await getCapacitor();
  if (!cap) {
    // Web fallback: open in new tab.
    try {
      window.open(url, "_blank", "noopener,noreferrer");
      return { opened: true };
    } catch (e) {
      return { opened: false, error: String(e && e.message || e) };
    }
  }
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) {
      // Plugin missing → fallback to window.open for safety
      window.open(url, "_blank", "noopener,noreferrer");
      return { opened: true };
    }
    const r = await NativeIntents.openExternalUrl({ url });
    return { opened: !!(r && r.opened), error: r && r.error };
  } catch (e) {
    throw new Error("openExternalUrl rejected: " + String(e && e.message || e));
  }
}

/**
 * v2.21.0: open the native share sheet (Android: ACTION_SEND chooser;
 * web: navigator.share if available, else clipboard fallback).
 *
 * Args: { text: string, title?: string, dialogTitle?: string }
 *   - text: required, the body to share
 *   - title: optional, used as email subject / twitter title
 *   - dialogTitle: optional, header text for the share sheet
 *
 * On web with no navigator.share support, falls back to copying the text
 * to the clipboard so the user can paste manually.
 */
export async function shareText(opts) {
  if (!opts || typeof opts.text !== "string" || !opts.text) {
    throw new Error("text is required");
  }
  const cap = await getCapacitor();
  if (!cap) {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: opts.title,
          text: opts.text,
        });
        return { shared: true };
      } catch (e) {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    // Clipboard fallback.
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(opts.text);
        return { shared: true, fallback: "clipboard" };
      } catch {
        return { shared: false, fallback: "clipboard" };
      }
    }
    return { shared: false, fallback: "none" };
  }
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) {
      // No native plugin — try web share API as fallback.
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: opts.title, text: opts.text });
        return { shared: true };
      }
      return { shared: false };
    }
    const r = await NativeIntents.shareText({
      text: opts.text,
      title: opts.title || "",
      dialogTitle: opts.dialogTitle || "Share",
    });
    return { shared: !!(r && r.shared) };
  } catch (e) {
    throw new Error("shareText rejected: " + String(e && e.message || e));
  }
}

/**
 * v2.21.0: check whether the system has any handler for a URL.
 * On web: returns true (window.open always works).
 */
export async function canOpenUrl(url) {
  if (!url || typeof url !== "string") return false;
  const cap = await getCapacitor();
  if (!cap) return true;
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) return true;
    const r = await NativeIntents.canOpenUrl({ url });
    return !!(r && r.canOpen);
  } catch {
    return false;
  }
}

/**
 * v2.21.0: open the system Settings page where the user can grant
 * M-NEXUS notification listener access. Android does not allow us to
 * grant this programmatically — the user must enable it manually.
 *
 * Required toggle: Settings → Notifications → "Device & app
 * notifications" → M-NEXUS.
 *
 * On web: no-op (returns { opened: false }).
 */
export async function openNotificationListenerSettings() {
  const cap = await getCapacitor();
  if (!cap) return { opened: false, reason: "web" };
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) return { opened: false };
    await NativeIntents.openNotificationListenerSettings();
    return { opened: true };
  } catch (e) {
    return { opened: false, error: String(e && e.message || e) };
  }
}

/**
 * v2.21.0: query notification listener grant status.
 * Returns { granted: boolean, connected: boolean, pendingCount: number }.
 *
 *   - granted: true if the user has enabled us in Settings
 *   - connected: true if our service is currently bound and receiving events
 *   - pendingCount: how many notifications we've captured but not yet POSTed
 *
 * On web: { granted: false, connected: false, pendingCount: 0 }.
 */
export async function isNotificationListenerGranted() {
  const cap = await getCapacitor();
  if (!cap) return { granted: false, connected: false, pendingCount: 0 };
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) return { granted: false, connected: false, pendingCount: 0 };
    const r = await NativeIntents.isNotificationListenerGranted();
    return {
      granted: !!(r && r.granted),
      connected: !!(r && r.connected),
      pendingCount: Number(r && r.pendingCount || 0),
    };
  } catch {
    return { granted: false, connected: false, pendingCount: 0 };
  }
}

/**
 * v2.21.0: drain the native notification queue and return it to JS.
 * Each call drains — the caller is expected to POST the result
 * immediately to /api/v1/notifications/ingest and then drop the copy.
 *
 * Returns { notifications: [...], count: N }.
 *
 * On web: returns { notifications: [], count: 0 }.
 */
export async function getPendingNotifications() {
  const cap = await getCapacitor();
  if (!cap) return { notifications: [], count: 0 };
  try {
    const NativeIntents = cap.Plugins.NativeIntents;
    if (!NativeIntents) return { notifications: [], count: 0 };
    const r = await NativeIntents.getPendingNotifications();
    return {
      notifications: Array.isArray(r && r.notifications) ? r.notifications : [],
      count: Number(r && r.count || 0),
    };
  } catch {
    return { notifications: [], count: 0 };
  }
}
