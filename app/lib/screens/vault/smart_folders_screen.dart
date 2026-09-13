// smart_folders_screen.dart — Smart Folders AFFiNE-style (saved queries).
// v0.62.16: UI completa para crear/editar/borrar smart folders.
// Cada smart folder tiene un nombre + icono + lista de filtros (field, op, value).
// Se evalúan contra las notas del vault.

import 'package:flutter/material.dart';
import '../../core/design_tokens.dart';
import '../../services/smart_folder.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';

class SmartFoldersScreen extends StatefulWidget {
  final String vaultPath;
  const SmartFoldersScreen({super.key, required this.vaultPath});
  @override
  State<SmartFoldersScreen> createState() => _SmartFoldersScreenState();
}

class _SmartFoldersScreenState extends State<SmartFoldersScreen> {
  late SmartFolderService _svc;
  List<SmartFolder> _folders = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _svc = SmartFolderService(widget.vaultPath);
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    _folders = await _svc.listAll();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _newFolder() async {
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _SmartFolderEditor(initial: null, vaultPath: widget.vaultPath),
    );
    if (result != null) {
      await _svc.create(
        name: result['name'] as String,
        icon: result['icon'] as String?,
        filters: result['filters'] as List<SmartFilter>,
      );
      _load();
    }
  }

  Future<void> _editFolder(SmartFolder folder) async {
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _SmartFolderEditor(initial: folder, vaultPath: widget.vaultPath),
    );
    if (result != null) {
      await _svc.delete(folder.id);
      await _svc.create(
        name: result['name'] as String,
        icon: result['icon'] as String?,
        filters: result['filters'] as List<SmartFilter>,
      );
      _load();
    }
  }

  Future<void> _deleteFolder(SmartFolder folder) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Borrar smart folder?'),
        content: Text('"${folder.name}" se eliminará permanentemente.'),
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
      await _svc.delete(folder.id);
      _load();
    }
  }

  /// Ejecuta la smart folder y muestra los resultados.
  Future<void> _runFolder(SmartFolder folder) async {
    final vault = VaultService(widget.vaultPath);
    final all = await vault.listAll();
    final matches = all.where((note) {
      for (final f in folder.filters) {
        if (!f.matches(
          name: note.name,
          content: note.content,
          path: note.path,
          tags: const [],
        )) return false;
      }
      return true;
    }).toList();

    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Container(
          padding: const EdgeInsets.all(MxSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${folder.name} — ${matches.length} resultados',
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                )),
              const SizedBox(height: MxSpacing.md),
              if (matches.isEmpty)
                const Text('Sin coincidencias.')
              else
                ...matches.take(50).map((n) => ListTile(
                  leading: const Icon(Icons.description_outlined, size: 18),
                  title: Text(n.title?.isNotEmpty == true ? n.title! : n.name,
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(n.path, style: const TextStyle(fontSize: 11)),
                  onTap: () => Navigator.pop(ctx),
                )),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando smart folders…');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Folders', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            onPressed: _newFolder,
            tooltip: 'Nuevo smart folder',
          ),
        ],
      ),
      body: _folders.isEmpty
          ? const EmptyState(
              icon: Icons.filter_alt_outlined,
              title: 'Sin smart folders',
              subtitle: 'Crea consultas guardadas para filtrar tu vault automáticamente.',
            )
          : ListView.separated(
              padding: const EdgeInsets.all(MxSpacing.lg),
              itemCount: _folders.length,
              separatorBuilder: (_, __) => const SizedBox(height: MxSpacing.sm),
              itemBuilder: (ctx, i) {
                final f = _folders[i];
                return _SmartFolderRow(
                  folder: f,
                  onRun: () => _runFolder(f),
                  onEdit: () => _editFolder(f),
                  onDelete: () => _deleteFolder(f),
                );
              },
            ),
    );
  }
}

class _SmartFolderRow extends StatelessWidget {
  final SmartFolder folder;
  final VoidCallback onRun;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _SmartFolderRow({
    required this.folder,
    required this.onRun,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onRun,
      borderRadius: BorderRadius.circular(MxRadius.lg),
      child: Container(
        padding: const EdgeInsets.all(MxSpacing.md),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerLow.withOpacity(0.4),
          borderRadius: BorderRadius.circular(MxRadius.lg),
          border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.3)),
        ),
        child: Row(
          children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: MxColors.violet.withOpacity(0.15),
                borderRadius: BorderRadius.circular(MxRadius.md),
              ),
              alignment: Alignment.center,
              child: Icon(
                folder.icon != null
                    ? IconData(UnicodeToEmoji.folder.codeUnitAt(0), fontFamily: 'MaterialIcons')
                    : Icons.filter_alt_rounded,
                size: 20, color: MxColors.violet,
              ),
            ),
            const SizedBox(width: MxSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(folder.name,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  Text('${folder.filters.length} regla${folder.filters.length == 1 ? "" : "s"}',
                    style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 18),
              onPressed: onEdit,
              tooltip: 'Editar',
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              onPressed: onDelete,
              tooltip: 'Borrar',
            ),
          ],
        ),
      ),
    );
  }
}

