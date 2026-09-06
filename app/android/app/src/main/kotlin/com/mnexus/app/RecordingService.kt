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
 * v0.44: stub implementation. Recording uses MediaRecorder directly
 * from the Dart side via flutter_sound. This service exists for
 * MainActivity API compatibility (startRecording/stopRecording).
 */
class RecordingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    companion object {
        fun startRecording(context: Context, title: String) {
            // No-op: recording is handled via MediaRecorder
        }

        fun stopRecording(context: Context) {
            // No-op: recording is handled via MediaRecorder
        }
    }
}
