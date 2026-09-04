// RecordingPage: pantalla completa para grabar una clase.
//
// v0.34 (revisión):
//   - Sync status indicator (🔄 pending / ✅ synced / ❌ failed / ⚠️ manual)
//   - Botón de rename por recording
//   - Delete con confirmación más explícita
//   - Pull-to-refresh para reintentar uploads
//   - Mejor feedback visual de errores
//   - Integración con ChunkedUpload para subir (resumable)

import 'dart:async';
import 'package:http/http.dart' as http;
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';
import 'package:audioplayers/audioplayers.dart';
import '../services/calendar_service.dart';
import '../services/recorder.dart';
import '../services/backend_client.dart';
import '../services/chunked_upload.dart';
import '../services/sync_queue.dart';

class RecordingPage extends StatefulWidget {
  const RecordingPage({super.key});

  @override
  State<RecordingPage> createState() => _RecordingPageState();
}

class _RecordingInfo {
  final String path;
  String name;
  final DateTime modified;
  final int sizeBytes;
  final SyncStatus syncStatus;
  final String? lastError;

  _RecordingInfo({
    required this.path,
    required this.name,
    required this.modified,
    required this.sizeBytes,
    this.syncStatus = SyncStatus.pending,
    this.lastError,
  });
}

class _RecordingPageState extends State<RecordingPage> {
  final _recorder = AudioRecorderService();
  final _player = AudioPlayer();
  final _syncQueue = SyncQueue();
  RecorderState _state = RecorderState.idle;
  Duration _elapsed = Duration.zero;
  String? _suggestedClassName;
  String? _linkedEventId;
  List<_RecordingInfo> _previousRecordings = [];
  bool _loading = true;
  String? _playingPath;
  String? _error;
  bool _isUploading = false;
  StreamSubscription? _syncSubscription;

  @override
  void initState() {
    super.initState();
    _recorder.stateStream.listen((s) {
      if (mounted) setState(() => _state = s);
    });
    _recorder.elapsedStream.listen((e) {
      if (mounted) setState(() => _elapsed = e);
    });
    _player.onPlayerComplete.listen((_) {
      if (mounted) {
        setState(() {
          _playingPath = null;
        });
      }
    });
    // Escuchar cambios en el sync queue
    _syncSubscription = _syncQueue.stream.listen((_) {
      if (mounted) _loadPreviousRecordings();
    });
    _load();
  }

  @override
  void dispose() {
    _syncSubscription?.cancel();
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }

