package com.mnexus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * BatteryOptimizationReceiver (v2.20.0 stub).
 *
 * The manifest declares this receiver at android:name=".BatteryOptimizationReceiver"
 * to keep the linkage consistent. The JS layer (widgets/android_settings.js)
 * dispatches an ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS intent via
 * the system Settings activity directly — this receiver is intentionally
 * lightweight and only logs lifecycle events so we can observe boot
 * and power-state transitions in logcat.
 *
 * Real implementations would schedule SyncWorker jobs here when the device
 * exits battery saver mode.
 */
public class BatteryOptimizationReceiver extends BroadcastReceiver {
    private static final String TAG = "MnexusBattery";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        Log.d(TAG, "BatteryOptimizationReceiver: " + intent.getAction());
        // No-op stub. The JS layer handles the actual
        // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS prompt.
    }
}
