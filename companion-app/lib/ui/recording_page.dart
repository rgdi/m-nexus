// RecordingPage: pantalla completa para grabar una clase.
//
// v0.32: usa flutter_sound + permission_handler para pedir el micrófono.
// Muestra: tiempo elapsed, nivel de audio (VU meter), clase sugerida del
// Calendar, controles grandes, lista de grabaciones previas.
//
// Es la pantalla principal de "Voice notes" del companion.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_sound/flutter_sound.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';
import '../services/calendar_service.dart';
import '../services/recorder.dart';
import 'home_page.dart';

class RecordingPage extends StatefulWidget {
  const RecordingPage({super.key});

  @override
  State<RecordingPage> createState() => _RecordingPageState();
}

class _RecordingPageState extends State<RecordingPage> {
  final _recorder = AudioRecorderService();
  RecorderState _state = RecorderState.idle;
  Duration _elapsed = Duration.zero;
  String? _currentFilePath;
  String? _suggestedClassName;
  String? _linkedEventId;
  double _level = 0;
  List<_RecordingInfo> _previousRecordings = [];
  bool _loading = true;
  final FlutterSoundPlayer _player = FlutterSoundPlayer();
  String? _playingPath;

  @override
  void initState() {
    super.initState();
    _recorder.stateStream.listen((s) {
      if (mounted) setState(() => _state = s);
    });
    _recorder.elapsedStream.listen((e) {
      if (mounted) setState(() => _elapsed = e);
    });
    _recorder.levelStream.listen((lv) {
      if (mounted) setState(() => _level = lv);
    });
    _load();
  }

  @override
  void dispose() {
    _recorder.close();
    _player.closePlayer();
    super.dispose();
  }

