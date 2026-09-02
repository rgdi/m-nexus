// v0.22: UI de grabación de voice notes.
// Material 3, atractiva, fácil de usar.

import 'package:flutter/material.dart';
import 'voice_notes_service.dart';

class RecordingPage extends StatefulWidget {
  final VoiceNotesService service;
  const RecordingPage({super.key, required this.service});

  @override
  State<RecordingPage> createState() => _RecordingPageState();
}

class _RecordingPageState extends State<RecordingPage> {
  VoiceNoteRecording? _recording;

  @override
  void initState() {
    super.initState();
    widget.service.stream.listen((r) {
      if (mounted) setState(() => _recording = r);
    });
  }

  String _formatDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return h > 0 ? '$h:$m:$s' : '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final r = _recording;
    final isRecording = r?.state == RecordingState.recording;
    final isPaused = r?.state == RecordingState.paused;
    final isProcessing = r?.state == RecordingState.processing;
    final isCompleted = r?.state == RecordingState.completed;
    final isError = r?.state == RecordingState.error;

    return Scaffold(
      appBar: AppBar(
        title: const Text('🎙️ Voice Note'),
        centerTitle: true,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Animación / icono
              _buildStatusIcon(isRecording, isPaused, isProcessing, isError),
              const SizedBox(height: 32),
              // Duración
              Text(
                _formatDuration(r?.duration ?? Duration.zero),
                style: Theme.of(context).textTheme.displayLarge?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                  fontWeight: FontWeight.w200,
                ),
              ),
              const SizedBox(height: 16),
              // Clase detectada
              if (r?.classSubject != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.school, size: 18),
                      const SizedBox(width: 8),
                      Text(
                        '${r!.classSubject}'
                        '${r.scheduleConfidence != null ? ' (${(r.scheduleConfidence! * 100).toStringAsFixed(0)}%)' : ''}',
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 32),
              // Controles
              if (isRecording || isPaused) _buildControls(isRecording),
              if (isProcessing) const CircularProgressIndicator(),
              if (isCompleted) _buildCompleted(r!),
              if (isError) _buildError(r!),
              if (r == null || r.state == RecordingState.idle) _buildStartButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusIcon(bool recording, bool paused, bool processing, bool error) {
    IconData icon;
    Color color;
    if (error) {
      icon = Icons.error_outline;
      color = Theme.of(context).colorScheme.error;
    } else if (processing) {
      icon = Icons.cloud_upload;
      color = Theme.of(context).colorScheme.primary;
    } else if (recording) {
      icon = Icons.mic;
      color = Theme.of(context).colorScheme.error;
    } else if (paused) {
      icon = Icons.pause_circle_filled;
      color = Theme.of(context).colorScheme.tertiary;
    } else {
      icon = Icons.mic_none;
      color = Theme.of(context).colorScheme.outline;
    }
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: 120,
      height: 120,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withOpacity(0.1),
        border: Border.all(color: color, width: 3),
      ),
      child: Icon(icon, size: 60, color: color),
    );
  }

  Widget _buildStartButton() {
    return FilledButton.icon(
      onPressed: () async {
        await widget.service.startRecording();
      },
      icon: const Icon(Icons.fiber_manual_record),
      label: const Text('Iniciar grabación'),
      style: FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
        textStyle: const TextStyle(fontSize: 18),
      ),
    );
  }

  Widget _buildControls(bool recording) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (recording)
          IconButton.filled(
            onPressed: () => widget.service.pause(),
            iconSize: 32,
            icon: const Icon(Icons.pause),
          )
        else
          IconButton.filled(
            onPressed: () => widget.service.resume(),
            iconSize: 32,
            icon: const Icon(Icons.play_arrow),
          ),
        const SizedBox(width: 16),
        IconButton.filledTonal(
          onPressed: () async {
            await widget.service.stopAndUpload();
          },
          iconSize: 32,
          icon: const Icon(Icons.stop),
        ),
        const SizedBox(width: 16),
        IconButton.outlined(
          onPressed: () => widget.service.cancel(),
          iconSize: 32,
          icon: const Icon(Icons.close),
        ),
      ],
    );
  }

  Widget _buildCompleted(VoiceNoteRecording r) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Icon(Icons.check_circle, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Text('¡Listo!', style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 8),
            if (r.transcript != null && r.transcript!.isNotEmpty)
              Text(
                r.transcript!,
                maxLines: 5,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (r.notePath != null) ...[
              const SizedBox(height: 8),
              Text('📝 Nota: ${r.notePath}'),
            ],
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () async {
                    await widget.service.startRecording(classHint: r.classSubject);
                  },
                  child: const Text('Otra grabación'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildError(VoiceNoteRecording r) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 8),
            Text('Error: ${r.errorMessage ?? "desconocido"}'),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () async {
                await widget.service.startRecording();
              },
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
