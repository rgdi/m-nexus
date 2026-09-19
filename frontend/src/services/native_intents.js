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
