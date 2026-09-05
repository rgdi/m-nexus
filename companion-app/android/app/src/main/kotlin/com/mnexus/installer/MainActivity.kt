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
    private val RECORDING_CHANNEL = "com.mnexus.installer/recording"
    private val PERMISSIONS_CHANNEL = "com.mnexus.installer/permissions"
    private val VAULT_CHANNEL = "com.mnexus.installer/vault"
    private val LOGGER_CHANNEL = "com.mnexus.installer/logger"
    private val safPathPrefs = "mnexus_saf_path"

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
        // ── Recording foreground service (v0.32) ──────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, RECORDING_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "startRecordingService" -> {
                    val title = call.argument<String>("title") ?: "Grabando clase"
                    RecordingService.startRecording(applicationContext, title)
                    result.success(null)
                }
                "stopRecordingService" -> {
                    RecordingService.stopRecording(applicationContext)
                    result.success(null)
                }
                "isRecordingServiceRunning" -> {
                    // Simplificado: siempre devolvemos true si se llamó start
                    // (en una versión futura podríamos trackear el estado)
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }

        // ── Permissions extras (v0.34) ─────────────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PERMISSIONS_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "openManageStorageSettings" -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                            intent.data = Uri.parse("package:${applicationContext.packageName}")
                            startActivity(intent)
                        } else {
                            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                            intent.data = Uri.parse("package:${applicationContext.packageName}")
                            startActivity(intent)
                        }
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("open_failed", e.message, null)
                    }
                }
                "isManageStorageGranted" -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            result.success(android.os.Environment.isExternalStorageManager())
                        } else {
                            result.success(true)
                        }
                    } catch (e: Exception) {
                        result.error("check_failed", e.message, null)
                    }
                }
                "isInstallPermissionGranted" -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            val granted = packageManager.canRequestPackageInstalls()
                            result.success(granted)
                        } else {
                            result.success(true)
                        }
                    } catch (e: Exception) {
                        result.error("check_failed", e.message, null)
                    }
                }
                "requestIgnoreBatteryOptimizations" -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                            intent.data = Uri.parse("package:${applicationContext.packageName}")
                            startActivity(intent)
                            result.success(true)
                        } else {
                            // En Android < 6 no hay optimización de batería
                            result.success(true)
                        }
                    } catch (e: Exception) {
                        result.error("battery_failed", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }

        // ── Vault / SAF picker (v0.34) ─────────────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, VAULT_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getSafPath" -> {
                    val prefs = applicationContext.getSharedPreferences(safPathPrefs, android.content.Context.MODE_PRIVATE)
                    result.success(prefs.getString("path", null))
                }
                "setSafPath" -> {
                    val path = call.argument<String>("path") ?: ""
                    val prefs = applicationContext.getSharedPreferences(safPathPrefs, android.content.Context.MODE_PRIVATE)
                    prefs.edit().putString("path", path).apply()
                    result.success(true)
                }
                "pickVault" -> {
                    // Abre el selector de Storage Access Framework (SAF)
                    try {
                        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                        intent.flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                       Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                                       Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        startActivityForResult(intent, 4242)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("saf_failed", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }

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
                "openEvent" -> {
                    // Abre el detalle de un evento en la app de Calendar
                    val eventId = call.argument<Number>("eventId")?.toLong() ?: 0L
                    try {
                        val uri = android.content.ContentUris.withAppendedId(
                            android.provider.CalendarContract.Events.CONTENT_URI, eventId
                        )
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "vnd.android.cursor.item/event")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("open_event_failed", e.message, null)
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
                    val calendarId = call.argument<Number>("calendarId")?.toLong()
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
                        // v0.37: si calendarId se pasa, filtrar la query nativa
                        val selection = buildString {
                            append("${android.provider.CalendarContract.Events.DTSTART} >= ? AND ")
                            append("${android.provider.CalendarContract.Events.DTEND} <= ?")
                            if (calendarId != null) {
                                append(" AND ${android.provider.CalendarContract.Events.CALENDAR_ID} = ?")
                            }
                        }
                        val args = mutableListOf<String>(startMs.toString(), endMs.toString())
                        if (calendarId != null) {
                            args.add(calendarId.toString())
                        }
                        val cursor = contentResolver.query(
                            android.provider.CalendarContract.Events.CONTENT_URI,
                            projection,
                            selection, args.toTypedArray(),
                            "${android.provider.CalendarContract.Events.DTSTART} ASC"
                        )
                        cursor?.use { c ->
                            while (c.moveToNext()) {
                                events.add(mapOf(
                                    "id" to c.getLong(0),
                                    "title" to (c.getString(1) ?: ""),
                                    "description" to (c.getString(2) ?: ""),
                                    "startMs" to c.getLong(3),
                                    "endMs" to c.getLong(4),
                                    "location" to (c.getString(5) ?: ""),
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

        // ── Advanced Logger (v0.39) ────────────────────────────
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LOGGER_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "log" -> {
                    val level = call.argument<Number>("level")?.toInt() ?: 2
                    val tag = call.argument<String>("tag") ?: "mnexus"
                    val message = call.argument<String>("message") ?: ""
                    when (level) {
                        0 -> android.util.Log.v(tag, message)
                        1 -> android.util.Log.d(tag, message)
                        2 -> android.util.Log.i(tag, message)
                        3 -> android.util.Log.w(tag, message)
                        4 -> android.util.Log.e(tag, message)
                        5 -> android.util.Log.wtf(tag, message)
                        else -> android.util.Log.i(tag, message)
                    }
                    result.success(null)
                }
                "setLevel" -> {
                    // Level is set on the Dart side via SharedPreferences
                    result.success(null)
                }
                "getRecent" -> result.success(listOf<Map<String, Any?>>())
                "getStats" -> result.success(mapOf("level" to "INFO", "bufferSize" to 0))
                else -> result.notImplemented()
            }
        }
    }
}
