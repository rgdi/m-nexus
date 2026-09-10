// transcription_queue.dart: cola de transcripciones en background.
//
// v0.50.1: despues de guardar una grabacion, el usuario puede
// encolarla para transcribir. Esta clase maneja la cola persistente
// (sobrevive a reinicios de la app) y procesa en background.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'logger.dart';
import 'voice_note_service.dart';

class TranscriptionJob {
  final String id;
  final String notePath; // nota con frontmatter
  final String audioPath; // ruta absoluta del audio
  final DateTime enqueuedAt;
  TranscriptionStatus status;
  String? resultText;
  String? error;

  TranscriptionJob({
    required this.id,
    required this.notePath,
    required this.audioPath,
    required this.enqueuedAt,
    this.status = TranscriptionStatus.pending,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'notePath': notePath,
    'audioPath': audioPath,
    'enqueuedAt': enqueuedAt.toIso8601String(),
    'status': status.name,
    'resultText': resultText,
    'error': error,
  };

  factory TranscriptionJob.fromJson(Map j) => TranscriptionJob(
    id: j['id'] as String,
    notePath: j['notePath'] as String,
    audioPath: j['audioPath'] as String,
    enqueuedAt: DateTime.parse(j['enqueuedAt'] as String),
    status: TranscriptionStatus.values.firstWhere(
      (s) => s.name == (j['status'] ?? 'pending'),
      orElse: () => TranscriptionStatus.pending,
    ),
    resultText: j['resultText'] as String?,
    error: j['error'] as String?,
  );
}

enum TranscriptionStatus { pending, processing, done, failed }

class TranscriptionQueue {
  final String vaultPath;
  final VoiceNoteService voiceService;
  static const _fileName = '.m-nexus-transcription-queue.json';
  final List<TranscriptionJob> _jobs = [];
  bool _processing = false;

  TranscriptionQueue(this.vaultPath) : voiceService = VoiceNoteService();

  File get _file => File(p.join(vaultPath, _fileName));

  /// v0.50.1: encola una transcripcion
  Future<void> enqueue(String notePath, String audioPath) async {
    final job = TranscriptionJob(
      id: 'tj-${DateTime.now().microsecondsSinceEpoch}',
      notePath: notePath,
      audioPath: audioPath,
      enqueuedAt: DateTime.now(),
    );
    _jobs.add(job);
    await _save();
    AdvancedLogger.instance.info('transcription-queue', 'enqueued', context: {'id': job.id});
    // Auto-start processing
    unawaited(processNext());
  }

  /// v0.50.1: procesa el siguiente job pending
  Future<void> processNext() async {
    if (_processing) return;
    await _load();
    final next = _jobs.firstWhere(
      (j) => j.status == TranscriptionStatus.pending,
      orElse: () => TranscriptionJob(
        id: '', notePath: '', audioPath: '',
        enqueuedAt: DateTime.now(),
        status: TranscriptionStatus.done,
      ),
    );
    if (next.id.isEmpty) return;
    _processing = true;
    next.status = TranscriptionStatus.processing;
    await _save();
    try {
      AdvancedLogger.instance.info('transcription-queue', 'processing', context: {'id': next.id});
      final result = await voiceService.transcribeFile(next.audioPath);
      next.status = TranscriptionStatus.done;
      next.resultText = result.text;
      // Append a la nota
      await _appendToNote(next.notePath, result.text);
    } catch (e) {
      next.status = TranscriptionStatus.failed;
      next.error = e.toString();
      AdvancedLogger.instance.warn('transcription-queue', 'failed', context: {'id': next.id, 'err': e.toString()});
    } finally {
      await _save();
      _processing = false;
      // Procesa el siguiente
      if (_jobs.any((j) => j.status == TranscriptionStatus.pending)) {
        unawaited(processNext());
      }
    }
  }

  /// v0.50.1: lista de jobs (todos los estados)
  Future<List<TranscriptionJob>> list() async {
    await _load();
    return List.unmodifiable(_jobs);
  }

  /// v0.50.1: jobs pendientes
  Future<List<TranscriptionJob>> pending() async {
    final all = await list();
    return all.where((j) => j.status == TranscriptionStatus.pending || j.status == TranscriptionStatus.processing).toList();
  }

  /// v0.50.1: limpia jobs done antiguos (>7 dias)
  Future<int> prune() async {
    await _load();
    final cutoff = DateTime.now().subtract(const Duration(days: 7));
    final before = _jobs.length;
    _jobs.removeWhere((j) => j.status == TranscriptionStatus.done && j.enqueuedAt.isBefore(cutoff));
    await _save();
    return before - _jobs.length;
  }

  /// v0.50.1: stats
  Future<Map<String, int>> stats() async {
    final all = await list();
    return {
      'pending': all.where((j) => j.status == TranscriptionStatus.pending).length,
      'processing': all.where((j) => j.status == TranscriptionStatus.processing).length,
      'done': all.where((j) => j.status == TranscriptionStatus.done).length,
      'failed': all.where((j) => j.status == TranscriptionStatus.failed).length,
      'total': all.length,
    };
  }

  Future<void> _load() async {
    if (!await _file.exists()) return;
    try {
      final raw = await _file.readAsString();
      final list = jsonDecode(raw) as List<dynamic>;
      _jobs.clear();
      for (final j in list) {
        _jobs.add(TranscriptionJob.fromJson(j as Map));
      }
    } catch (e) {
      AdvancedLogger.instance.warn('transcription-queue', 'load failed', error: e.toString());
    }
  }

  Future<void> _save() async {
    try {
      final list = _jobs.map((j) => j.toJson()).toList();
      await _file.writeAsString(jsonEncode(list, indent: 2));
    } catch (e) {
      AdvancedLogger.instance.warn('transcription-queue', 'save failed', error: e.toString());
    }
  }

  /// v0.50.1: append transcripcion al final de la nota
  Future<void> _appendToNote(String notePath, String text) async {
    final f = File(notePath);
    if (!await f.exists()) return;
    try {
      final existing = await f.readAsString();
      final newContent = '$existing\n\n## Transcripción\n\n$text\n';
      await f.writeAsString(newContent);
    } catch (e) {
      AdvancedLogger.instance.warn('transcription-queue', 'append failed', error: e.toString());
    }
  }
}
