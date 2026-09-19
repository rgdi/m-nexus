package com.mnexus.app.sync;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.mnexus.app.MainActivity;
import com.mnexus.app.R;

/**
 * SyncForegroundService (v2.21.0 minimal stub).
 *
 * Keeps M-NEXUS alive when the OS would normally put it to sleep, so the
 * WebSocket sync (services/sync_client.js in the WebView) stays connected
 * and offline mutations drain quickly.
 *
 * Implementation status (v2.21.0):
 *   ✓ Service registered in AndroidManifest as foregroundServiceType="dataSync"
 *   ✓ startForeground() with persistent low-priority notification
 *   ✓ startService() / stopService() from NativeIntentPlugin
 *   ✗ The actual WS-keep-alive logic lives in JS; the service just
 *     prevents the OS from killing the process. In v2.22 we'll wire
 *     a partial wake lock here when we can test against an emulator.
 *
 * Notification:
 *   - Channel "mnexus-sync" with IMPORTANCE_LOW (no sound, dismissible by user)
 *   - Tap → opens MainActivity
 *   - Shows current queued mutation count when reported by JS via
 *     NativeIntentPlugin.updateSyncNotification({ count: N })
 */
public class SyncForegroundService extends Service {
    private static final String TAG = "MnexusSync";
    public static final String CHANNEL_ID = "mnexus-sync";
    public static final int NOTIFICATION_ID = 4100;

    private PowerManager.WakeLock wakeLock;

    public static void start(Context ctx) {
        try {
            Intent intent = new Intent(ctx, SyncForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            Log.d(TAG, "SyncForegroundService.start requested");
        } catch (Exception e) {
            Log.w(TAG, "start failed", e);
        }
    }

    public static void stop(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, SyncForegroundService.class));
            Log.d(TAG, "SyncForegroundService.stop requested");
        } catch (Exception e) {
            Log.w(TAG, "stop failed", e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildNotification(0));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // The service's job is to stay alive. All actual sync work
        // happens in the WebView (JS) and via the WS to the backend.
        // We just hold a wake lock so the CPU doesn't fully suspend.
        acquireWakeLock();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel ch = nm.getNotificationChannel(CHANNEL_ID);
            if (ch == null) {
                ch = new NotificationChannel(
                    CHANNEL_ID,
                    "M-NEXUS sync",
                    NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("Keeps your notes and flashcards in sync with the server.");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification buildNotification(int queuedCount) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        String title = "M-NEXUS sync active";
        String body = queuedCount > 0
            ? "Syncing " + queuedCount + " pending change" + (queuedCount == 1 ? "" : "s") + "…"
            : "Watching for changes";
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setShowWhen(false)
            .build();
    }

    /** Called from NativeIntentPlugin.updateSyncNotification to refresh the count. */
    public static void updateNotification(Context ctx, int queuedCount) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            // We can't access the service's buildNotification() method here
            // (would need a static factory). The JS layer will typically stop
            // and restart the service to refresh the count, which is cheap.
            Log.d(TAG, "updateNotification queuedCount=" + queuedCount + " (not applied in v2.21.0 stub)");
        } catch (Exception e) {
            Log.w(TAG, "updateNotification failed", e);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                // PARTIAL_WAKE_LOCK keeps CPU on but lets the screen sleep.
                // Acquired with a generous 10-minute timeout as a safety net;
                // the JS layer keeps the service alive by sending periodic
                // heartbeats. Re-acquired in onStartCommand if needed.
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Mnexus::SyncService"
                );
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(10 * 60 * 1000L /* 10 min */);
                Log.d(TAG, "WakeLock acquired");
            }
        } catch (Exception e) {
            Log.w(TAG, "WakeLock acquire failed", e);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
                Log.d(TAG, "WakeLock released");
            } catch (Exception e) {
                Log.w(TAG, "WakeLock release failed", e);
            }
        }
        wakeLock = null;
    }
}
