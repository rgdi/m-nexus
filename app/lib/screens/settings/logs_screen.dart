// logs_screen.dart: visor de logs estructurados con busqueda y filtros.
//
// v0.49.15: lee el log file del dia, permite buscar, filtrar por nivel,
// y compartir para debug.

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import '../../services/logger.dart';
import '../../services/logger_models.dart';

class LogsScreen extends StatefulWidget {
  const LogsScreen({super.key});

  @override
  State<LogsScreen> createState() => _LogsScreenState();
}

class _LogsScreenState extends State<LogsScreen> {
  List<_LogEntry> _entries = [];
  bool _loading = true;
  String _query = '';
  LogLevel? _minLevel = LogLevel.info;
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final dir = await getApplicationDocumentsDirectory();
      final logsDir = Directory(p.join(dir.path, 'M-Nexus', 'logs'));
      final entries = <_LogEntry>[];
      if (await logsDir.exists()) {
        final files = logsDir.listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.jsonl') || f.path.endsWith('.log'))
          .toList();
        files.sort((a, b) => b.path.compareTo(a.path));
        if (files.isNotEmpty) {
          final content = await files.first.readAsString();
          for (final line in content.split('\n')) {
            if (line.isEmpty) continue;
            final entry = _parseLine(line);
            if (entry != null) entries.add(entry);
          }
        }
      }
      entries.sort((a, b) => b.ts.compareTo(a.ts));
      if (!mounted) return;
      setState(() {
        _entries = entries;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  _LogEntry? _parseLine(String line) {
    if (line.startsWith('{')) {
      try {
        final m = jsonDecode(line) as Map<String, dynamic>;
        return _LogEntry(
          ts: DateTime.tryParse(m['ts']?.toString() ?? '') ?? DateTime.now(),
          level: LogLevel.values.firstWhere(
            (l) => l.name.toLowerCase() == (m['level'] ?? 'info').toString().toLowerCase(),
            orElse: () => LogLevel.info,
          ),
          component: m['component']?.toString() ?? '',
          message: m['msg']?.toString() ?? m['message']?.toString() ?? line,
          context: m['ctx']?.toString() ?? m['context']?.toString(),
        );
      } catch (_) {
        return null;
      }
    } else {
      return _LogEntry(
        ts: DateTime.now(),
        level: LogLevel.info,
        component: '',
        message: line,
      );
    }
  }

  List<_LogEntry> get _filtered {
    Iterable<_LogEntry> r = _entries;
    if (_minLevel != null) {
      final min = _minLevel!.index;
      r = r.where((e) => e.level.index >= min);
    }
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      r = r.where((e) =>
        e.message.toLowerCase().contains(q) ||
        e.component.toLowerCase().contains(q));
    }
    return r.toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Logs'),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy),
            tooltip: 'Copiar al portapapeles',
            onPressed: _share,
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Recargar',
            onPressed: _load,
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                TextField(
                  decoration: InputDecoration(
                    hintText: 'Buscar en logs...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    filled: true,
                    fillColor: theme.colorScheme.surfaceContainerLow,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: LogLevel.values.map((l) {
                      final selected = _minLevel == l;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: FilterChip(
                          label: Text(l.name.toUpperCase()),
                          selected: selected,
                          onSelected: (_) => setState(() => _minLevel = selected ? null : l),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text('${_filtered.length} entradas',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  )),
                const Spacer(),
                if (_loading) const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _filtered.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      _loading ? 'Cargando...' : 'No hay logs.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                )
              : ListView.builder(
                  controller: _scrollController,
                  itemCount: _filtered.length,
                  itemBuilder: (ctx, i) => _buildEntry(_filtered[i], theme),
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildEntry(_LogEntry e, ThemeData theme) {
    final color = switch (e.level) {
      LogLevel.trace => theme.colorScheme.onSurfaceVariant,
      LogLevel.debug => theme.colorScheme.onSurfaceVariant,
      LogLevel.info => theme.colorScheme.primary,
      LogLevel.warn => Colors.orange,
      LogLevel.error => theme.colorScheme.error,
      LogLevel.fatal => theme.colorScheme.error,
    };
    final icon = switch (e.level) {
      LogLevel.trace => Icons.notes_outlined,
      LogLevel.debug => Icons.bug_report_outlined,
      LogLevel.info => Icons.info_outline,
      LogLevel.warn => Icons.warning_amber_outlined,
      LogLevel.error => Icons.error_outline,
      LogLevel.fatal => Icons.gpp_bad_outlined,
    };
    return InkWell(
      onTap: () {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Row(
              children: [
                Icon(icon, color: color, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text('${e.level.name.toUpperCase()} · ${e.component}',
                  maxLines: 1, overflow: TextOverflow.ellipsis)),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(e.message, style: const TextStyle(fontWeight: FontWeight.w500)),
                  if (e.context != null) ...[
                    const SizedBox(height: 8),
                    Text(e.context!, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                  ],
                  const SizedBox(height: 8),
                  Text(e.ts.toIso8601String(), style: theme.textTheme.bodySmall),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: '${e.ts.toIso8601String()} ${e.level.name.toUpperCase()} [${e.component}] ${e.message}\n${e.context ?? ""}'));
                  Navigator.pop(ctx);
                },
                child: const Text('Copiar'),
              ),
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
            ],
          ),
        );
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: theme.colorScheme.outlineVariant.withOpacity(0.3)),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    e.message,
                    style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurface),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${_fmtTime(e.ts)} · ${e.component}',
                    style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurfaceVariant),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _fmtTime(DateTime t) {
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}:${t.second.toString().padLeft(2, '0')}';
  }

  void _share() {
    if (_entries.isEmpty) return;
    final buf = StringBuffer();
    for (final e in _entries.take(500)) {
      buf.writeln('${e.ts.toIso8601String()} ${e.level.name.toUpperCase()} [${e.component}] ${e.message}');
    }
    Clipboard.setData(ClipboardData(text: buf.toString()));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Logs copiados (max 500)')),
    );
  }
}

class _LogEntry {
  final DateTime ts;
  final LogLevel level;
  final String component;
  final String message;
  final String? context;
  _LogEntry({required this.ts, required this.level, required this.component, required this.message, this.context});
}
