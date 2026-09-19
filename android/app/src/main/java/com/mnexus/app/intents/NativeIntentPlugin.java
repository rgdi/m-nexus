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

/**
 * NativeIntentPlugin (v2.20.0).
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
 */
@CapacitorPlugin(name = "NativeIntents")
public class NativeIntentPlugin extends Plugin {

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
                // Some OEMs (Xiaomi, Huawei, Honor) don't expose the
                // action — fall back to the app's settings page.
                openAppDetailsFallback(ctx);
                call.resolve();
            }
        } else {
            // Pre-Marshmallow: battery optimization dialog doesn't exist.
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
            ignoring = true; // pre-M, no battery optimization concept
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        call.resolve(ret);
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
}
