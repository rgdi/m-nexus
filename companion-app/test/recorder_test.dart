// Tests del AudioRecorderService (speech_to_text 7.x).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/recorder.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AudioRecorderService state', () {
    test('estado inicial es idle', () {
      final r = AudioRecorderService();
      expect(r.state, RecorderState.idle);
      expect(r.elapsed, Duration.zero);
      expect(r.currentFilePath, isNull);
      expect(r.linkedEventId, isNull);
      expect(r.className, isNull);
      expect(r.transcript, isEmpty);
    });

    test('RecordingResult guarda todos los campos (incluye transcript)', () {
      final now = DateTime(2026, 9, 4, 10, 30);
      final result = RecordingResult(
        filePath: '/tmp/rec.txt',
        duration: const Duration(minutes: 45),
        startedAt: now,
        linkedCalendarEventId: 'evt-123',
        className: 'Anatomía - Módulo 3',
        transcript: 'Hoy vimos el sistema cardiovascular...',
      );
      expect(result.filePath, '/tmp/rec.txt');
      expect(result.duration.inMinutes, 45);
      expect(result.transcript, contains('sistema cardiovascular'));
    });

    test('RecorderState enum tiene los 5 valores esperados', () {
      expect(RecorderState.values, hasLength(5));
      expect(RecorderState.values, contains(RecorderState.idle));
      expect(RecorderState.values, contains(RecorderState.recording));
      expect(RecorderState.values, contains(RecorderState.paused));
      expect(RecorderState.values, contains(RecorderState.stopped));
      expect(RecorderState.values, contains(RecorderState.error));
    });

    test('Dispose no lanza', () async {
      final r = AudioRecorderService();
      await r.dispose();
    });
  });
}