  Future<void> _load() async {
    await _recorder.open();
    await _loadPreviousRecordings();
    await _suggestClassFromCalendar();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _suggestClassFromCalendar() async {
    final cal = CalendarService();
    await cal.load();
    if (cal.enabled && await cal.isPermissionGranted()) {
      final ev = await cal.suggestCurrentEvent();
      if (ev != null) {
        _suggestedClassName = ev.suggestedClassName;
        _linkedEventId = ev.id.toString();
      }
    }
  }

  Future<void> _loadPreviousRecordings() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final recDir = Directory(p.join(dir.path, 'voice_notes'));
      if (!await recDir.exists()) return;
      final files = await recDir.list().toList();
      files.sort((a, b) {
        final ma = a.statSync().modified;
        final mb = b.statSync().modified;
        return mb.compareTo(ma);
      });
      _previousRecordings = files.take(20).map((f) {
        return _RecordingInfo(
          path: f.path,
          name: p.basename(f.path),
          modified: f.statSync().modified,
        );
      }).toList();
    } catch (_) {}
  }

  Future<void> _toggleRecording() async {
    if (_state == RecorderState.idle || _state == RecorderState.stopped) {
      // Start
      final path = await _recorder.start(
        linkedCalendarEventId: _linkedEventId,
        className: _suggestedClassName,
      );
      if (path != null) {
        _currentFilePath = path;
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('No se pudo iniciar la grabación. Revisa permisos.')),
          );
        }
      }
    } else if (_state == RecorderState.recording) {
      // Stop
      final result = await _recorder.stop();
      if (result != null) {
        _currentFilePath = result.filePath;
        await _loadPreviousRecordings();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Grabación guardada: ${result.className ?? "sin nombre"}'),
              action: SnackBarAction(
                label: 'Subir',
                onPressed: () => _uploadRecording(result.filePath, result.className),
              ),
            ),
          );
        }
      }
    } else if (_state == RecorderState.paused) {
      await _recorder.resume();
    }
  }

  Future<void> _togglePause() async {
    if (_state == RecorderState.recording) {
      await _recorder.pause();
    } else if (_state == RecorderState.paused) {
      await _recorder.resume();
    }
  }

  Future<void> _uploadRecording(String path, String? className) async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Subiendo al backend... (próximamente)')),
    );
    // TODO: subir al backend
  }

  Future<void> _playFile(String path) async {
    if (_playingPath == path) {
      await _player.stopPlayer();
      setState(() => _playingPath = null);
      return;
    }
    if (_playingPath != null) {
      await _player.stopPlayer();
    }
    setState(() => _playingPath = path);
    await _player.startPlayer(
      fromURI: path,
      codec: Codec.aacADTS,
      whenFinished: () {
        if (mounted) setState(() => _playingPath = null);
      },
    );
  }

  Future<void> _deleteFile(String path) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Borrar grabación?'),
        content: Text(p.basename(path)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );
    if (confirm == true) {
      try {
        await File(path).delete();
        await _loadPreviousRecordings();
      } catch (_) {}
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Grabar clase')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    final isRecording = _state == RecorderState.recording;
    final isPaused = _state == RecorderState.paused;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Grabar clase'),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline),
            tooltip: 'Permisos',
            onPressed: _showPermissionDialog,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildClassCard(),
          const SizedBox(height: 16),
          _buildTimerCard(isRecording, isPaused),
          const SizedBox(height: 16),
          _buildLevelMeter(),
          const SizedBox(height: 16),
          _buildControls(isRecording, isPaused),
          const SizedBox(height: 24),
          Text(
            'Grabaciones previas (${_previousRecordings.length})',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          if (_previousRecordings.isEmpty)
            const Card(
              child: ListTile(
                leading: Icon(Icons.history),
                title: Text('Sin grabaciones aún'),
                subtitle: Text('Tus clases aparecerán aquí'),
              ),
            )
          else
            ..._previousRecordings.map((r) => _buildRecordingTile(r)),
        ],
      ),
    );
  }

  Widget _buildClassCard() {
    return Card(
      color: _suggestedClassName != null
          ? Theme.of(context).colorScheme.primaryContainer
          : Theme.of(context).colorScheme.surfaceVariant,
      child: ListTile(
        leading: Icon(
          _suggestedClassName != null ? Icons.event_available : Icons.event_note,
          size: 32,
        ),
        title: Text(_suggestedClassName ?? 'Sin clase de Calendar'),
        subtitle: Text(_suggestedClassName != null
            ? 'Detectado del Calendar (próximos 30 min)'
            : 'Activa Calendar en Settings para sugerir nombres automáticamente'),
        trailing: IconButton(
          icon: const Icon(Icons.edit),
          tooltip: 'Cambiar nombre',
          onPressed: _editClassName,
        ),
      ),
    );
  }

  Widget _buildTimerCard(bool isRecording, bool isPaused) {
    final minutes = _elapsed.inMinutes.toString().padLeft(2, '0');
    final seconds = (_elapsed.inSeconds % 60).toString().padLeft(2, '0');
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
        child: Column(
          children: [
            Text(
              '$minutes:$seconds',
              style: TextStyle(
                fontSize: 64,
                fontWeight: FontWeight.w200,
                fontFeatures: const [FontFeature.tabularFigures()],
                color: isRecording ? Colors.red : (isPaused ? Colors.orange : null),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isRecording ? '● REC' : (isPaused ? '⏸ PAUSADO' : 'Listo para grabar'),
              style: TextStyle(
                color: isRecording ? Colors.red : Colors.grey,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLevelMeter() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Nivel de audio', style: TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: _level.clamp(0.0, 1.0),
                minHeight: 12,
                backgroundColor: Colors.grey.shade200,
                valueColor: AlwaysStoppedAnimation<Color>(
                  _level > 0.8 ? Colors.red : (_level > 0.5 ? Colors.orange : Colors.green),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildControls(bool isRecording, bool isPaused) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        if (isRecording || isPaused)
          FloatingActionButton(
            heroTag: 'pause',
            onPressed: _togglePause,
            backgroundColor: Colors.orange,
            child: Icon(isPaused ? Icons.play_arrow : Icons.pause),
          ),
        FloatingActionButton.large(
          heroTag: 'record',
          onPressed: _toggleRecording,
          backgroundColor: isRecording ? Colors.red : Theme.of(context).colorScheme.primary,
          child: Icon(
            isRecording ? Icons.stop : Icons.mic,
            size: 36,
            color: Colors.white,
          ),
        ),
        if (isRecording || isPaused)
          FloatingActionButton(
            heroTag: 'save',
            onPressed: () => _toggleRecording(),
            backgroundColor: Colors.green,
            child: const Icon(Icons.save),
          ),
      ],
    );
  }

  Widget _buildRecordingTile(_RecordingInfo r) {
    final isPlaying = _playingPath == r.path;
    final sizeStr = '${(r.modified.millisecondsSinceEpoch ~/ 1000)}';
    return Card(
      child: ListTile(
        leading: Icon(isPlaying ? Icons.graphic_eq : Icons.play_circle_outline,
            color: isPlaying ? Colors.green : null),
        title: Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(_formatDate(r.modified)),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.delete_outline, color: Colors.red),
              onPressed: () => _deleteFile(r.path),
            ),
          ],
        ),
        onTap: () => _playFile(r.path),
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    final diff = now.difference(d);
    if (diff.inDays > 0) return 'hace ${diff.inDays}d';
    if (diff.inHours > 0) return 'hace ${diff.inHours}h';
    if (diff.inMinutes > 0) return 'hace ${diff.inMinutes}min';
    return 'ahora';
  }

  Future<void> _editClassName() async {
    final controller = TextEditingController(text: _suggestedClassName ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nombre de la clase'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'Ej: Anatomía - Módulo 3',
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    if (result != null && mounted) {
      setState(() {
        _suggestedClassName = result.isEmpty ? null : result;
        _linkedEventId = null; // manual, no viene del Calendar
      });
    }
  }

  Future<void> _showPermissionDialog() async {
    final mic = await Permission.microphone.status;
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Permisos'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('La app necesita:'),
            const SizedBox(height: 8),
            ListTile(
              dense: true,
              leading: Icon(
                mic.isGranted ? Icons.check_circle : Icons.error,
                color: mic.isGranted ? Colors.green : Colors.red,
              ),
              title: const Text('Micrófono'),
              subtitle: Text(mic.isGranted ? 'Concedido' : 'Denegado'),
            ),
            const Text(
              'Si denegaste el permiso, ve a Settings del sistema para activarlo.',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cerrar'),
          ),
          if (!mic.isGranted)
            FilledButton(
              onPressed: () async {
                Navigator.pop(ctx);
                if (mic.isPermanentlyDenied) {
                  await openAppSettings();
                } else {
                  await Permission.microphone.request();
                }
              },
              child: const Text('Pedir permiso'),
            ),
        ],
      ),
    );
  }
}

class _RecordingInfo {
  final String path;
  final String name;
  final DateTime modified;
  const _RecordingInfo({
    required this.path,
    required this.name,
    required this.modified,
  });
}
