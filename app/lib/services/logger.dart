// AdvancedLogger (v0.39): sistema de logging exhaustivo para la app.

import 'dart:async';
import 'dart:convert';
import 'dart:developer' as dev;
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'logger_models.dart';

  static AdvancedLogger? _instance;
  static AdvancedLogger get instance {
    _instance ??= AdvancedLogger._();
    return _instance!;
  }

  AdvancedLogger._();

  // ── Config ─────────────────────────────────────────
  LogLevel _level = kDebugMode ? LogLevel.debug : LogLevel.info;
  String _sessionId = '';
  String _userId = '';
  String _deviceId = '';
  String _appVersion = '';
  String _osVersion = '';
  String _logDirPath = '';
  final int _maxBufferSize = 1000;
  final int _maxFileBytes = 5 * 1024 * 1024; // 5 MB
  bool _enableFile = true;
  final bool _enableAdb = true;

  // ── State ──────────────────────────────────────────
  final List<LogEntry> _buffer = [];
  final _controller = StreamController<LogEntry>.broadcast();
  Timer? _flushTimer;
  IOSink? _currentSink;
  File? _currentFile;
  int _currentFileBytes = 0;
  int _currentSecond = 0;
  int _currentSecondCount = 0;
  static const int _maxPerSecond = 50; // sampling

  /// Stream de logs (para UI en vivo).
  Stream<LogEntry> get stream => _controller.stream;

  LogLevel get level => _level;
  int get bufferSize => _buffer.length;
  List<LogEntry> get recentLogs => List.unmodifiable(_buffer);

  /// Inicializa con metadatos de la app.
  Future<void> init({
    required String userId,
    required String deviceId,
    required String appVersion,
    required String osVersion,
  }) async {
    _userId = userId;
    _deviceId = deviceId;
    _appVersion = appVersion;
    _osVersion = osVersion;
    _sessionId = 's${DateTime.now().millisecondsSinceEpoch}';

    // Cargar nivel persistido
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('mnexus.log_level');
    if (saved != null) _level = LogLevel.fromString(saved);

    // Inicializar directorio de logs
    if (_enableFile) {
      try {
        final docs = await getApplicationDocumentsDirectory();
        _logDirPath = p.join(docs.path, 'logs');
        await Directory(_logDirPath).create(recursive: true);
        await _rotateFile();
      } catch (e) {
        // No se puede escribir a disco, OK
        _enableFile = false;
      }
    }

    // BroadcastReceiver para cambio de nivel desde adb
    if (_isAndroid) {
      const channel = MethodChannel('com.mnexus.app/logger');
      channel.setMethodCallHandler((call) async {
        if (call.method == 'setLevel') {
          final level = call.arguments as String?;
          if (level != null) {
            await setLevel(LogLevel.fromString(level));
            return 'ok: $level';
          }
        } else if (call.method == 'getRecent') {
          final n = (call.arguments as int?) ?? 100;
          return _buffer.take(n).map((e) => e.toJson()).toList();
        } else if (call.method == 'getStats') {
          return {
            'level': _level.label,
            'bufferSize': _buffer.length,
            'sessionId': _sessionId,
            'logDir': _logDirPath,
          };
        }
        return null;
      });
    }

    _flushTimer?.cancel();
    _flushTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _currentSink?.flush();
    });

    info('logger', 'AdvancedLogger initialized',
      context: {
        'level': _level.label,
        'sessionId': _sessionId,
        'logDir': _logDirPath,
      });
  }

  /// Cambia el nivel de log y lo persiste.
  Future<void> setLevel(LogLevel level) async {
    _level = level;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('mnexus.log_level', level.label);
    info('logger', 'Log level changed', context: {'new_level': level.label});
  }

  // ── API principal ─────────────────────────────────
  void trace(String component, String message, {Map<String, dynamic>? context}) =>
    _log(LogLevel.trace, component, message, context: context);
  void debug(String component, String message, {Map<String, dynamic>? context}) =>
    _log(LogLevel.debug, component, message, context: context);
  void info(String component, String message, {Map<String, dynamic>? context}) =>
    _log(LogLevel.info, component, message, context: context);
  void warn(String component, String message, {Map<String, dynamic>? context, Object? error}) =>
    _log(LogLevel.warn, component, message, context: context, error: error);
  void error(String component, String message, {Map<String, dynamic>? context, Object? error, StackTrace? stack}) =>
    _log(LogLevel.error, component, message, context: context, error: error, stack: stack);
  void fatal(String component, String message, {Map<String, dynamic>? context, Object? error, StackTrace? stack}) =>
    _log(LogLevel.fatal, component, message, context: context, error: error, stack: stack);

  // ── Time / duration helpers ───────────────────────
  void timeStart(String component, String op) {
    _timers['$component:$op'] = DateTime.now();
  }
  void timeEnd(String component, String op, {Map<String, dynamic>? extra}) {
    final key = '$component:$op';
    final start = _timers.remove(key);
    if (start == null) return;
    final ms = DateTime.now().difference(start).inMilliseconds;
    info(component, '$op took ${ms}ms', context: {
      'operation': op,
      'duration_ms': ms,
      ...?extra,
    });
  }
  final Map<String, DateTime> _timers = {};

  // ── Network helper ────────────────────────────────
  void network({
    required String method,
    required String url,
    int? statusCode,
    int? durationMs,
    int? requestBytes,
    int? responseBytes,
    String? error,
  }) {
    info('http', '$method $url',
      context: {
        'method': method,
        'url': url,
        if (statusCode != null) 'status': statusCode,
        if (durationMs != null) 'duration_ms': durationMs,
        if (requestBytes != null) 'req_bytes': requestBytes,
        if (responseBytes != null) 'res_bytes': responseBytes,
        if (error != null) 'error': error,
      });
  }

  // ── Core ──────────────────────────────────────────
  void _log(LogLevel level, String component, String message,
      {Map<String, dynamic>? context, Object? error, StackTrace? stack}) {
    if (level.value < _level.value) return;

    // Sampling: máximo N por segundo
    final now = DateTime.now();
    if (now.second != _currentSecond) {
      _currentSecond = now.second;
      _currentSecondCount = 0;
    }
    _currentSecondCount++;
    if (_currentSecondCount > _maxPerSecond) return;

    final entry = LogEntry(
      timestamp: now,
      level: level,
      component: component,
      message: message,
      context: context ?? const {},
      sessionId: _sessionId,
      userId: _userId,
      deviceId: _deviceId,
      appVersion: _appVersion,
      osVersion: _osVersion,
      error: error?.toString(),
      stack: stack?.toString(),
    );

    // 1) Buffer in-memory
    _buffer.add(entry);
    if (_buffer.length > _maxBufferSize) {
      _buffer.removeAt(0);
    }

    // 2) Stream para UI
    _controller.add(entry);

    // 3) dart:developer log (visible en DevTools y flutter logs)
    dev.log(
      message,
      name: component,
      level: level.value * 100,
      error: error,
      stackTrace: stack,
    );

    // 4) adb logcat (via platform channel)
    if (_enableAdb) {
      LoggerSinks.logToAdb(entry);
    }

    // 5) Archivo
    if (_enableFile) {
      _logToFile(entry);
    }
  }

  /// Loguea a archivo rotativo
  Future<void> _logToFile(LogEntry entry) async {
    try {
      if (_currentSink == null) await _rotateFile();
      if (_currentSink == null) return;
      final line = entry.toFileLine();
      final bytes = utf8.encode(line);
      _currentSink!.add(bytes);
      _currentFileBytes += bytes.length;
      if (_currentFileBytes > _maxFileBytes) {
        await _rotateFile();
      }
    } catch (e) {
      // Silenciar errores de logging
    }
  }

  Future<void> _rotateFile() async {
    await _currentSink?.flush();
    await _currentSink?.close();
    _currentSink = null;

    if (_logDirPath.isEmpty) return;
    try {
      final now = DateTime.now();
      final fname = 'mnexus-${now.year}${_pad(now.month)}${_pad(now.day)}'
          '-${_pad(now.hour)}${_pad(now.minute)}${_pad(now.second)}.log';
      _currentFile = File(p.join(_logDirPath, fname));
      _currentSink = _currentFile!.openWrite(mode: FileMode.writeOnlyAppend);
      _currentFileBytes = 0;
    } catch (_) {
      _enableFile = false;
    }
  }

  String _pad(int n) => n.toString().padLeft(2, '0');

  /// Devuelve los últimos N logs en JSON.
  List<Map<String, dynamic>> getRecentJson({int n = 100}) {
    return _buffer.take(n).map((e) => e.toJson()).toList();
  }

  /// Stats del logger
  Map<String, dynamic> getStats() => {
    'level': _level.label,
    'bufferSize': _buffer.length,
    'maxBufferSize': _maxBufferSize,
    'sessionId': _sessionId,
    'logDir': _logDirPath,
    'enableFile': _enableFile,
    'enableAdb': _enableAdb,
  };

  /// Cierra sinks (llamar al salir de la app).
  Future<void> dispose() async {
    _flushTimer?.cancel();
    await _currentSink?.flush();
    await _currentSink?.close();
    _currentSink = null;
  }

  bool get _isAndroid {
    try {
      return defaultTargetPlatform == TargetPlatform.android;
    } catch (_) {
      return false;
    }
  }
}
