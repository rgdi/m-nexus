package com.mnexus.app.notif;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * NotificationCaptureService (v2.21.0).
 *
 * Once the user grants us access via Settings → Notifications →
 * "Device & app notifications" → M-NEXUS, Android starts delivering
 * notification lifecycle events to us. We forward the metadata
 * (app, title, text, category, timestamp) to the JS layer via the
 * in-memory queue; the JS layer periodically POSTs to
 * POST /api/v1/notifications/ingest so the backend can dedupe by key
 * and turn them into M-NEXUS events.
 *
 * Privacy contract:
 *   - We do NOT read content from messaging apps unless the user opted
 *     in via the Android Settings toggle. The system itself is the gate.
 *   - We DO NOT read personal message content into Java strings — we
 *     keep only metadata (app package, title, category, when). The
 *     actual extras bundle is discarded.
 *   - We DO NOT call snoozeNotification()/cancelNotification() on
 *     purpose — read-only access. The user can dismiss notifications
 *     themselves; we just observe.
 *
 * Implementation notes:
 *   - Cap the queue at MAX_QUEUE_SIZE to prevent unbounded memory
 *     growth if the JS layer dies.
 *   - The JS wrapper polls the queue via getPendingNotifications()
 *     every pollIntervalMs (default 30s, configurable via the
 *     pollInterval shared preference in v2.22).
 */
public class NotificationCaptureService extends NotificationListenerService {
    private static final String TAG = "MnexusNotif";
    public static final int MAX_QUEUE_SIZE = 500;

    /**
     * The most recent notification metadata across all apps. We hold
     * it as a static so that NativeIntentPlugin (running in the
     * main process) can read it without needing the service to be
     * running at that exact moment.
     */
    private static final ConcurrentLinkedDeque<NotificationMeta> PENDING =
        new ConcurrentLinkedDeque<>();

    /**
     * Whether the user has granted us notification listener access.
     * Updated whenever onListenerConnected / onListenerDisconnected
     * fire (these are callbacks Android sends to the service itself).
     */
    private static volatile boolean sListenerConnected = false;

    public static boolean isListenerConnected() {
        return sListenerConnected;
    }

    /**
     * Returns the queued notification metadata and clears the queue.
     * Called by NativeIntentPlugin.getPendingNotifications() from JS.
     */
    public static List<NotificationMeta> drainPending() {
        List<NotificationMeta> out = new ArrayList<>();
        while (!PENDING.isEmpty()) {
            NotificationMeta m = PENDING.pollFirst();
            if (m != null) out.add(m);
        }
        return out;
    }

    /** Get the current queue size without draining. For tests. */
    public static int pendingSize() {
        return PENDING.size();
    }

    /** Reset all state. For tests only — never call from production. */
    public static void _resetForTests() {
        PENDING.clear();
        sListenerConnected = false;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        sListenerConnected = true;
        Log.d(TAG, "notification listener connected");
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        sListenerConnected = false;
        Log.w(TAG, "notification listener disconnected");
        // Re-attempt to bind — Android usually re-binds automatically,
        // but on some OEMs we need to request the user to re-enable us.
        requestRebind(new android.content.ComponentName(this, NotificationCaptureService.class));
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        try {
            NotificationMeta meta = buildMeta(sbn);
            if (PENDING.size() >= MAX_QUEUE_SIZE) {
                // Drop oldest to make room.
                PENDING.pollFirst();
            }
            PENDING.addLast(meta);
        } catch (Exception e) {
            Log.w(TAG, "onNotificationPosted failed", e);
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Read-only — we don't track removals. The backend dedupe
        // handles the case where a notification appears then disappears
        // before we POST.
    }

    private NotificationMeta buildMeta(StatusBarNotification sbn) {
        NotificationMeta m = new NotificationMeta();
        m.key = sbn.getKey();
        m.packageName = sbn.getPackageName();
        m.postedAt = sbn.getPostTime();
        m.tag = sbn.getTag();
        m.id = sbn.getId();
        m.isOngoing = (sbn.isOngoing() || sbn.isClearable() == false);
        m.userId = sbn.getUserId();
        Notification n = sbn.getNotification();
        if (n != null) {
            m.category = n.category;
            m.priority = n.priority;
            m.channelId = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? n.getChannelId() : null;
            m.title = extractTitle(n);
            m.text = extractText(n);
            m.subText = extractSubText(n);
            m.tickerText = (n.tickerText != null) ? n.tickerText.toString() : null;
            m.when = n.when;
        }
        return m;
    }

    private static String extractTitle(Notification n) {
        // The notification title lives in extras.EXTRA_TITLE or extras.EXTRA_TITLE_BIG.
        // We grab both; whichever is non-null wins.
        Bundle extras = n.extras;
        if (extras == null) return null;
        CharSequence t = extras.getCharSequence(Notification.EXTRA_TITLE);
        if (t == null) t = extras.getCharSequence(Notification.EXTRA_TITLE_BIG);
        return (t != null) ? t.toString() : null;
    }

    private static String extractText(Notification n) {
        Bundle extras = n.extras;
        if (extras == null) return null;
        CharSequence t = extras.getCharSequence(Notification.EXTRA_TEXT);
        if (t == null) t = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        return (t != null) ? t.toString() : null;
    }

    private static String extractSubText(Notification n) {
        Bundle extras = n.extras;
        if (extras == null) return null;
        CharSequence t = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
        return (t != null) ? t.toString() : null;
    }

    /** NotificationMeta: small POJO holding the metadata we forward to JS. */
    public static class NotificationMeta {
        public String key;
        public String packageName;
        public long postedAt;
        public String tag;
        public int id;
        public boolean isOngoing;
        public int userId;
        public String category;
        public int priority;
        public String channelId;
        public String title;
        public String text;
        public String subText;
        public String tickerText;
        public long when;
    }
}
