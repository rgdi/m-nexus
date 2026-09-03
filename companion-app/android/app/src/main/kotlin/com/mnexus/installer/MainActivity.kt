package com.mnexus.installer

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity: FlutterActivity() {
    private val INSTALL_CHANNEL = "com.mnexus.installer/install"
    private val DEVICE_CHANNEL = "com.mnexus.installer/device"
    private val CALENDAR_CHANNEL = "com.mnexus.installer/calendar"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // ── Install APK ────────────────────────────────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, INSTALL_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "installApk" -> {
                    val filePath = call.argument<String>("filePath")
                    if (filePath == null) {
                        result.error("invalid_args", "filePath is required", null)
                        return@setMethodCallHandler
                    }
                    try {
                        val file = File(filePath)
                        if (!file.exists()) {
                            result.error("file_not_found", "APK not found at $filePath", null)
                            return@setMethodCallHandler
                        }
                        val uri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                            FileProvider.getUriForFile(
                                this,
                                "${applicationContext.packageName}.fileprovider",
                                file
                            )
                        } else {
                            Uri.fromFile(file)
                        }

                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "application/vnd.android.package-archive")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        }
                        startActivity(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("install_failed", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }

        // ── Device info (v0.31) ───────────────────────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DEVICE_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getAndroidId" -> {
                    @Suppress("HardwareIds")
                    val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
                    result.success(androidId)
                }
                "getDeviceModel" -> {
                    result.success("${Build.MANUFACTURER} ${Build.MODEL}")
                }
                "getOsVersion" -> {
                    result.success("Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
                }
                "getPackageName" -> {
                    result.success(applicationContext.packageName)
                }
                "getAppVersion" -> {
                    try {
                        val info = applicationContext.packageManager.getPackageInfo(applicationContext.packageName, 0)
                        result.success(info.versionName)
                    } catch (e: Exception) {
                        result.error("version_failed", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }

        // ── Google Calendar (v0.31) ───────────────────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CALENDAR_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "checkCalendarPermission" -> {
                    val granted = checkSelfPermission(android.Manifest.permission.READ_CALENDAR) ==
                            android.content.pm.PackageManager.PERMISSION_GRANTED
                    result.success(granted)
                }
                "requestCalendarPermission" -> {
                    requestPermissions(arrayOf(android.Manifest.permission.READ_CALENDAR), 1001)
                    // No esperamos el callback aquí; el caller debe usar checkCalendarPermission después
                    result.success(true)
                }
                "openCalendarSettings" -> {
                    // Abre la app de Calendar del sistema
                    try {
                        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALENDAR)
                        startActivity(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("no_calendar_app", "No calendar app installed", null)
                    }
                }
                "listCalendars" -> {
                    // Lee los calendarios del Content Provider
                    try {
                        val calendars = mutableListOf<Map<String, Any?>>()
                        val projection = arrayOf(
                            android.provider.CalendarContract.Calendars._ID,
                            android.provider.CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                            android.provider.CalendarContract.Calendars.ACCOUNT_NAME,
                            android.provider.CalendarContract.Calendars.OWNER_ACCOUNT,
                            android.provider.CalendarContract.Calendars.CALENDAR_COLOR,
                            android.provider.CalendarContract.Calendars.VISIBLE
                        )
                        val cursor = contentResolver.query(
                            android.provider.CalendarContract.Calendars.CONTENT_URI,
                            projection,
                            null, null, null
                        )
                        cursor?.use { c ->
                            while (c.moveToNext()) {
                                calendars.add(mapOf(
                                    "id" to c.getLong(0),
                                    "name" to (c.getString(1) ?: ""),
                                    "account" to (c.getString(2) ?: ""),
                                    "owner" to (c.getString(3) ?: ""),
                                    "color" to c.getInt(4),
                                    "visible" to (c.getInt(5) == 1)
                                ))
                            }
                        }
                        result.success(calendars)
                    } catch (e: SecurityException) {
                        result.error("permission_denied", "READ_CALENDAR not granted", null)
                    } catch (e: Exception) {
                        result.error("query_failed", e.message, null)
                    }
                }
                "listEvents" -> {
                    val startMs = call.argument<Number>("startMs")?.toLong() ?: 0L
                    val endMs = call.argument<Number>("endMs")?.toLong() ?: 0L
                    try {
                        val events = mutableListOf<Map<String, Any?>>()
                        val projection = arrayOf(
                            android.provider.CalendarContract.Events._ID,
                            android.provider.CalendarContract.Events.TITLE,
                            android.provider.CalendarContract.Events.DESCRIPTION,
                            android.provider.CalendarContract.Events.DTSTART,
                            android.provider.CalendarContract.Events.DTEND,
                            android.provider.CalendarContract.Events.EVENT_LOCATION,
                            android.provider.CalendarContract.Events.CALENDAR_ID
                        )
                        val selection = "${android.provider.CalendarContract.Events.DTSTART} >= ? AND ${android.provider.CalendarContract.Events.DTEND} <= ?"
                        val args = arrayOf(startMs.toString(), endMs.toString())
                        val cursor = contentResolver.query(
                            android.provider.CalendarContract.Events.CONTENT_URI,
                            projection,
                            selection, args,
                            "${android.provider.CalendarContract.Events.DTSTART} ASC"
                        )
                        cursor?.use { c ->
                            while (c.moveToNext()) {
                                events.add(mapOf(
                                    "id" to c.getLong(0),
                                    "title" to (c.getString(1) ?: ""),
                                    "description" to (c.getString(2) ?? ""),
                                    "startMs" to c.getLong(3),
                                    "endMs" to c.getLong(4),
                                    "location" to (c.getString(5) ?? ""),
                                    "calendarId" to c.getLong(6)
                                ))
                            }
                        }
                        result.success(events)
                    } catch (e: SecurityException) {
                        result.error("permission_denied", "READ_CALENDAR not granted", null)
                    } catch (e: Exception) {
                        result.error("query_failed", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
