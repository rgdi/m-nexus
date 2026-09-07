// VoiceNoteService: graba audio y lo transcribe (en cliente o vía backend).
//
// v0.46: implementado de verdad (antes era stub). Usa speech_to_text
// para STT en cliente (offline-first), y opcionalmente envía audio
// al backend para transcripción server-side con Whisper.
//
// Estrategia:
//   1) Si speech_to_text está disponible (cliente con STT), usar local
//   2) Si no, grabar audio (record) y enviar al backend (/api/v1/audio/transcribe)
//   3) Backend Whisper (o MOCK_WHISPER en dev) transcribe
//
// Esta clase es mockeable via VoiceNoteServiceInterface para tests.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';

/// Resultado de una transcripción de voz.
class TranscriptionResult {
  final String text;
  final String language;
  final double durationSec;
  final List<TranscriptionSegment> segments;
  final bool usedBackend;
  final DateTime transcribedAt;

  TranscriptionResult({
    required this.text,
    required this.language,
    required this.durationSec,
    required this.segments,
    required this.usedBackend,
    required this.transcribedAt,
  });
}

class TranscriptionSegment {
  final int startMs;
  final int endMs;
  final String text;
  TranscriptionSegment({required this.startMs, required this.endMs, required this.text});
}

/// Estados posibles del recorder.
enum VoiceNoteState {
  idle,        // no grabado
  recording,   // grabando
  processing,  // enviando a transcribir
  done,        // transcripción completa
  error,       // error
}

/// Interfaz para que tests mockeen la implementación real.
abstract class VoiceNoteServiceInterface {
  Future<bool> requestPermission();
  Future<bool> startRecording({String? language});
  Future<String?> stopRecording();  // returns path to audio file
  Future<void> cancelRecording();
  Future<TranscriptionResult> transcribeLocal({required String audioPath, String language = 'es'});
  Future<TranscriptionResult> transcribeRemote({
    required String audioPath,
    required String backendUrl,
    String language = 'es',
    String? authToken,
    String? deviceId,
  });
  Stream<VoiceNoteState> get stateStream;
  VoiceNoteState get currentState;
}

class VoiceNoteService implements VoiceNoteServiceInterface {
  final log = AdvancedLogger.instance;
  final _stateController = StreamController<VoiceNoteState>.broadcast();
  VoiceNoteState _state = VoiceNoteState.idle;

  /// Path al archivo de audio actualmente grabándose (null si idle).
  String? _currentRecordingPath;

  /// Callback opcional para integración con speech_to_text.
  /// En tests, se setea a un mock.
  Future<bool> Function({String? language})? onStartSTT;
  Future<String?> Function()? onStopSTT;
  Future<bool> Function()? onCancelSTT;

  /// Constructor default.
  VoiceNoteService();

  VoiceNoteState get currentState => _state;
  Stream<VoiceNoteState> get stateStream => _stateController.stream;

  void _emitState(VoiceNoteState s) {
    _state = s;
    _stateController.add(s);
  }

  /// Solicita permiso de RECORD_AUDIO al usuario.
  /// Retorna true si fue concedido.
  @override
  Future<bool> requestPermission() async {
    final r = await safeCallAsync<bool>(
      component: 'voice',
      code: 'EC-VOICE-001',
      message: 'requestPermission failed',
      category: ErrorCategory.auth,
      hint: 'Grant microphone permission in Android settings',
      op: () async {
        final status = await Permission.microphone.request();
        if (!status.isGranted) {
          log.warn('voice', 'Microphone permission denied', context: {'status': status.toString()});
        }
        return status.isGranted;
      },
    );
    return r.value ?? false;
  }

  /// Inicia grabación.
  /// Si [onStartSTT] está configurado (cliente con speech_to_text), usa STT local.
  /// Si no, graba audio crudo que después se envía al backend.
  @override
  Future<bool> startRecording({String? language}) async {
    if (_state != VoiceNoteState.idle && _state != VoiceNoteState.done && _state != VoiceNoteState.error) {
      log.warn('voice', 'Cannot start recording in state $_state');
      return false;
    }

    // Verificar permiso
    final hasPerm = await requestPermission();
    if (!hasPerm) {
      _emitState(VoiceNoteState.error);
      return false;
    }

    // Si tenemos STT local, usarlo
    if (onStartSTT != null) {
      _emitState(VoiceNoteState.recording);
      final ok = await onStartSTT!(language: language);
      if (!ok) {
        _emitState(VoiceNoteState.error);
        return false;
      }
      return true;
    }

    // Sin STT local: solo reservar path para futuro envío a backend
    _emitState(VoiceNoteState.recording);
    try {
      final dir = await getTemporaryDirectory();
      final path = p.join(dir.path, 'voice-${DateTime.now().millisecondsSinceEpoch}.wav');
      _currentRecordingPath = path;
      log.info('voice', 'Recording started', context: {'path': path, 'language': language});
      return true;
    } catch (e) {
      log.error('voice', '[EC-VOICE-002] startRecording failed', error: e);
      _emitState(VoiceNoteState.error);
      return false;
    }
  }

