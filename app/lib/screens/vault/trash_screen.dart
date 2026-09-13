// trash_screen.dart — papelera de notas borradas.
// v0.62.16: muestra archivos en _M-NEXUS/trash/, permite restaurar o
// borrar permanentemente.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:path/path.dart' as p;
import '../../core/design_tokens.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';

class TrashScreen extends StatefulWidget {
  final String vaultPath;
  const TrashScreen({super.key, required this.vaultPath});
  @override
  State<TrashScreen> createState() => _TrashScreenState();
}

class _TrashScreenState extends State<TrashScreen> {
  late VaultService _vault;
  List<_TrashItem> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _vault = VaultService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final files = await _vault.listTrash();
    _items = files.map((f) {
      // Format: "1234567890-name.md" → extract ts and original name.
      final m = RegExp(r'^(\d+)-(.+)$').firstMatch(p.basename(f.path));
      final ts = m != null ? int.tryParse(m.group(1)!) : null;
      final original = m?.group(2) ?? p.basename(f.path);
      return _TrashItem(
        trashFileName: p.basename(f.path),
        originalName: original,
        deletedAt: ts != null
            ? DateTime.fromMillisecondsSinceEpoch(ts)
            : DateTime.now(),
        path: f.path,
      );
    }).toList();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _restore(_TrashItem item) async {
    final ok = await _vault.restoreFromTrash(item.trashFileName);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(ok ? 'Restaurado: ${item.originalName}' : 'Error al restaurar'),
    ));
    _load();
  }

  Future<void> _deleteForever(_TrashItem item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Borrar permanentemente?'),
        content: Text('"${item.originalName}" no se podrá recuperar.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _vault.permanentlyDelete(item.trashFileName);
      _load();
    }
  }

  Future<void> _emptyTrash() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Vaciar papelera?'),
        content: const Text('Todos los archivos se borrarán permanentemente.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Vaciar'),
          ),
        ],
      ),
    );
    if (ok == true) {
      for (final it in _items) {
        await _vault.permanentlyDelete(it.trashFileName);
      }
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando papelera…');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Papelera', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          if (_items.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep_rounded),
              onPressed: _emptyTrash,
              tooltip: 'Vaciar papelera',
            ),
        ],
      ),
      body: _items.isEmpty
          ? const EmptyState(
              icon: Icons.delete_outline_rounded,
              title: 'Papelera vacía',
              subtitle: 'Las notas borradas aparecerán aquí.',
            )
          : ListView.separated(
              padding: const EdgeInsets.all(MxSpacing.lg),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
              itemBuilder: (ctx, i) {
                final it = _items[i];
                return Container(
                  padding: const EdgeInsets.all(MxSpacing.md),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerLow.withOpacity(0.4),
                    borderRadius: BorderRadius.circular(MxRadius.md),
                    border: Border.all(color: Theme.of(context).dividerColor.withOpacity(0.2)),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.description_outlined, size: 20,
                        color: Theme.of(context).colorScheme.onSurfaceVariant),
                      const SizedBox(width: MxSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(it.originalName,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                            Text('Borrado ${_fmtRel(it.deletedAt)}',
                              style: const TextStyle(fontSize: 11, color: Colors.grey)),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.restore_rounded, size: 18),
                        onPressed: () => _restore(it),
                        tooltip: 'Restaurar',
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_forever_rounded, size: 18, color: Colors.red),
                        onPressed: () => _deleteForever(it),
                        tooltip: 'Borrar permanentemente',
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }

  String _fmtRel(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 60) return 'hace ${d.inMinutes} min';
    if (d.inHours < 24) return 'hace ${d.inHours} h';
    if (d.inDays < 7) return 'hace ${d.inDays} d';
    return DateFormat('d MMM').format(t);
  }
}

class _TrashItem {
  final String trashFileName;
  final String originalName;
  final DateTime deletedAt;
  final String path;
  _TrashItem({
    required this.trashFileName,
    required this.originalName,
    required this.deletedAt,
    required this.path,
  });
}
