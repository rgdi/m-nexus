// Logger models: LogLevel enum + LogEntry class.
//
// Características:
//   - 6 niveles: TRACE, DEBUG, INFO, WARN, ERROR, FATAL
//   - Cada log incluye: timestamp ISO-8601, session_id, user_id, device_id,
//     build/version, componente, mensaje, contexto (Map<String, dynamic>)
//   - Output a múltiples sinks:
//     1) dart:developer log() → visible en DevTools y `flutter logs`
//     2) android.util.Log → visible en `adb logcat -s mnexus:*`
//     3) In-memory ring buffer (últimos 1000 logs) → recuperable vía platform channel
//     4) Archivo rotativo en getApplicationDocumentsDirectory() (.log files)
//   - Nivel de log configurable en runtime vía SharedPreferences
//   - Sampling rate para producción (no loguear más de N por segundo)
//   - Lazy evaluation: solo evalúa el mensaje si el nivel lo permite
//   - Performance: cada log < 0.1ms en release mode
//
// Uso:
//   final log = AdvancedLogger.instance;
//   log.info('home', 'App started');
//   log.warn('sync', 'Backend unreachable', context: {'url': url, 'attempt': 3});
//   log.error('record', 'Mic permission denied', error: e, stack: s);
//
// Para ver en adb:
//   adb logcat -s mnexus:* -v threadtime
//   adb logcat -s mnexus:INFO  # solo INFO+
//
// Para cambiar nivel en runtime (con app corriendo):
//   adb shell am broadcast -a com.mnexus.SET_LOG_LEVEL --es level DEBUG
//   adb shell am start-activity -a com.mnexus.SET_LOG_LEVEL --es level TRACE
import 'dart:async';
import 'dart:convert';
import 'dart:developer' as dev;
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum LogLevel {
  trace(0, 'TRACE', 0xFF9E9E9E),
  debug(1, 'DEBUG', 0xFF2196F3),
  info(2, 'INFO', 0xFF4CAF50),
  warn(3, 'WARN', 0xFFFF9800),
  error(4, 'ERROR', 0xFFF44336),
  fatal(5, 'FATAL', 0xFFB71C1C);

  final int value;
  final String label;
  final int color;
  const LogLevel(this.value, this.label, this.color);

  static LogLevel fromString(String s) {
    switch (s.toUpperCase()) {
      case 'TRACE': return trace;
      case 'DEBUG': return debug;
      case 'INFO': return info;
      case 'WARN':
      case 'WARNING': return warn;
      case 'ERROR': return error;
      case 'FATAL': return fatal;
      default: return info;
    }
  }
}

class LogEntry {
  final DateTime timestamp;
  final LogLevel level;
  final String component;
  final String message;
  final Map<String, dynamic> context;
  final String? error;
  final String? stack;
  final String sessionId;
  final String userId;
  final String deviceId;
  final String appVersion;
  final String osVersion;

  const LogEntry({
    required this.timestamp,
    required this.level,
    required this.component,
    required this.message,
    required this.context,
    required this.sessionId,
    required this.userId,
    required this.deviceId,
    required this.appVersion,
    required this.osVersion,
    this.error,
    this.stack,
  });

  /// Formato compacto para adb logcat (una línea)
  String toAdbLine() {
    final ts = timestamp.toIso8601String();
    final ctx = context.isEmpty ? '' : ' ${jsonEncode(context)}';
    final err = error == null ? '' : ' err=$error';
    return '$ts [$level] $component | session=$sessionId | $message$ctx$err';
  }

  /// Formato pretty para archivo
  String toFileLine() {
    final ts = timestamp.toIso8601String();
    final buf = StringBuffer()
      ..writeln('[$ts] $level $component')
      ..writeln('  session: $sessionId')
      ..writeln('  user: $userId  device: $deviceId')
      ..writeln('  app: $appVersion  os: $osVersion')
      ..writeln('  message: $message');
    if (context.isNotEmpty) {
      buf.writeln('  context: ${const JsonEncoder.withIndent("    ").convert(context)}');
    }
    if (error != null) {
      buf.writeln('  error: $error');
    }
    if (stack != null) {
      buf.writeln('  stack:\n${stack!.split("\n").map((l) => "    $l").join("\n")}');
    }
    return buf.toString();
  }

  Map<String, dynamic> toJson() => {
    'ts': timestamp.toIso8601String(),
    'level': level.label,
    'component': component,
    'message': message,
    'context': context,
    'sessionId': sessionId,
    'userId': userId,
    'deviceId': deviceId,
    'appVersion': appVersion,
    'osVersion': osVersion,
    if (error != null) 'error': error,
    if (stack != null) 'stack': stack,
  };
}

class AdvancedLogger {
