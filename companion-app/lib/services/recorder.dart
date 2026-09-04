// Recorder: servicio de grabación de audio usando `record` 5.2.0.
//
// v0.32: usa record 5.2.0 (compatible Flutter 3.24 + AGP 8.3+).
// Antes: usaba record 5.1.2 que requiere AGP 8.12+ + Gradle 8.13+.
//
// API: AudioRecorder().start(RecordConfig(), path: ...)

import 'dart:async';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

enum RecorderState { idle, recording, paused, stopped, error }

class RecordingResult {
  final String filePath;
  final Duration duration;
  final DateTime startedAt;
  final String? linkedCalendarEventId;
  final String? className;

  const RecordingResult({
    required this.filePath,
    required this.duration,
    required this.startedAt,
    this.linkedCalendarEventId,
    this.className,
  });
}

class AudioRecorderService {
  final AudioRecorder _recorder = AudioRecorder();
  String? _currentFilePath;
  DateTime? _startedAt;
  Timer? _ticker;
  Duration _elapsed = Duration.zero;
  String? _linkedEventId;
  String? _className;

  final _stateController = StreamController<RecorderState>.broadcast();
  final _elapsedController = StreamController<Duration>.broadcast();
  final _levelController = StreamController<double>.broadcast();

  Stream<RecorderState> get stateStream => _stateController.stream;
  Stream<Duration> get elapsedStream => _elapsedController.stream;
  Stream<double> get levelStream => _levelController.stream;
  RecorderState _state = RecorderState.idle;
  RecorderState get state => _state;
  Duration get elapsed => _elapsed;
  String? get currentFilePath => _currentFilePath;
  String? get linkedEventId => _linkedEventId;
  String? get className => _className;

  /// Verifica y solicita el permiso de micrófono.
  /// Devuelve true si se concedió.
  Future<bool> ensureMicrophonePermission() async {
    final status = await Permission.microphone.status;
    if (status.isGranted) return true;
    if (status.isPermanentlyDenied) return false;
    final result = await Permission.microphone.request();
    return result.isGranted;
  }

  /// Inicia una grabación. Devuelve el path del archivo o null.
  Future<String?> start({
    String? linkedCalendarEventId,
    String? className,
  }) async {
    if (_state == RecorderState.recording) return _currentFilePath;
    if (!await ensureMicrophonePermission()) {
      _setState(RecorderState.error);
      return null;
    }

    final dir = await getApplicationDocumentsDirectory();
    final recordingsDir = Directory(p.join(dir.path, 'voice_notes'));
    if (!await recordingsDir.exists()) {
      await recordingsDir.create(recursive: true);
    }
    final ts = DateTime.now().millisecondsSinceEpoch;
    final filename = 'recording_$ts.m4a';
    final filePath = p.join(recordingsDir.path, filename);

    try {
      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 128000,
          sampleRate: 44100,
          numChannels: 2,
        ),
        path: filePath,
      );
      _currentFilePath = filePath;
      _startedAt = DateTime.now();
      _elapsed = Duration.zero;
      _linkedEventId = linkedCalendarEventId;
      _className = className;
      _setState(RecorderState.recording);
      _startTicker();
      return filePath;
    } catch (e) {
      _setState(RecorderState.error);
      return null;
    }
  }

  /// Pausa la grabación actual.
  Future<void> pause() async {
    if (_state != RecorderState.recording) return;
    try {
      await _recorder.pause();
      _setState(RecorderState.paused);
      _stopTicker();
    } catch (_) {}
  }

  /// Reanuda la grabación pausada.
  Future<void> resume() async {
    if (_state != RecorderState.paused) return;
    try {
      await _recorder.resume();
      _setState(RecorderState.recording);
      _startTicker();
    } catch (_) {}
  }

  /// Detiene la grabación y devuelve el resultado.
  Future<RecordingResult?> stop() async {
    if (_state != RecorderState.recording && _state != RecorderState.paused) {
      return null;
    }
    try {
      await _recorder.stop();
    } catch (_) {}
    _stopTicker();
    final result = RecordingResult(
      filePath: _currentFilePath ?? '',
      duration: _elapsed,
      startedAt: _startedAt ?? DateTime.now(),
      linkedCalendarEventId: _linkedEventId,
      className: _className,
    );
    _setState(RecorderState.stopped);
    _reset();
    return result;
  }

  Future<bool> isRecording() async {
    try {
      return await _recorder.isRecording();
    } catch (_) {
      return _state == RecorderState.recording;
    }
  }

  Future<void> cancel() async {
    try {
      await _recorder.cancel();
    } catch (_) {}
    _stopTicker();
    _setState(RecorderState.idle);
    _reset();
  }

  void _setState(RecorderState s) {
    _state = s;
    _stateController.add(s);
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (_startedAt == null) return;
      _elapsed = DateTime.now().difference(_startedAt!);
      _elapsedController.add(_elapsed);
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  void _reset() {
    _currentFilePath = null;
    _startedAt = null;
    _elapsed = Duration.zero;
    _linkedEventId = null;
    _className = null;
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_state == RecorderState.stopped) _setState(RecorderState.idle);
    });
  }

  Future<void> dispose() async {
    _stopTicker();
    try {
      await _recorder.dispose();
    } catch (_) {}
    await _stateController.close();
    await _elapsedController.close();
    await _levelController.close();
  }
}
