// transcription_queue_screen.dart: lista de jobs de transcripcion.
//
// v0.50.1: muestra estado (pending/processing/done/failed) y permite
// reintentar failed.

import 'package:flutter/material.dart';
import '../../services/transcription_queue.dart';

class TranscriptionQueueScreen extends StatefulWidget {
  final String vaultPath;
  const TranscriptionQueueScreen({super.key, required this.vaultPath});

  @override
  State<TranscriptionQueueScreen> createState() => _TranscriptionQueueScreenState();
}

class _TranscriptionQueueScreenState extends State<TranscriptionQueueScreen> {
  late final TranscriptionQueue _queue;
  List<TranscriptionJob> _jobs = [];
  bool _loading = true;
  Map<String, int> _stats = {};

  @override
  void initState() {
    super.initState();
    _queue = TranscriptionQueue(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final list = await _queue.list();
    final stats = await _queue.stats();
    if (!mounted) return;
    setState(() {
      _jobs = list;
      _stats = stats;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cola de transcripción'),
        actions: [
          IconButton(
            icon: const Icon(Icons.play_arrow),
            tooltip: 'Procesar siguiente',
            onPressed: () async {
              await _queue.processNext();
              await _load();
            },
          ),
          IconButton(
            icon: const Icon(Icons.cleaning_services),
            tooltip: 'Limpiar antiguos',
            onPressed: () async {
              final pruned = await _queue.prune();
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('$pruned jobs eliminados')),
              );
              await _load();
            },
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              _buildStatsBar(theme),
              const Divider(height: 1),
              Expanded(
                child: _jobs.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          'Cola vacía.\nLas transcripciones se encolan al guardar una grabación con "Transcribir" activado.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    )
                  : ListView.separated(
                      itemCount: _jobs.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (ctx, i) => _buildJobTile(_jobs[i], theme),
                    ),
              ),
            ],
          ),
    );
  }

  Widget _buildStatsBar(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(12),
      color: theme.colorScheme.surfaceContainerLow,
      child: Row(
        children: [
          _statChip('Pending', _stats['pending'] ?? 0, Colors.orange, theme),
          const SizedBox(width: 8),
          _statChip('Processing', _stats['processing'] ?? 0, Colors.blue, theme),
          const SizedBox(width: 8),
          _statChip('Done', _stats['done'] ?? 0, Colors.green, theme),
          const SizedBox(width: 8),
          _statChip('Failed', _stats['failed'] ?? 0, Colors.red, theme),
        ],
      ),
    );
  }

  Widget _statChip(String label, int count, Color color, ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$count', style: TextStyle(fontWeight: FontWeight.w700, color: color)),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: color)),
        ],
      ),
    );
  }

  Widget _buildJobTile(TranscriptionJob job, ThemeData theme) {
    final color = switch (job.status) {
      TranscriptionStatus.pending => Colors.orange,
      TranscriptionStatus.processing => Colors.blue,
      TranscriptionStatus.done => Colors.green,
      TranscriptionStatus.failed => Colors.red,
    };
    final icon = switch (job.status) {
      TranscriptionStatus.pending => Icons.schedule,
      TranscriptionStatus.processing => Icons.sync,
      TranscriptionStatus.done => Icons.check_circle,
      TranscriptionStatus.failed => Icons.error,
    };
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(
        job.audioPath.split('/').last,
        style: const TextStyle(fontWeight: FontWeight.w500),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            job.status.name.toUpperCase(),
            style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w700),
          ),
          Text('Encolado: ${_ago(job.enqueuedAt)}',
            style: theme.textTheme.bodySmall),
          if (job.error != null)
            Text('Error: ${job.error}', style: const TextStyle(color: Colors.red, fontSize: 11)),
          if (job.resultText != null)
            Text('${job.resultText!.length} chars transcritos',
              style: const TextStyle(color: Colors.green, fontSize: 11)),
        ],
      ),
      trailing: job.status == TranscriptionStatus.failed
        ? IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              // Reintentar: resetear a pending
              job.status = TranscriptionStatus.pending;
              job.error = null;
              await _queue.processNext();
              await _load();
            },
          )
        : null,
    );
  }

  String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inSeconds < 60) return 'hace ${d.inSeconds}s';
    if (d.inMinutes < 60) return 'hace ${d.inMinutes}m';
    if (d.inHours < 24) return 'hace ${d.inHours}h';
    return 'hace ${d.inDays}d';
  }
}
