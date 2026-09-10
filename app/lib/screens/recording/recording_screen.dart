// recording_screen.dart: grabación de clase con asociación a asignatura/examen.
//
// v0.49.12: graba audio (m4a), asocia a la asignatura/examen actuales,
// y al terminar crea un AudioNote en el vault con metadata + (opcional)
// transcripción via backend Whisper.

import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:ui' show FontFeature;
import '../../services/subjects_service.dart';
import '../../services/exams_service.dart';
import '../../services/calendar_service.dart';
import '../../services/daily_note_service.dart';
import '../../services/transcription_queue.dart';
import '../../services/logger.dart';
import '../../state/app_state.dart';
import '../note/note_view.dart';

class RecordingScreen extends StatefulWidget {
  final String vaultPath;
  const RecordingScreen({super.key, required this.vaultPath});

  @override
  State<RecordingScreen> createState() => _RecordingScreenState();
}

class _RecordingScreenState extends State<RecordingScreen> {
  final AudioRecorder _recorder = AudioRecorder();
  bool _isRecording = false;
  bool _isPaused = false;
  Duration _elapsed = Duration.zero;
  String? _currentPath;
  Timer? _ticker;

  // Context
  List<Subject> _subjects = [];
  List<Exam> _exams = [];
  Subject? _selectedSubject;
  Exam? _selectedExam;
  bool _autoLink = true; // linkear a la daily note
  bool _transcribeAfter = true; // transcribir al terminar

  // Audio level
  double _level = 0;

