package com.mnexus.app.intents;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.mnexus.app.sync.SyncForegroundService;

/**
 * NativeIntentPlugin (v2.20.0 + v2.21.0).
 *
 * Bridges native Android intents that don't have first-class Capacitor
 * equivalents. JS calls map to:
 *
 *   - openIgnoreBatteryOptimizations() → dispatches
 *       Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS so the user
 *       is prompted to whitelist M-NEXUS from doze / battery saver.
 *       On older Android (L+, API 21+) the action is supported; on devices
 *       that don't expose it, we fall back to opening the app's system
 *       settings page where the user can configure battery manually.
 *
 *   - openAppDetails() → Settings.ACTION_APPLICATION_DETAILS_SETTINGS
 *       (the system "App info" page) for the current package.
 *
 *   - isIgnoringBatteryOptimizations() → returns whether the user has
 *       already whitelisted us. Useful to render a different CTA in the
 *       JS layer based on the actual native state.
 *
 *   - openExternalUrl(url) → opens any http/https/mailto/tel/etc. URL in
 *       the system browser / appropriate handler. v2.21.0.
 *
 *   - shareText({ text, title, dialogTitle }) → triggers Android share
 *       sheet (ACTION_SEND with text/plain). v2.21.0.
 *
 *   - canOpenUrl(url) → queries PackageManager to check whether *some*
 *       installed app can handle the URL. Returns boolean. v2.21.0.
 */
@CapacitorPlugin(name = "NativeIntents")
public class NativeIntentPlugin extends Plugin {

    private static final String TAG = "MnexusNative";

    @PluginMethod
    public void openIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                ctx.startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                openAppDetailsFallback(ctx);
                call.resolve();
            }
        } else {
            openAppDetailsFallback(ctx);
            call.resolve();
        }
    }

    @PluginMethod
    public void openAppDetails(PluginCall call) {
        Context ctx = getContext();
        openAppDetailsFallback(ctx);
        call.resolve();
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        boolean ignoring = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                ignoring = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            }
        } else {
            ignoring = true;
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        call.resolve(ret);
    }

    /**
     * v2.21.0: open any external URL (http/https/mailto/tel/etc) in the
     * system's preferred handler. Returns { opened: boolean, error?: string }.
     *
     * Whitelisted schemes: http, https, mailto, tel, sms, geo, market, intent.
     * Other schemes (file://, content://, custom) are rejected — the JS layer
     * should not try to open arbitrary URIs from untrusted sources.
     */
    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String lower = url.trim().toLowerCase();
        boolean allowed =
            lower.startsWith("http://") ||
            lower.startsWith("https://") ||
            lower.startsWith("mailto:") ||
            lower.startsWith("tel:") ||
            lower.startsWith("sms:") ||
            lower.startsWith("geo:") ||
            lower.startsWith("market:") ||
            lower.startsWith("intent:");
        if (!allowed) {
            call.reject("scheme not allowed: " + lower.split(":", 2)[0]);
            return;
        }
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            JSObject ret = new JSObject();
            ret.put("opened", false);
            ret.put("error", "no handler for " + lower.split(":", 2)[0]);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("openExternalUrl failed: " + e.getMessage());
        }
    }

    /**
     * v2.21.0: open the Android share sheet with arbitrary text. Useful
     * for "share this flashcard", "share this note", "share this deck".
     *
     * Args: { text: string, title?: string, dialogTitle?: string }.
     * The subject (title) is used by email handlers; the dialogTitle
     * becomes the sheet header on Android 8+.
     */
    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        String title = call.getString("title", "");
        String dialogTitle = call.getString("dialogTitle", "Share");
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, text);
            if (!title.isEmpty()) intent.putExtra(Intent.EXTRA_SUBJECT, title);
            Intent chooser = Intent.createChooser(intent, dialogTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("shared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("shareText failed: " + e.getMessage());
        }
    }

    /**
     * v2.21.0: query whether the system has any app that can handle the
     * given URL. Used by the JS layer to render "Open in browser" buttons
     * conditionally.
     */
    @PluginMethod
    public void canOpenUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            boolean canOpen = intent.resolveActivity(ctx.getPackageManager()) != null;
            JSObject ret = new JSObject();
            ret.put("canOpen", canOpen);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("canOpen", false);
            call.resolve(ret);
        }
    }

    private void openAppDetailsFallback(Context ctx) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + ctx.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Last-resort: do nothing. JS layer can show a manual instructions dialog.
        }
    }

    /**
     * v2.21.0: start the SyncForegroundService so the OS keeps the app
     * alive for background sync. The service holds a partial wake lock
     * with a 10-min timeout (renewed each time the JS layer calls this
     * method again).
     */
    @PluginMethod
    public void startSyncService(PluginCall call) {
        SyncForegroundService.start(getContext());
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    /**
     * v2.21.0: stop the SyncForegroundService. The next sync attempt from
     * JS (e.g. autoDrainOnOnline) will re-start it if needed.
     */
    @PluginMethod
    public void stopSyncService(PluginCall call) {
        SyncForegroundService.stop(getContext());
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    /**
     * v2.21.0: update the foreground notification with the current queue
     * count so the user sees how many mutations are pending.
     */
    @PluginMethod
    public void updateSyncNotification(PluginCall call) {
        Integer count = call.getInt("count", 0);
        if (count == null) count = 0;
        SyncForegroundService.updateNotification(getContext(), count);
        JSObject ret = new JSObject();
        ret.put("updated", true);
        ret.put("count", count);
        call.resolve(ret);
    }
}
