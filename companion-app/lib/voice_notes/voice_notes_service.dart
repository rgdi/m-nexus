// v0.22: Servicio de voice notes — grabación + transcripción.
//
// La app móvil graba audio, lo sube al backend, y obtiene la transcripción.
// Diseñado para ser independiente de Obsidian (corre en background).

import 'dart:async';
import 'dart:io';
import 'package:record/record.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

/// Estado de la grabación.
enum RecordingState { idle, recording, paused, processing, completed, error }

class VoiceNoteRecording {
  final String id;
  final String filePath;
  final DateTime startedAt;
  final Duration duration;
  final String? classSubject;
  final double? scheduleConfidence;
  final String? transcript;
  final String? notePath;
  final RecordingState state;
  final String? errorMessage;

  const VoiceNoteRecording({
    required this.id,
    required this.filePath,
    required this.startedAt,
    required this.duration,
    this.classSubject,
    this.scheduleConfidence,
    this.transcript,
    this.notePath,
    this.state = RecordingState.idle,
    this.errorMessage,
  });

  VoiceNoteRecording copyWith({
    Duration? duration,
    String? classSubject,
    double? scheduleConfidence,
    String? transcript,
    String? notePath,
    RecordingState? state,
    String? errorMessage,
  }) {
    return VoiceNoteRecording(
      id: id,
      filePath: filePath,
      startedAt: startedAt,
      duration: duration ?? this.duration,
      classSubject: classSubject ?? this.classSubject,
      scheduleConfidence: scheduleConfidence ?? this.scheduleConfidence,
      transcript: transcript ?? this.transcript,
      notePath: notePath ?? this.notePath,
      state: state ?? this.state,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class VoiceNotesService {
  final AudioRecorder _recorder = AudioRecorder();
  final String backendUrl;
  final String authToken;
  String? _currentFilePath;
  DateTime? _startedAt;
  Timer? _ticker;
  final StreamController<VoiceNoteRecording> _controller = StreamController.broadcast();
  VoiceNoteRecording? _current;

  VoiceNotesService({required this.backendUrl, required this.authToken});

  Stream<VoiceNoteRecording> get stream => _controller.stream;
  VoiceNoteRecording? get current => _current;

  /// Verifica permisos de micrófono.
  Future<bool> hasPermission() async {
    return await _recorder.hasPermission();
  }

  /// Inicia una grabación.
  Future<VoiceNoteRecording?> startRecording({String? classHint}) async {
    if (await _recorder.isRecording()) return _current;
    final hasPerm = await _recorder.hasPermission();
    if (!hasPerm) return null;
    final dir = Directory.systemTemp;
    final file = File('${dir.path}/mnexus-${DateTime.now().millisecondsSinceEpoch}.m4a');
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100),
      path: file.path,
    );
    _currentFilePath = file.path;
    _startedAt = DateTime.now();
    _current = VoiceNoteRecording(
      id: 'rec-${DateTime.now().millisecondsSinceEpoch}',
      filePath: file.path,
      startedAt: _startedAt!,
      duration: Duration.zero,
      classSubject: classHint,
      state: RecordingState.recording,
    );
    _startTicker();
    _controller.add(_current!);
    return _current;
  }

  /// Pausa la grabación.
  Future<void> pause() async {
    if (await _recorder.isRecording()) {
      await _recorder.pause();
      _stopTicker();
      _current = _current?.copyWith(state: RecordingState.paused);
      _controller.add(_current!);
    }
  }

  /// Reanuda la grabación.
  Future<void> resume() async {
    if (await _recorder.isPaused()) {
      await _recorder.resume();
      _startTicker();
      _current = _current?.copyWith(state: RecordingState.recording);
      _controller.add(_current!);
    }
  }

  /// Detiene la grabación y la sube al backend.
  Future<VoiceNoteRecording?> stopAndUpload() async {
    _stopTicker();
    final path = await _recorder.stop();
    if (path == null) return _current;
    _current = _current?.copyWith(state: RecordingState.processing);
    _controller.add(_current!);
    try {
      final result = await _uploadAndTranscribe(path);
      _current = _current?.copyWith(
        state: RecordingState.completed,
        transcript: result.transcript,
        notePath: result.notePath,
        classSubject: result.subject ?? _current?.classSubject,
        scheduleConfidence: result.confidence,
      );
    } catch (e) {
      _current = _current?.copyWith(
        state: RecordingState.error,
        errorMessage: e.toString(),
      );
    }
    _controller.add(_current!);
    return _current;
  }

  /// Sube el audio al backend y obtiene la transcripción.
  Future<UploadResult> _uploadAndTranscribe(String filePath) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$backendUrl/audio/upload'),
    );
    request.headers['Authorization'] = 'Bearer $authToken';
    request.files.add(await http.MultipartFile.fromPath('audio', filePath));
    request.fields['startedAt'] = _startedAt?.millisecondsSinceEpoch.toString() ?? '';
    request.fields['durationMs'] = (_current?.duration.inMilliseconds ?? 0).toString();
    if (_current?.classSubject != null) {
      request.fields['classHint'] = _current!.classSubject!;
    }
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode != 200) {
      throw Exception('Upload failed: ${response.statusCode}');
    }
    final body = json.decode(response.body) as Map<String, dynamic>;
    return UploadResult(
      transcript: body['transcript'] as String? ?? '',
      subject: body['subject'] as String?,
      confidence: (body['confidence'] as num?)?.toDouble(),
      notePath: body['notePath'] as String?,
    );
  }

  /// Cancela y borra el archivo.
  Future<void> cancel() async {
    _stopTicker();
    if (await _recorder.isRecording() || await _recorder.isPaused()) {
      await _recorder.stop();
    }
    if (_currentFilePath != null) {
      final f = File(_currentFilePath!);
      if (f.existsSync()) f.deleteSync();
    }
    _current = _current?.copyWith(state: RecordingState.idle);
    _controller.add(_current!);
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (_startedAt == null) return;
      _current = _current?.copyWith(duration: DateTime.now().difference(_startedAt!));
      _controller.add(_current!);
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  Future<void> dispose() async {
    _stopTicker();
    await _recorder.dispose();
    await _controller.close();
  }
}

class UploadResult {
  final String transcript;
  final String? subject;
  final double? confidence;
  final String? notePath;
  const UploadResult({
    required this.transcript,
    this.subject,
    this.confidence,
    this.notePath,
  });
}
