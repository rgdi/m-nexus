// Recorder: servicio de grabación de audio usando flutter_sound.
//
// v0.32: usa flutter_sound (compatible Flutter 3.24 + AGP 8.3+).
// Antes: usaba record 5.1.2 que requiere AGP 8.12+.

import 'dart:async';
import 'dart:io';
import 'package:flutter_sound/flutter_sound.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';

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
  final FlutterSoundRecorder _recorder = FlutterSoundRecorder();
  final FlutterSoundPlayer _player = FlutterSoundPlayer();
  bool _recorderInitialized = false;
  bool _playerInitialized = false;
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

  /// Abre el recorder. Debe llamarse antes de start.
  Future<void> open() async {
    if (!_recorderInitialized) {
      await _recorder.openRecorder();
      _recorderInitialized = true;
    }
    if (!_playerInitialized) {
      await _player.openPlayer();
      _playerInitialized = true;
    }
  }

  /// Cierra el recorder (libera recursos).
  Future<void> close() async {
    _ticker?.cancel();
    if (_recorderInitialized) {
      await _recorder.closeRecorder();
      _recorderInitialized = false;
    }
    if (_playerInitialized) {
      await _player.closePlayer();
      _playerInitialized = false;
    }
    await _stateController.close();
    await _elapsedController.close();
    await _levelController.close();
  }

  /// Verifica y solicita el permiso de micrófono.
  /// Devuelve true si se concedió.
  Future<bool> ensureMicrophonePermission() async {
    final status = await Permission.microphone.status;
    if (status.isGranted) return true;
    if (status.isPermanentlyDenied) return false;
    final result = await Permission.microphone.request();
    return result.isGranted;
  }

  /// Inicia una grabación. Devuelve el path del archivo.
  Future<String?> start({
    String? linkedCalendarEventId,
    String? className,
  }) async {
    if (_state == RecorderState.recording) return _currentFilePath;
    if (!await ensureMicrophonePermission()) {
      _setState(RecorderState.error);
      return null;
    }

    await open();

    final dir = await getApplicationDocumentsDirectory();
    final recordingsDir = Directory(p.join(dir.path, 'voice_notes'));
    if (!await recordingsDir.exists()) {
      await recordingsDir.create(recursive: true);
    }
    final ts = DateTime.now().toIso8601String().replaceAll(':', '-').split('.').first;
    final filename = 'recording_$ts.aac';
    final filePath = p.join(recordingsDir.path, filename);

    try {
      await _recorder.startRecorder(
        toFile: filePath,
        codec: Codec.aacADTS,
        sampleRate: 44100,
        bitRate: 128000,
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
      await _recorder.pauseRecorder();
      _setState(RecorderState.paused);
      _stopTicker();
    } catch (_) {}
  }

  /// Reanuda la grabación pausada.
  Future<void> resume() async {
    if (_state != RecorderState.paused) return;
    try {
      await _recorder.resumeRecorder();
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
      await _recorder.stopRecorder();
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

  /// Reproduce una grabación existente.
  Future<void> play(String filePath) async {
    await open();
    try {
      await _player.startPlayer(
        fromURI: filePath,
        codec: Codec.aacADTS,
        whenFinished: () {
          // nothing
        },
      );
    } catch (_) {}
  }

  Future<void> stopPlayback() async {
    try {
      await _player.stopPlayer();
    } catch (_) {}
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
    // Después de stop, vuelve a idle
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_state == RecorderState.stopped) _setState(RecorderState.idle);
    });
  }
}