class UnicodeToEmoji {
  static String folder = '📁';
}

/// Editor bottom sheet para crear/editar un SmartFolder.
class _SmartFolderEditor extends StatefulWidget {
  final SmartFolder? initial;
  final String vaultPath;
  const _SmartFolderEditor({required this.initial, required this.vaultPath});
  @override
  State<_SmartFolderEditor> createState() => _SmartFolderEditorState();
}

class _SmartFolderEditorState extends State<_SmartFolderEditor> {
  late TextEditingController _nameCtrl;
  late List<_EditableFilter> _filters;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initial?.name ?? '');
    _filters = widget.initial == null
        ? [_EditableFilter()]
        : widget.initial!.filters.map((f) => _EditableFilter.fromFilter(f)).toList();
  }

  void _save() {
    if (_nameCtrl.text.trim().isEmpty) return;
    Navigator.pop(context, {
      'name': _nameCtrl.text.trim(),
      'icon': '📁',
      'filters': _filters
          .where((f) => f.valueCtrl.text.trim().isNotEmpty)
          .map((f) => f.toFilter())
          .toList(),
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        child: Container(
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(MxRadius.xxl)),
          ),
          padding: const EdgeInsets.all(MxSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(widget.initial == null ? 'Nuevo Smart Folder' : 'Editar Smart Folder',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
                  TextButton(onPressed: _save, child: const Text('Guardar')),
                ],
              ),
              const SizedBox(height: MxSpacing.sm),
              TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Nombre',
                  hintText: 'Mis apuntes de clase',
                ),
                autofocus: true,
              ),
              const SizedBox(height: MxSpacing.md),
              Text('Reglas (AND lógico)', style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: MxSpacing.xs),
              ..._filters.asMap().entries.map((e) => Padding(
                padding: const EdgeInsets.only(bottom: MxSpacing.xs),
                child: e.value.buildRow(
                  onDelete: () => setState(() => _filters.removeAt(e.key)),
                ),
              )),
              TextButton.icon(
                onPressed: () => setState(() => _filters.add(_EditableFilter())),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Añadir regla'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EditableFilter {
  String field; // name | content | path | tag
  SmartFilterOp op;
  late TextEditingController valueCtrl;

  _EditableFilter({this.field = 'name', this.op = SmartFilterOp.contains})
      : valueCtrl = TextEditingController();

  _EditableFilter.fromFilter(SmartFilter f)
      : field = f.field,
        op = f.op,
        valueCtrl = TextEditingController(text: f.value);

  SmartFilter toFilter() => SmartFilter(field: field, op: op, value: valueCtrl.text.trim());

  Widget buildRow({required VoidCallback onDelete}) {
    return Row(
      children: [
        SizedBox(
          width: 80,
          child: DropdownButtonFormField<String>(
            value: field,
            decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8)),
            items: const [
              DropdownMenuItem(value: 'name', child: Text('Nombre')),
              DropdownMenuItem(value: 'content', child: Text('Cuerpo')),
              DropdownMenuItem(value: 'path', child: Text('Path')),
              DropdownMenuItem(value: 'tag', child: Text('Tag')),
            ],
            onChanged: (v) {
              if (v != null) field = v;
            },
          ),
        ),
        const SizedBox(width: 6),
        SizedBox(
          width: 110,
          child: DropdownButtonFormField<SmartFilterOp>(
            value: op,
            decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8)),
            items: SmartFilterOp.values.map((o) => DropdownMenuItem(value: o, child: Text(_opLabel(o)))).toList(),
            onChanged: (v) {
              if (v != null) op = v;
            },
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: TextField(
            controller: valueCtrl,
            decoration: const InputDecoration(
              hintText: 'valor',
              isDense: true,
              contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            ),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.close, size: 16),
          onPressed: onDelete,
        ),
      ],
    );
  }

  String _opLabel(SmartFilterOp o) {
    switch (o) {
      case SmartFilterOp.contains: return 'contiene';
      case SmartFilterOp.equals: return 'igual';
      case SmartFilterOp.startsWith: return 'empieza';
      case SmartFilterOp.regex: return 'regex';
    }
  }
}
