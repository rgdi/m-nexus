// v0.22: Tests del servicio de voice notes (sin flutter_test, lógica pura).

// Para evitar el binding de Flutter, los tests solo validan modelos y
// estados, no el AudioRecorder real.

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/voice_notes/voice_notes_service.dart';

void main() {
  final _epoch = DateTime.fromMillisecondsSinceEpoch(0);
  group('VoiceNoteRecording', () {
    test('copyWith preserva campos no especificados', () {
      final r = VoiceNoteRecording(
        id: 'rec-1',
        filePath: '/tmp/a.m4a',
        startedAt: _epoch,
        duration: Duration.zero,
      );
      final r2 = r.copyWith(state: RecordingState.completed, transcript: 'hola');
      expect(r2.state, RecordingState.completed);
      expect(r2.transcript, 'hola');
      expect(r2.id, r.id);
      expect(r2.filePath, r.filePath);
    });

    test('copyWith actualiza duration', () {
      final r = VoiceNoteRecording(
        id: 'rec-1',
        filePath: '/tmp/a.m4a',
        startedAt: _epoch,
        duration: Duration.zero,
      );
      final r2 = r.copyWith(duration: const Duration(seconds: 5));
      expect(r2.duration, const Duration(seconds: 5));
    });
  });

  group('UploadResult', () {
    test('puede construirse con campos mínimos', () {
      const r = UploadResult(transcript: 'hola mundo');
      expect(r.transcript, 'hola mundo');
      expect(r.subject, isNull);
      expect(r.confidence, isNull);
      expect(r.notePath, isNull);
    });

    test('puede construirse con campos completos', () {
      const r = UploadResult(
        transcript: 'hola',
        subject: 'Anatomía',
        confidence: 0.95,
        notePath: '/Anatomía/2026-09-07.md',
      );
      expect(r.subject, 'Anatomía');
      expect(r.confidence, 0.95);
    });
  });
}
