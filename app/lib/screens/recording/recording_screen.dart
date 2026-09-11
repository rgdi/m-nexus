// recording_screen.dart: pantalla de grabación de audio de clases.
//
// v0.62.7: la feature de audio recording usa `record` package que tiene
// conflicto con `record_platform_interface 1.6.0` en Linux. Por ahora,
// la feature está deshabilitada y se muestra un placeholder.
//
// TODO: reenable when record_linux 0.7.3+ publique compatibilidad.

import 'dart:io';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import '../../services/logger.dart';
import '../../services/subjects_service.dart';
import '../../services/exams_service.dart';
import '../../services/flashcard_service.dart';
import '../../services/daily_note_service.dart';
import '../../services/local_tutor_service.dart';
import '../../services/transcription_queue.dart';
import '../../widgets/audio_player_widget.dart';

class RecordingScreen extends StatefulWidget {
  final String vaultPath;
  const RecordingScreen({super.key, required this.vaultPath});

  @override
  State<RecordingScreen> createState() => _RecordingScreenState();
}

class _RecordingScreenState extends State<RecordingScreen> {
  // v0.62.7: stubs para que compile sin `record` package.
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
  bool _autoLink = true;
  bool _transcribeAfter = true;

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
    super.dispose();
  }

  Future<void> _loadContext() async {
    try {
      final subjects = await SubjectsService().load(widget.vaultPath);
      final exams = await ExamsService().load(widget.vaultPath);
      final upcoming = exams.where((e) => !e.isPast(DateTime.now())).toList()
        ..sort((a, b) => a.date.compareTo(b.date));
      if (!mounted) return;
      setState(() {
        _subjects = subjects;
        _exams = upcoming;
      });
    } catch (e) {
      AdvancedLogger.instance.warn('recording', 'load context failed', error: e.toString());
    }
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(milliseconds: 200), (t) async {
      if (_isPaused) return;
      if (mounted) {
        setState(() {
          _elapsed += const Duration(milliseconds: 200);
        });
      }
    });
  }

  Future<void> _startRecording() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final recordingsDir = Directory(p.join(dir.path, 'M-Nexus', 'Recordings'));
      if (!await recordingsDir.exists()) await recordingsDir.create(recursive: true);
      final filename = 'clase-${DateTime.now().millisecondsSinceEpoch}.m4a';
      final path = p.join(recordingsDir.path, filename);
      setState(() {
        _isRecording = true;
        _isPaused = false;
        _currentPath = path;
        _elapsed = Duration.zero;
      });
      _startTicker();
      _toast('Recording started (stub - feature disabled in v0.62.7)');
    } catch (e) {
      _toast('Error iniciando grabación: $e');
    }
  }

  Future<void> _pauseRecording() async {
    setState(() => _isPaused = !_isPaused);
    _toast(_isPaused ? 'Pausado' : 'Reanudado');
  }

  Future<void> _stopRecording() async {
    setState(() {
      _isRecording = false;
      _isPaused = false;
    });
    _ticker?.cancel();
    if (_currentPath != null && _transcribeAfter) {
      _toast('Transcripción en cola (stub)');
      try {
        // v0.62.7: stub — no hay notePath todavía.
        // Usamos un nombre de nota placeholder.
        final stubNotePath = 'Mi_Vault/recording-${DateTime.now().millisecondsSinceEpoch}.md';
        await TranscriptionQueue(widget.vaultPath).enqueue(stubNotePath, _currentPath!);
      } catch (e) {
        AdvancedLogger.instance.warn('recording', 'enqueue failed', error: e.toString());
      }
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    final h = d.inHours.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Grabación de clase')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // v0.62.7: banner explicando que está deshabilitado
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(Icons.warning_amber_rounded,
                      color: Theme.of(context).colorScheme.onErrorContainer),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Función de grabación de audio temporalmente deshabilitada\n(v0.62.7: incompatibilidad record_linux / record_platform_interface)',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onErrorContainer,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Timer
            Text(_fmt(_elapsed),
                style: Theme.of(context).textTheme.displayMedium?.copyWith(
                      fontWeight: FontWeight.w300,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                textAlign: TextAlign.center),
            const SizedBox(height: 8),

            // Audio level meter
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: (_level + 60).clamp(0.0, 60.0) / 60.0,
                minHeight: 8,
                backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
              ),
            ),
            const SizedBox(height: 24),

            // Control buttons
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (!_isRecording)
                  FloatingActionButton.large(
                    heroTag: 'record',
                    onPressed: _startRecording,
                    backgroundColor: Theme.of(context).colorScheme.error,
                    child: const Icon(Icons.mic, size: 36),
                  )
                else ...[
                  FloatingActionButton(
                    heroTag: 'pause',
                    onPressed: _pauseRecording,
                    child: Icon(_isPaused ? Icons.play_arrow : Icons.pause),
                  ),
                  const SizedBox(width: 20),
                  FloatingActionButton.large(
                    heroTag: 'stop',
                    onPressed: _stopRecording,
                    backgroundColor: Theme.of(context).colorScheme.primary,
                    child: const Icon(Icons.stop),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 32),

            // Settings: subject + exam + auto-link + transcribe
            Text('Contexto', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            DropdownButtonFormField<String?>(
              value: _selectedSubject?.id,
              decoration: const InputDecoration(
                labelText: 'Asignatura',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Sin asignatura')),
                ..._subjects.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name))),
              ],
              onChanged: (id) {
                setState(() {
                  _selectedSubject = _subjects.firstWhere((s) => s.id == id, orElse: () => _subjects.first);
                });
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              value: _selectedExam?.id,
              decoration: const InputDecoration(
                labelText: 'Examen próximo',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                const DropdownMenuItem<String?>(value: null, child: Text('Sin examen')),
                ..._exams.map((e) => DropdownMenuItem(value: e.id, child: Text(e.title))),
              ],
              onChanged: (id) {
                setState(() {
                  _selectedExam = _exams.firstWhere((e) => e.id == id, orElse: () => _exams.first);
                });
              },
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              value: _autoLink,
              onChanged: (v) => setState(() => _autoLink = v),
              title: const Text('Auto-linkear a daily note'),
              dense: true,
            ),
            SwitchListTile(
              value: _transcribeAfter,
              onChanged: (v) => setState(() => _transcribeAfter = v),
              title: const Text('Transcribir al terminar'),
              dense: true,
            ),
            if (_currentPath != null && !_isRecording) ...[
              const SizedBox(height: 16),
              Text('Última grabación', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              AudioPlayerWidget(audioPath: _currentPath!),
            ],
          ],
        ),
      ),
    );
  }
}
