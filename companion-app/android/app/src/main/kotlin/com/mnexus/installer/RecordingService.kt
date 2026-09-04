package com.mnexus.installer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service para mantener la app activa mientras se graba.
 *
 * v0.32: Android mata las apps en background si no tienen un foreground service
 * (especialmente en API 26+). Este service muestra una notificación persistente
 * y mantiene la app en estado "foreground", permitiendo que la grabación
 * continúe aunque el usuario minimice la app o cambie a otra.
 *
 * Llamada desde Flutter:
 *   platform.invokeMethod('startRecordingService', {'className': 'Anatomía'})
 *   platform.invokeMethod('stopRecordingService')
 */
class RecordingService : Service() {
    companion object {
        const val CHANNEL_ID = "mnexus_recording"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "com.mnexus.installer.action.START"
        const val ACTION_STOP = "com.mnexus.installer.action.STOP"
        const val EXTRA_TITLE = "title"

        fun startRecording(context: Context, title: String) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TITLE, title)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopRecording(context: Context) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Grabando clase"
                startForegroundWithNotification(title)
            }
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun startForegroundWithNotification(title: String) {
        // Crear el canal (Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Grabación de clases",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notificación persistente mientras se graba una clase"
                setShowBadge(false)
            }
            mgr.createNotificationChannel(channel)
        }

        // Intent para volver a la app cuando el usuario toca la notificación
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = launchIntent?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        }

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("M-NEXUS · Grabando")
            .setContentText(title)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }
}