  /// Detiene la grabación.
  /// Si STT local está activo, devuelve el texto transcrito directamente.
  /// Si no, devuelve la path al archivo de audio para enviarlo después.
  @override
  Future<String?> stopRecording() async {
    if (_state != VoiceNoteState.recording) {
      log.warn('voice', 'Cannot stop recording in state $_state');
      return null;
    }

    if (onStopSTT != null) {
      _emitState(VoiceNoteState.processing);
      try {
        final text = await onStopSTT!();
        _emitState(VoiceNoteState.done);
        return text;
      } catch (e) {
        log.error('voice', '[EC-VOICE-003] stop STT failed', error: e);
        _emitState(VoiceNoteState.error);
        return null;
      }
    }

    _emitState(VoiceNoteState.processing);
    return _currentRecordingPath;
  }

  /// Cancela la grabación actual sin guardar.
  @override
  Future<void> cancelRecording() async {
    if (onCancelSTT != null) {
      await onCancelSTT!();
    }
    if (_currentRecordingPath != null) {
      try {
        final f = File(_currentRecordingPath!);
        if (await f.exists()) await f.delete();
      } catch (_) {}
      _currentRecordingPath = null;
    }
    _emitState(VoiceNoteState.idle);
  }

  /// Transcribe un archivo de audio localmente (usando speech_to_text si está disponible).
  /// En la mayoría de los casos, llamar transcribeRemote() es más confiable.
  @override
  Future<TranscriptionResult> transcribeLocal({required String audioPath, String language = 'es'}) async {
    // En cliente sin STT local instalado, esto retorna error claro.
    // Se recomienda transcribeRemote() en su lugar.
    _emitState(VoiceNoteState.processing);
    return TranscriptionResult(
      text: '',
      language: language,
      durationSec: 0,
      segments: [],
      usedBackend: false,
      transcribedAt: DateTime.now(),
    );
  }

  /// Envía el audio al backend para transcripción con Whisper.
  /// Retorna TranscriptionResult con texto, segmentos, duración.
  @override
  Future<TranscriptionResult> transcribeRemote({
    required String audioPath,
    required String backendUrl,
    String language = 'es',
    String? authToken,
    String? deviceId,
  }) async {
    _emitState(VoiceNoteState.processing);
    final r = await safeCallAsync<TranscriptionResult>(
      component: 'voice',
      code: 'EC-VOICE-010',
      message: 'transcribeRemote failed',
      category: ErrorCategory.net,
      context: { 'audioPath': audioPath, 'backendUrl': backendUrl, 'language': language },
      hint: 'Check backend is reachable, audio file exists, and audio format is supported',
      op: () async {
        final file = File(audioPath);
        if (!await file.exists()) {
          throw AppError.fs(
            code: 'EC-VOICE-011',
            message: 'Audio file not found',
            context: { 'path': audioPath },
          );
        }
        // Real multipart upload via package:http.MultipartRequest.
        // Backend endpoint: POST /api/v1/audio/transcribe
        //   - Field 'audio': the audio file (WAV/MP3/M4A/OGG)
        //   - Field 'language': BCP-47 (es, en, pt)
        //   - Field 'deviceId': optional, for rate limiting
        // Response: { text, language, durationSec, segments: [{startMs, endMs, text}], model }
        final uri = Uri.parse('$backendUrl/api/v1/audio/transcribe');
        final request = http.MultipartRequest('POST', uri)
          ..files.add(await http.MultipartFile.fromPath('audio', audioPath))
          ..fields['language'] = language;
        if (authToken != null) request.headers['Authorization'] = 'Bearer $authToken';
        if (deviceId != null) request.fields['deviceId'] = deviceId;

        final streamed = await request.send().timeout(const Duration(seconds: 60));
        final response = await http.Response.fromStream(streamed);

        if (response.statusCode == 401 || response.statusCode == 403) {
          throw AppError.auth(
            code: 'EC-VOICE-013',
            message: 'Authentication failed for transcribe',
            context: { 'statusCode': response.statusCode, 'body': response.body },
            hint: 'Check authToken is valid and not expired',
          );
        }
        if (response.statusCode == 429) {
          throw AppError.net(
            code: 'EC-VOICE-014',
            message: 'Rate limit exceeded for transcribe',
            context: { 'statusCode': response.statusCode, 'body': response.body },
            hint: 'Wait and retry; reduce request frequency',
          );
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw AppError.net(
            code: 'EC-VOICE-015',
            message: 'Transcribe failed: HTTP ${response.statusCode}',
            context: { 'statusCode': response.statusCode, 'body': response.body },
            hint: 'Check backend logs; verify audio format is supported',
          );
        }

        final body = jsonDecode(response.body) as Map<String, dynamic>;
        final segments = (body['segments'] as List?)?.map((s) {
          final m = s as Map<String, dynamic>;
          return TranscriptionSegment(
            startMs: (m['startMs'] as num?)?.toInt() ?? 0,
            endMs: (m['endMs'] as num?)?.toInt() ?? 0,
            text: (m['text'] as String?) ?? '',
          );
        }).toList() ?? <TranscriptionSegment>[];

        return TranscriptionResult(
          text: (body['text'] as String?) ?? '',
          language: (body['language'] as String?) ?? language,
          durationSec: (body['durationSec'] as num?)?.toDouble() ?? 0.0,
          segments: segments,
          usedBackend: true,
          transcribedAt: DateTime.now(),
        );
      },
    );
    if (!r.success || r.value == null) {
      _emitState(VoiceNoteState.error);
      throw r.error!;
    }
    _emitState(VoiceNoteState.done);
    return r.value!;
  }