  @override
  void initState() {
    super.initState();
    _loadContext();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _loadContext() async {
    try {
      final subjects = await SubjectsService(widget.vaultPath).load();
      final exams = await ExamsService(widget.vaultPath).load();
      final upcoming = exams.where((e) => !e.isPast(DateTime.now())).toList()
        ..sort((a, b) => a.date.compareTo(b.date));

      // v0.49.12: si hay un evento de calendario activo, intentar asociarlo
      CalendarEvent? currentEvent;
      try {
        final cal = CalendarService();
        currentEvent = await cal.suggestCurrentEvent();
      } catch (_) {}

      if (!mounted) return;
      setState(() {
        _subjects = subjects.where((s) => s.active).toList();
        _exams = upcoming;
        // Pre-seleccionar: subject del dia + primer examen
        if (_subjects.isNotEmpty) {
          _selectedSubject = _subjects[DateTime.now().weekday % _subjects.length];
        }
        _selectedExam = upcoming.isNotEmpty ? upcoming.first : null;
        // Si el evento de calendario tiene un subject, pre-seleccionarlo
        if (currentEvent != null && _subjects.isNotEmpty) {
          final match = _subjects.firstWhere(
            (s) => currentEvent!.title.toLowerCase().contains(s.name.toLowerCase()),
            orElse: () => _subjects.first,
          );
          _selectedSubject = match;
        }
      });
    } catch (e) {
      AdvancedLogger.instance.warn('recording', 'load context failed', error: e.toString());
    }
  }

  Future<bool> _checkPermission() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> _start() async {
    if (await _checkPermission() != true) {
      _toast('Permiso de microfono denegado');
      return;
    }
    try {
      final dir = await getApplicationDocumentsDirectory();
      final recordingsDir = Directory(p.join(dir.path, 'M-Nexus', 'Recordings'));
      if (!await recordingsDir.exists()) await recordingsDir.create(recursive: true);
      final filename = 'clase-${DateTime.now().millisecondsSinceEpoch}.m4a';
      final path = p.join(recordingsDir.path, filename);
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100),
        path: path,
      );
      setState(() {
        _isRecording = true;
        _isPaused = false;
        _currentPath = path;
        _elapsed = Duration.zero;
      });
      _startTicker();
    } catch (e) {
      _toast('Error iniciando grabación: $e');
    }
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(milliseconds: 200), (t) async {
      if (_isPaused) return;
      try {
        final amp = await _recorder.getAmplitude();
        // amp.current ~ -160..0 dB; map to 0..1
        final normalized = ((amp.current + 60) / 60).clamp(0.0, 1.0);
        if (mounted) {
          setState(() {
            _elapsed += const Duration(milliseconds: 200);
            _level = normalized;
          });
        }
      } catch (_) {}
    });
  }

  Future<void> _pause() async {
    if (!_isRecording) return;
    if (_isPaused) {
      await _recorder.resume();
      setState(() => _isPaused = false);
    } else {
      await _recorder.pause();
      setState(() => _isPaused = true);
    }
  }

  Future<void> _stop() async {
    if (!_isRecording) return;
    _ticker?.cancel();
    try {
      final path = await _recorder.stop();
      setState(() {
        _isRecording = false;
        _isPaused = false;
      });
      if (path != null) {
        await _saveRecording(path);
      }
    } catch (e) {
      _toast('Error parando: $e');
    }
  }

  Future<void> _cancel() async {
    if (!_isRecording) return;
    _ticker?.cancel();
    try {
      await _recorder.cancel();
      // Borrar archivo
      if (_currentPath != null) {
        final f = File(_currentPath!);
        if (await f.exists()) await f.delete();
      }
    } catch (_) {}
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  /// v0.49.12: guarda la grabación como AudioNote en el vault
  Future<void> _saveRecording(String audioPath) async {
    try {
      // 1. Copiar al vault (en Recordings/)
      final vaultRecordings = Directory(p.join(widget.vaultPath, 'Recordings'));
      if (!await vaultRecordings.exists()) await vaultRecordings.create(recursive: true);
      final basename = p.basename(audioPath);
      final destPath = p.join(vaultRecordings.path, basename);
      await File(audioPath).copy(destPath);

      // 2. Crear AudioNote markdown
      final now = DateTime.now();
      final stamp = now.toIso8601String();
      final beginMs = now.millisecondsSinceEpoch - _elapsed.inMilliseconds;
      final endMs = now.millisecondsSinceEpoch;
      final subjectTag = _selectedSubject != null ? 'subject: ${_selectedSubject!.name}' : '';
      final examTag = _selectedExam != null ? 'exam: ${_selectedExam!.title}' : '';
      final tags = [subjectTag, examTag, 'audio-note', 'clase'].where((t) => t.isNotEmpty).join(', ');

      final content = '''---
title: Clase ${stamp.substring(0, 16)}
type: audio-note
created: $stamp
duration: ${_elapsed.inSeconds}s
audio: [[Recordings/$basename]]
${_selectedSubject != null ? 'subject: ${_selectedSubject!.name}' : ''}
${_selectedExam != null ? 'exam: ${_selectedExam!.id}' : ''}
tags: [$tags]
---

# Clase ${stamp.substring(0, 16)}

> 🎙️ Audio: [[Recordings/$basename]] · ${_fmtDuration(_elapsed)}

## Contexto
${_selectedSubject != null ? '**Asignatura:** ${_selectedSubject!.name}' : ''}
${_selectedExam != null ? '\n**Examen:** ${_selectedExam!.title} (${_selectedExam!.date.toIso8601String().substring(0, 10)})' : ''}

## Notas de la clase

## Transcripción (pendiente)
''';

      final notePath = p.join(widget.vaultPath, 'Clases', 'clase-${now.millisecondsSinceEpoch}.md');
      final noteDir = Directory(p.dirname(notePath));
      if (!await noteDir.exists()) await noteDir.create(recursive: true);
      await File(notePath).writeAsString(content);

      // 3. Si autoLink, añadir a la daily note de hoy
      if (_autoLink) {
        try {
          final dailyPath = await DailyNoteService(widget.vaultPath).openOrCreate();
          final daily = File(dailyPath);
          final existing = await daily.readAsString();
          final audioLink = '- [🎙️ Clase (${_fmtDuration(_elapsed)})](${notePath})';
          if (!existing.contains(notePath)) {
            await daily.writeAsString('$existing\n$audioLink\n');
          }
        } catch (e) {
          AdvancedLogger.instance.warn('recording', 'autoLink failed', error: e.toString());
        }
      }

      // 4. v0.49.16: crear evento en el calendario con la grabacion
      // v0.51.5: cross-tag completo con audioPath + notePath + subject
      String? calendarEventId;
      try {
        final cal = CalendarService();
        final eventTitle = '🎙️ M-NEXUS: ${_selectedSubject?.name ?? "Clase"}';
        final eventDesc = 'Audio: [[Recordings/$basename]]\nNota: $notePath\nDuración: ${_fmtDuration(_elapsed)}';
        calendarEventId = (await cal.createEvent(
          title: eventTitle,
          description: eventDesc,
          begin: DateTime.fromMillisecondsSinceEpoch(beginMs),
          end: DateTime.fromMillisecondsSinceEpoch(endMs),
          audioPath: destPath,
          notePath: notePath,
          subject: _selectedSubject?.name,
          tags: [
            'mnexus-recording',
            if (_selectedExam != null) 'examen-${_selectedExam!.id}',
            'vault-${widget.vaultPath.hashCode.toRadixString(16)}',
          ],
        )).toString();
        if (int.tryParse(calendarEventId) == -1) calendarEventId = null;
      } catch (e) {
        AdvancedLogger.instance.warn('recording', 'createEvent failed', error: e.toString());
      }

      // 5. v0.50.1: encolar transcripcion en background
      if (_transcribeAfter) {
        try {
          final queue = TranscriptionQueue(widget.vaultPath);
          await queue.enqueue(notePath, destPath);
        } catch (e) {
          AdvancedLogger.instance.warn('recording', 'transcribe enqueue failed', error: e.toString());
        }
      }

      await AppState.instance.reload();
      if (!mounted) return;
      _toast('Grabación guardada${calendarEventId != null ? " + evento en calendario" : ""}');
      final open = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Grabación guardada'),
          content: Text('Clase de ${_fmtDuration(_elapsed)} guardada en Clases/.\n${_autoLink ? "Vinculada a la daily note de hoy.\n" : ""}${calendarEventId != null ? "Evento creado en el calendario." : ""}'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cerrar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Abrir nota')),
          ],
        ),
      );
      if (!mounted) return;
      if (open == true) {
        await Navigator.push(context, MaterialPageRoute(
          builder: (_) => NoteView(notePath: notePath, vaultPath: widget.vaultPath),
        ));
      }
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      _toast('Error guardando: $e');
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _fmtDuration(Duration d) {
    final m = d.inMinutes.toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Grabar clase'),
        backgroundColor: _isRecording ? theme.colorScheme.errorContainer : null,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Timer
            Center(
              child: Text(
                _fmtDuration(_elapsed),
                style: theme.textTheme.displayLarge?.copyWith(
                  fontWeight: FontWeight.w300,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: _isRecording ? theme.colorScheme.error : null,
                ),
              ),
            ),
            const SizedBox(height: 32),

            // Visualizer (simple bar)
            SizedBox(
              height: 100,
              child: Center(
                child: Container(
                  width: 200,
                  height: 12,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: _isRecording ? _level : 0,
                    child: Container(
                      decoration: BoxDecoration(
                        color: theme.colorScheme.error,
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),

            // Context selectors
            if (!_isRecording) ...[
              _buildContextCard(theme),
            ],

            const Spacer(),

            // Controls
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                if (_isRecording) ...[
                  IconButton.filledTonal(
                    iconSize: 32,
                    icon: const Icon(Icons.close),
                    onPressed: _cancel,
                    tooltip: 'Cancelar',
                  ),
                  IconButton.filledTonal(
                    iconSize: 32,
                    icon: Icon(_isPaused ? Icons.play_arrow : Icons.pause),
                    onPressed: _pause,
                    tooltip: _isPaused ? 'Reanudar' : 'Pausar',
                  ),
                  IconButton.filled(
                    iconSize: 48,
                    icon: const Icon(Icons.stop),
                    onPressed: _stop,
                    tooltip: 'Detener y guardar',
                    style: IconButton.styleFrom(
                      backgroundColor: theme.colorScheme.error,
                      foregroundColor: theme.colorScheme.onError,
                    ),
                  ),
                ] else
                  IconButton.filled(
                    iconSize: 64,
                    icon: const Icon(Icons.mic),
                    onPressed: _start,
                    tooltip: 'Grabar',
                    style: IconButton.styleFrom(
                      backgroundColor: theme.colorScheme.error,
                      foregroundColor: theme.colorScheme.onError,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            if (_isRecording)
              Text(
                _isPaused ? '⏸ Pausado' : '🔴 Grabando...',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildContextCard(ThemeData theme) {
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Contexto de la clase', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            // Asignatura
            DropdownButtonFormField<String?>(
              value: _selectedSubject?.id,
              decoration: const InputDecoration(
                labelText: 'Asignatura',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Sin asignatura')),
                ..._subjects.map((s) => DropdownMenuItem<String?>(
                  value: s.id,
                  child: Text(s.name),
                )),
              ],
              onChanged: (v) {
                setState(() {
                  _selectedSubject = v == null
                    ? null
                    : _subjects.firstWhere((s) => s.id == v);
                });
              },
            ),
            const SizedBox(height: 12),
            // Examen
            DropdownButtonFormField<String?>(
              value: _selectedExam?.id,
              decoration: const InputDecoration(
                labelText: 'Examen (opcional)',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Sin examen')),
                ..._exams.map((e) => DropdownMenuItem<String?>(
                  value: e.id,
                  child: Text('${e.title} (${e.date.toIso8601String().substring(0, 10)})'),
                )),
              ],
              onChanged: (v) {
                setState(() {
                  _selectedExam = v == null
                    ? null
                    : _exams.firstWhere((e) => e.id == v);
                });
              },
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              value: _autoLink,
              onChanged: (v) => setState(() => _autoLink = v),
              title: const Text('Vincular a daily note'),
              subtitle: const Text('Aparece como enlace en la nota de hoy'),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              value: _transcribeAfter,
              onChanged: (v) => setState(() => _transcribeAfter = v),
              title: const Text('Transcribir al guardar'),
              subtitle: const Text('Usa backend Whisper si está disponible'),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
          ],
        ),
      ),
    );
  }
}

/// v0.49.12: sentinels removidos - usamos null directamente
class _UnusedSentinels {}
