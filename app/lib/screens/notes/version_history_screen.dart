// version_history_screen.dart: lista snapshots de una nota con restore + diff.
//
// v0.50: cada modificacion crea un snapshot. Aqui el usuario puede
// navegar, comparar y restaurar versiones anteriores.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../../services/version_history_service.dart';

class VersionHistoryScreen extends StatefulWidget {
  final String notePath;
  const VersionHistoryScreen({super.key, required this.notePath});

  @override
  State<VersionHistoryScreen> createState() => _VersionHistoryScreenState();
}

class _VersionHistoryScreenState extends State<VersionHistoryScreen> {
  late final VersionHistoryService _service;
  List<NoteSnapshot> _snapshots = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = VersionHistoryService(p.dirname(widget.notePath));
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final list = await _service.list(widget.notePath);
    if (!mounted) return;
    setState(() {
      _snapshots = list;
      _loading = false;
    });
  }

  Future<void> _restore(NoteSnapshot snap) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Restaurar esta versión?'),
        content: Text('El contenido actual de "${p.basename(widget.notePath)}" será reemplazado por el de esta versión (${_fmtDate(snap.createdAt)}).'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.orange),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Restaurar'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final restored = await _service.restore(widget.notePath, snap.path);
    if (!mounted) return;
    if (restored) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Versión restaurada')),
      );
      Navigator.of(context).pop();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Error restaurando')),
      );
    }
  }

  Future<void> _diff(NoteSnapshot snap) async {
    final current = widget.notePath;
    final diff = await _service.diff(snap.path, current);
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Diff: ${_fmtDate(snap.createdAt)}'),
        content: SizedBox(
          width: 500,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (diff.added.isNotEmpty) ...[
                  Text('Añadido (${diff.added.length})',
                    style: const TextStyle(color: Colors.green, fontWeight: FontWeight.w700)),
                  ...diff.added.take(20).map((l) => Text('+ $l',
                    style: const TextStyle(color: Colors.green, fontSize: 11, fontFamily: 'monospace'))),
                  if (diff.added.length > 20)
                    Text('... y ${diff.added.length - 20} más'),
                ],
                if (diff.removed.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text('Eliminado (${diff.removed.length})',
                    style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w700)),
                  ...diff.removed.take(20).map((l) => Text('- $l',
                    style: const TextStyle(color: Colors.red, fontSize: 11, fontFamily: 'monospace'))),
                  if (diff.removed.length > 20)
                    Text('... y ${diff.removed.length - 20} más'),
                ],
                if (diff.added.isEmpty && diff.removed.isEmpty)
                  const Text('Sin cambios'),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
        ],
      ),
    );
  }

  String _fmtDate(DateTime d) {
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} '
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}:${d.second.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text('Historial · ${p.basename(widget.notePath)}'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _snapshots.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'Sin snapshots todavía.\nLas versiones se crean al guardar la nota.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            )
          : ListView.separated(
              itemCount: _snapshots.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final s = _snapshots[i];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: theme.colorScheme.primaryContainer,
                    child: Text('${i + 1}',
                      style: TextStyle(color: theme.colorScheme.onPrimaryContainer, fontSize: 12)),
                  ),
                  title: Text(_fmtDate(s.createdAt),
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${(s.sizeBytes / 1024).toStringAsFixed(1)} KB',
                    style: theme.textTheme.bodySmall),
                  trailing: PopupMenuButton<String>(
                    onSelected: (a) async {
                      if (a == 'restore') await _restore(s);
                      if (a == 'diff') await _diff(s);
                      if (a == 'copy') {
                        await Clipboard.setData(ClipboardData(text: await File(s.path).readAsString()));
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Contenido copiado')),
                          );
                        }
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'diff', child: Text('Ver diff con actual')),
                      PopupMenuItem(value: 'restore', child: Text('Restaurar')),
                      PopupMenuItem(value: 'copy', child: Text('Copiar contenido')),
                    ],
                  ),
                  onTap: () => _diff(s),
                );
              },
            ),
    );
  }
}