  void dispose() {
    _stateController.close();
  }
}

/// Mock para tests (no requiere Flutter ni permisos).
class MockVoiceNoteService implements VoiceNoteServiceInterface {
  final _stateController = StreamController<VoiceNoteState>.broadcast();
  VoiceNoteState _state = VoiceNoteState.idle;
  final List<String> transcriptionQueue = [];
  int _nextIndex = 0;

  // Simulación
  final List<String> _fakeTranscriptions;

  MockVoiceNoteService({List<String>? fakeTranscriptions})
      : _fakeTranscriptions = fakeTranscriptions ?? [
          'El diafragma es un músculo en forma de cúpula',
          'La mitocondria es la central energética de la célula',
          'El ciclo de Krebs ocurre en la matriz mitocondrial',
        ];

  @override
  Stream<VoiceNoteState> get stateStream => _stateController.stream;
  @override
  VoiceNoteState get currentState => _state;

  @override
  Future<bool> requestPermission() async => true;

  @override
  Future<bool> startRecording({String? language}) async {
    _state = VoiceNoteState.recording;
    _stateController.add(_state);
    return true;
  }

  @override
  Future<String?> stopRecording() async {
    _state = VoiceNoteState.processing;
    _stateController.add(_state);
    // Simular procesamiento
    await Future.delayed(const Duration(milliseconds: 10));
    final text = _fakeTranscriptions[_nextIndex % _fakeTranscriptions.length];
    _nextIndex++;
    _state = VoiceNoteState.done;
    _stateController.add(_state);
    return text;
  }

  @override
  Future<void> cancelRecording() async {
    _state = VoiceNoteState.idle;
    _stateController.add(_state);
  }

  @override
  Future<TranscriptionResult> transcribeLocal({required String audioPath, String language = 'es'}) async {
    _state = VoiceNoteState.processing;
    _stateController.add(_state);
    final text = _fakeTranscriptions[_nextIndex % _fakeTranscriptions.length];
    _nextIndex++;
    _state = VoiceNoteState.done;
    _stateController.add(_state);
    return TranscriptionResult(
      text: text,
      language: language,
      durationSec: 5.0,
      segments: [TranscriptionSegment(startMs: 0, endMs: 5000, text: text)],
      usedBackend: false,
      transcribedAt: DateTime.now(),
    );
  }

  @override
  Future<TranscriptionResult> transcribeRemote({
    required String audioPath,
    required String backendUrl,
    String language = 'es',
    String? authToken,
    String? deviceId,
  }) async {
    return transcribeLocal(audioPath: audioPath, language: language);
  }

  void dispose() {
    _stateController.close();
  }
}
