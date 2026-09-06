package com.mnexus.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Foreground service for voice note recording.
 *
 * v0.44: stub implementation (recording uses RecorderService via MediaRecorder,
 * not a separate Service). Kept for MainActivity API compatibility.
 */
class RecordingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    companion object {
        fun stopRecording(context: Context) {
            // No-op: recording is handled via MediaRecorder in the plugin/recorder
        }
    }
}
