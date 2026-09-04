// Recorder: servicio de grabación de audio usando speech_to_text 7.x.
//
// v0.32: speech_to_text 7.x es estable y compatible con Flutter 3.24 + AGP 8.3+.
// Antes: `record` 5.x/6.x es incompatible con nuestro toolchain (record_android
// 1.5.2 uses deprecated flutter.flutterSdkPath API in AGP 8.3; 2.x requires
// Dart 3.12 = Flutter 3.27+).
//
// API: SpeechToText().initialize() + listen() + stop()

import 'dart:async';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

enum RecorderState { idle, recording, paused, stopped, error }

class RecordingResult {
  final String filePath;
  final Duration duration;
  final DateTime startedAt;
  final String? linkedCalendarEventId;
  final String? className;
  final String transcript;

  const RecordingResult({
    required this.filePath,
    required this.duration,
    required this.startedAt,
    this.linkedCalendarEventId,
    this.className,
    this.transcript = '',
  });
}

class AudioRecorderService {
  final SpeechToText _stt = SpeechToText();
  bool _initialized = false;
  String? _currentFilePath;
  DateTime? _startedAt;
  Timer? _ticker;
  Duration _elapsed = Duration.zero;
  String? _linkedEventId;
  String? _className;
  String _transcript = '';
  final List<String> _transcriptLines = [];

  final _stateController = StreamController<RecorderState>.broadcast();
  final _elapsedController = StreamController<Duration>.broadcast();
  final _transcriptController = StreamController<String>.broadcast();

  Stream<RecorderState> get stateStream => _stateController.stream;
  Stream<Duration> get elapsedStream => _elapsedController.stream;
  Stream<String> get transcriptStream => _transcriptController.stream;
  RecorderState _state = RecorderState.idle;
  RecorderState get state => _state;
  Duration get elapsed => _elapsed;
  String? get currentFilePath => _currentFilePath;
  String? get linkedEventId => _linkedEventId;
  String? get className => _className;
  String get transcript => _transcript;

  /// Verifica y solicita el permiso de micrófono.
  Future<bool> ensureMicrophonePermission() async {
    final status = await Permission.microphone.status;
    if (status.isGranted) return true;
    if (status.isPermanentlyDenied) return false;
    final result = await Permission.microphone.request();
    return result.isGranted;
  }

  /// Inicializa el STT engine. Debe llamarse antes de start.
  Future<bool> initialize() async {
    if (_initialized) return true;
    _initialized = await _stt.initialize(
      onError: (e) {
        _setState(RecorderState.error);
      },
      onStatus: (status) {
        if (status == 'done' && _state == RecorderState.recording) {
          _setState(RecorderState.stopped);
        }
      },
    );
    return _initialized;
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
    if (!await initialize()) {
      _setState(RecorderState.error);
      return null;
    }

    final dir = await getApplicationDocumentsDirectory();
    final recordingsDir = Directory(p.join(dir.path, 'voice_notes'));
    if (!await recordingsDir.exists()) {
      await recordingsDir.create(recursive: true);
    }
    final ts = DateTime.now().millisecondsSinceEpoch;
    final filename = 'recording_$ts.txt'; // guardamos el transcript
    final filePath = p.join(recordingsDir.path, filename);

    _currentFilePath = filePath;
    _startedAt = DateTime.now();
    _elapsed = Duration.zero;
    _linkedEventId = linkedCalendarEventId;
    _className = className;
    _transcript = '';
    _transcriptLines.clear();

    try {
      await _stt.listen(
        onResult: (SpeechRecognitionResult r) {
          if (r.finalResult) {
            _transcriptLines.add(r.recognizedWords);
            _transcript = _transcriptLines.join(' ');
            _transcriptController.add(_transcript);
          } else {
            // parcial
            _transcriptController.add(r.recognizedWords);
          }
        },
        listenOptions: SpeechListenOptions(
          listenMode: ListenMode.dictation,
          cancelOnError: true,
          listenFor: const Duration(hours: 4),
          pauseFor: const Duration(days: 1),
          partialResults: true,
          localeId: 'es_ES',
        ),
      );
      _setState(RecorderState.recording);
      _startTicker();
      return filePath;
    } catch (e) {
      _setState(RecorderState.error);
      return null;
    }
  }

  /// Pausa: en speech_to_text no hay pause nativo, guardamos la transcripción
  /// parcial y paramos el listening. El usuario puede reanudar con resume().
  Future<void> pause() async {
    if (_state != RecorderState.recording) return;
    try {
      await _stt.stop();
      _setState(RecorderState.paused);
      _stopTicker();
    } catch (_) {}
  }

  /// Reanuda: vuelve a iniciar el listening manteniendo el transcript previo.
  Future<void> resume() async {
    if (_state != RecorderState.paused) return;
    try {
      await _stt.listen(
        onResult: (SpeechRecognitionResult r) {
          if (r.finalResult) {
            _transcriptLines.add(r.recognizedWords);
            _transcript = _transcriptLines.join(' ');
            _transcriptController.add(_transcript);
          }
        },
        listenOptions: SpeechListenOptions(
          listenMode: ListenMode.dictation,
          cancelOnError: true,
          listenFor: const Duration(hours: 4),
          pauseFor: const Duration(days: 1),
          partialResults: true,
          localeId: 'es_ES',
        ),
      );
      _setState(RecorderState.recording);
      _startTicker();
    } catch (_) {}
  }

  /// Detiene y devuelve el resultado (incluye el transcript).
  Future<RecordingResult?> stop() async {
    if (_state != RecorderState.recording && _state != RecorderState.paused) {
      return null;
    }
    try {
      await _stt.stop();
    } catch (_) {}
    _stopTicker();
    final result = RecordingResult(
      filePath: _currentFilePath ?? '',
      duration: _elapsed,
      startedAt: _startedAt ?? DateTime.now(),
      linkedCalendarEventId: _linkedEventId,
      className: _className,
      transcript: _transcript,
    );
    // Guarda el transcript en disco
    if (_currentFilePath != null) {
      try {
        await File(_currentFilePath!).writeAsString(_transcript);
      } catch (_) {}
    }
    _setState(RecorderState.stopped);
    _reset();
    return result;
  }

  /// Detiene sin guardar (cancela).
  Future<void> cancel() async {
    try {
      await _stt.cancel();
    } catch (_) {}
    _stopTicker();
    _setState(RecorderState.idle);
    _reset();
  }

  /// Verifica si hay recordings disponibles (true si speech_to_text puede grabar).
  Future<bool> isAvailable() async {
    if (!_initialized) await initialize();
    return _initialized;
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
    await _stateController.close();
    await _elapsedController.close();
    await _transcriptController.close();
  }
}