  Future<void> _load() async {
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

  /// Lee la cola de sincronización desde SharedPreferences (v0.34 offline-first).
  Future<Map<String, SyncEntry>> _loadSyncMap() async {
    final entries = await _syncQueue.getAll();
    return {for (final e in entries) e.localPath: e};
  }

  Future<void> _loadPreviousRecordings() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final recDir = Directory(p.join(dir.path, 'voice_notes'));
      if (!await recDir.exists()) {
        if (mounted) setState(() => _previousRecordings = []);
        return;
      }
      final files = await recDir.list().toList();
      files.sort((a, b) {
        final ma = a.statSync().modified;
        final mb = b.statSync().modified;
        return mb.compareTo(ma);
      });
      final syncMap = await _loadSyncMap();
      _previousRecordings = files.take(20).map((f) {
        final sync = syncMap[f.path];
        return _RecordingInfo(
          path: f.path,
          name: p.basename(f.path),
          modified: f.statSync().modified,
          sizeBytes: f.statSync().size,
          syncStatus: sync?.status ?? SyncStatus.synced,
          lastError: sync?.lastError,
        );
      }).toList();
    } catch (e) {
      // Si falla la lectura, mostrar lista vacía pero no romper la UI
      if (mounted) setState(() => _previousRecordings = []);
    }
  }

  Future<void> _toggleRecording() async {
    setState(() => _error = null);
    if (_state == RecorderState.idle || _state == RecorderState.stopped) {
      final path = await _recorder.start(
        linkedCalendarEventId: _linkedEventId,
        className: _suggestedClassName,
      );
      if (path == null) {
        if (mounted) {
          setState(() {
            _error = 'No se pudo iniciar. Verifica los permisos de micrófono.';
          });
        }
      }
    } else if (_state == RecorderState.recording ||
        _state == RecorderState.paused) {
      final result = await _recorder.stop();
      if (result != null) {
        // v0.34: encolar para sync (offline-first)
        await _syncQueue.enqueue(SyncEntry(
          localPath: result.filePath,
          deviceId: 'auto',
          createdAt: DateTime.now(),
        ));
        // Intentar subir inmediatamente
        unawaited(_trySyncOne(result.filePath));
        await _loadPreviousRecordings();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(result.className != null
                  ? '✅ Grabación guardada: ${result.className}'
                  : '✅ Grabación guardada (sin nombre)'),
            ),
          );
        }
      }
    }
  }

  /// Intenta subir UNA grabación. Si falla, queda en cola.
  Future<void> _trySyncOne(String localPath) async {
    if (_isUploading) return;
    setState(() => _isUploading = true);
    try {
      final httpClient = http.Client();
      final baseUrl = await BackendClient.getBackendUrl();
      final uploader = ChunkedUpload(
        client: httpClient,
        baseUrlGetter: () => baseUrl,
      );
      await uploader.upload(
        file: File(localPath),
        deviceId: 'auto',
        targetSubdir: 'voice_notes',
      );
      await _syncQueue.markSynced(localPath);
      httpClient.close();
    } catch (e) {
      await _syncQueue.markFailed(localPath, e.toString());
    } finally {
      if (mounted) setState(() => _isUploading = false);
      await _loadPreviousRecordings();
    }
  }

  /// Sincroniza TODAS las grabaciones pendientes.
  Future<void> _syncAll() async {
    if (_isUploading) return;
    setState(() => _isUploading = true);
    int synced = 0;
    int failed = 0;
    try {
      final pending = await _syncQueue.getPending();
      for (final entry in pending) {
        if (!await File(entry.localPath).exists()) {
          // El archivo ya no existe → marcar como borrado
          await _syncQueue.remove(entry.localPath);
          continue;
        }
        try {
          final httpClient = http.Client();
          final baseUrl = await BackendClient.getBackendUrl();
          final uploader = ChunkedUpload(
            client: httpClient,
            baseUrlGetter: () => baseUrl,
          );
          await uploader.upload(
            file: File(entry.localPath),
            deviceId: entry.deviceId,
            targetSubdir: 'voice_notes',
          );
          await _syncQueue.markSynced(entry.localPath);
          httpClient.close();
          synced++;
        } catch (e) {
          await _syncQueue.markFailed(entry.localPath, e.toString());
          failed++;
        }
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
      await _loadPreviousRecordings();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Sincronización: $synced OK, $failed con error',
            ),
          ),
        );
      }
    }
  }

  Future<void> _togglePause() async {
    if (_state == RecorderState.recording) {
      await _recorder.pause();
    } else if (_state == RecorderState.paused) {
      await _recorder.resume();
    }
  }

  Future<void> _playFile(String path) async {
    if (_playingPath == path) {
      await _player.stop();
      if (mounted) setState(() => _playingPath = null);
      return;
    }
    if (_playingPath != null) {
      await _player.stop();
    }
    try {
      await _player.play(DeviceFileSource(path));
      if (mounted) setState(() => _playingPath = path);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error reproduciendo: $e')),
        );
      }
    }
  }

  /// v0.34: renombrar un archivo con validación.
  Future<void> _renameFile(_RecordingInfo r) async {
    final controller = TextEditingController(text: r.name);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cambiar nombre'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(hintText: 'recording_xyz.txt'),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    if (result == null || result.isEmpty || result == r.name) return;

    // Validación
    final clean = result.trim();
    if (clean.contains('/') || clean.contains('\\') || clean.contains('\0')) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nombre inválido (no usar / \\ ni null)')),
        );
      }
      return;
    }
    if (clean.length > 200) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nombre demasiado largo (máx 200)')),
        );
      }
      return;
    }

    final dir = p.dirname(r.path);
    String newPath = p.join(dir, clean);
    // Si no tiene extensión, mantener la original
    if (p.extension(clean).isEmpty) {
      newPath = p.join(dir, '$clean${p.extension(r.name)}');
    }
    try {
      await File(r.path).rename(newPath);
      // Actualizar la cola de sync si existe
      await _syncQueue.updatePath(r.path, newPath);
      await _loadPreviousRecordings();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Renombrado a ${p.basename(newPath)}')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error renombrando: $e')),
        );
      }
    }
  }

  /// v0.34: borrar con confirmación más explícita.
  Future<void> _deleteFile(_RecordingInfo r) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Borrar grabación?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(r.name, style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Tamaño: ${(r.sizeBytes / 1024).toStringAsFixed(1)} KB'),
            Text('Estado: ${_syncLabel(r.syncStatus)}'),
            if (r.lastError != null) ...[
              const SizedBox(height: 8),
              Text('Último error: ${r.lastError}',
                  style: const TextStyle(color: Colors.red, fontSize: 12)),
            ],
            const SizedBox(height: 12),
            const Text('Esta acción no se puede deshacer.'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
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
        await File(r.path).delete();
        await _syncQueue.remove(r.path);
        await _loadPreviousRecordings();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error borrando: $e')),
          );
        }
      }
    }
  }

  String _syncLabel(SyncStatus s) {
    switch (s) {
      case SyncStatus.pending: return '🔄 Pendiente de sincronizar';
      case SyncStatus.uploading: return '⏫ Subiendo...';
      case SyncStatus.synced: return '✅ Sincronizado';
      case SyncStatus.failed: return '❌ Error de sincronización';
      case SyncStatus.manual: return '📁 Solo local';
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
    final pendingCount = _previousRecordings
        .where((r) =>
            r.syncStatus == SyncStatus.pending ||
            r.syncStatus == SyncStatus.failed)
        .length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Grabar clase'),
        actions: [
          if (_isUploading)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2, color: Colors.white,
                  ),
                ),
              ),
            )
          else if (pendingCount > 0)
            IconButton(
              icon: Badge(
                label: Text('$pendingCount'),
                child: const Icon(Icons.cloud_upload_outlined),
              ),
              tooltip: 'Sincronizar $pendingCount pendientes',
              onPressed: _syncAll,
            ),
          IconButton(
            icon: const Icon(Icons.info_outline),
            tooltip: 'Permisos',
            onPressed: _showPermissionDialog,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadPreviousRecordings,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) ...[
              Card(
                color: Colors.red.shade50,
                child: ListTile(
                  leading: const Icon(Icons.error, color: Colors.red),
                  title: Text(_error!),
                  trailing: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() => _error = null),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            _buildClassCard(),
            const SizedBox(height: 16),
            _buildTimerCard(isRecording, isPaused),
            const SizedBox(height: 16),
            _buildControls(isRecording, isPaused),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Grabaciones (${_previousRecordings.length})',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (pendingCount > 0 && !_isUploading)
                  TextButton.icon(
                    icon: const Icon(Icons.cloud_upload, size: 18),
                    label: Text('Sync $pendingCount'),
                    onPressed: _syncAll,
                  ),
              ],
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
      ),
    );
  }

  Widget _buildClassCard() {
    final theme = Theme.of(context);
    return Card(
      color: _suggestedClassName != null
          ? theme.colorScheme.primaryContainer
          : theme.colorScheme.surfaceContainerHighest,
      child: ListTile(
        leading: Icon(
          _suggestedClassName != null ? Icons.event_available : Icons.event_note,
          size: 32,
          color: _suggestedClassName != null
              ? theme.colorScheme.onPrimaryContainer
              : theme.colorScheme.onSurfaceVariant,
        ),
        title: Text(
          _suggestedClassName ?? 'Sin clase de Calendar',
          style: TextStyle(
            color: _suggestedClassName != null
                ? theme.colorScheme.onPrimaryContainer
                : null,
            fontWeight: _suggestedClassName != null ? FontWeight.bold : null,
          ),
        ),
        subtitle: Text(_suggestedClassName != null
            ? '🟢 Detectado del Calendar (próximos 30 min)'
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
      elevation: isRecording ? 8 : 1,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
        child: Column(
          children: [
            Text(
              '$minutes:$seconds',
              style: TextStyle(
                fontSize: 64,
                fontWeight: FontWeight.w200,
                color: isRecording
                    ? Colors.red
                    : (isPaused ? Colors.orange : null),
                fontFeatures: const [FontFeature.tabularFigures()],
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
          backgroundColor: isRecording
              ? Colors.red
              : Theme.of(context).colorScheme.primary,
          child: Icon(
            isRecording ? Icons.stop : Icons.mic,
            size: 36,
            color: Colors.white,
          ),
        ),
        if (isRecording || isPaused)
          FloatingActionButton(
            heroTag: 'save',
            onPressed: _toggleRecording,
            backgroundColor: Colors.green,
            child: const Icon(Icons.save),
          ),
      ],
    );
  }

  Widget _buildRecordingTile(_RecordingInfo r) {
    final isPlaying = _playingPath == r.path;
    return Card(
      child: ListTile(
        leading: Stack(
          children: [
            Icon(
              isPlaying ? Icons.graphic_eq : Icons.audio_file,
              color: isPlaying ? Colors.green : null,
            ),
            Positioned(
              right: -2, top: -2,
              child: _syncBadge(r.syncStatus),
            ),
          ],
        ),
        title: Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${_formatDate(r.modified)} · ${(r.sizeBytes / 1024).toStringAsFixed(1)} KB',
              style: const TextStyle(fontSize: 12),
            ),
            Text(
              _syncLabel(r.syncStatus),
              style: TextStyle(
                fontSize: 11,
                color: _syncColor(r.syncStatus),
                fontWeight: FontWeight.w600,
              ),
            ),
            if (r.lastError != null)
              Text(
                r.lastError!,
                style: const TextStyle(fontSize: 10, color: Colors.red),
                maxLines: 2, overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.drive_file_rename_outline),
              tooltip: 'Renombrar',
              onPressed: () => _renameFile(r),
            ),
            if (r.syncStatus == SyncStatus.failed ||
                r.syncStatus == SyncStatus.pending)
              IconButton(
                icon: const Icon(Icons.cloud_upload, color: Colors.blue),
                tooltip: 'Reintentar sync',
                onPressed: _isUploading ? null : () => _trySyncOne(r.path),
              ),
            IconButton(
              icon: const Icon(Icons.delete_outline, color: Colors.red),
              tooltip: 'Borrar',
              onPressed: () => _deleteFile(r),
            ),
          ],
        ),
        onTap: () => _playFile(r.path),
      ),
    );
  }

  Widget _syncBadge(SyncStatus s) {
    IconData icon;
    Color color;
    switch (s) {
      case SyncStatus.pending:
        icon = Icons.cloud_queue;
        color = Colors.orange;
        break;
      case SyncStatus.uploading:
        icon = Icons.cloud_upload;
        color = Colors.blue;
        break;
      case SyncStatus.synced:
        icon = Icons.cloud_done;
        color = Colors.green;
        break;
      case SyncStatus.failed:
        icon = Icons.cloud_off;
        color = Colors.red;
        break;
      case SyncStatus.manual:
        icon = Icons.save_alt;
        color = Colors.grey;
        break;
    }
    return Container(
      width: 16, height: 16,
      decoration: BoxDecoration(
        color: color, shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 1),
      ),
      child: Icon(icon, color: Colors.white, size: 10),
    );
  }

  Color _syncColor(SyncStatus s) {
    switch (s) {
      case SyncStatus.pending: return Colors.orange.shade800;
      case SyncStatus.uploading: return Colors.blue;
      case SyncStatus.synced: return Colors.green.shade700;
      case SyncStatus.failed: return Colors.red.shade700;
      case SyncStatus.manual: return Colors.grey.shade700;
    }
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
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
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
        _linkedEventId = null;
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
                if (mounted) setState(() {});
              },
              child: const Text('Conceder'),
            ),
        ],
      ),
    );
  }
}
