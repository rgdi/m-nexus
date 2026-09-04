// Tests del AudioRecorderService (state machine básico).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/recorder.dart';

void main() {
  group('AudioRecorderService state', () {
    test('estado inicial es idle', () {
      final r = AudioRecorderService();
      expect(r.state, RecorderState.idle);
      expect(r.elapsed, Duration.zero);
      expect(r.currentFilePath, isNull);
      expect(r.linkedEventId, isNull);
      expect(r.className, isNull);
    });

    test('RecordingResult guarda todos los campos', () {
      final now = DateTime(2026, 9, 4, 10, 30);
      final result = RecordingResult(
        filePath: '/tmp/rec.aac',
        duration: const Duration(minutes: 45),
        startedAt: now,
        linkedCalendarEventId: 'evt-123',
        className: 'Anatomía - Módulo 3',
      );
      expect(result.filePath, '/tmp/rec.aac');
      expect(result.duration.inMinutes, 45);
      expect(result.startedAt, now);
      expect(result.linkedCalendarEventId, 'evt-123');
      expect(result.className, 'Anatomía - Módulo 3');
    });

    test('RecorderState enum tiene los 5 valores esperados', () {
      expect(RecorderState.values, hasLength(5));
      expect(RecorderState.values, contains(RecorderState.idle));
      expect(RecorderState.values, contains(RecorderState.recording));
      expect(RecorderState.values, contains(RecorderState.paused));
      expect(RecorderState.values, contains(RecorderState.stopped));
      expect(RecorderState.values, contains(RecorderState.error));
    });
  });
}
