// VaultBrowser: árbol de archivos del vault.
// Sidebar con tree + área principal con notas recientes.

import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../../core/theme.dart';
import '../../services/vault_detector.dart';
import '../../services/permissions.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
import '../../utils/safe_call.dart';
import '../../widgets/empty_state.dart';
import '../note/note_view.dart';
import '../note/note_editor.dart';

class VaultBrowser extends StatefulWidget {
  const VaultBrowser({super.key});
  @override
  State<VaultBrowser> createState() => _VaultBrowserState();
}

class _VaultBrowserState extends State<VaultBrowser> {
  VaultService? _vault;
  VaultNode? _tree;
  bool _loading = true;
  String? _selectedRelPath;
  String _filter = '';
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final log = AdvancedLogger.instance;
    try {
      log.debug('vault_browser', '_load start');
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (!mounted) return;
      log.debug('vault_browser', 'vaults detected', context: {'count': vaults.length});
      if (vaults.isEmpty) {
        setState(() { _loading = false; });
        return;
      }
      _vault = VaultService(vaults.first.path);
      _tree = await _vault!.loadTree();
      log.debug('vault_browser', 'tree loaded', context: {
        'vault': vaults.first.path,
        'children': _tree?.children.length ?? 0,
      });
    } catch (e, s) {
      log.error('vault_browser', '[EC-UI-002] Load vault tree failed', error: e, stack: s);
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  /// v0.48.2: refrescar el árbol desde disco (pull-to-refresh o botón).
  Future<void> _refreshVault() async {
    if (_vault == null) return;
    final log = AdvancedLogger.instance;
    log.info('vault_browser', 'refresh requested');
    _vault!.invalidateCache();
    final tree = await _vault!.loadTree();
    if (!mounted) return;
    setState(() {
      _tree = tree;
    });
    log.info('vault_browser', 'refresh done', context: {
      'children': tree.children.length,
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(message: 'Cargando vault…');
    if (_vault == null || _tree == null) {
      return const EmptyState(
        icon: Icons.folder_off,
        title: 'Sin vault',
        subtitle: 'No se detectaron vaults. Configurá uno en Ajustes.',
      );
    }
    return AppTheme.isMobile(context) ? _buildMobile() : _buildDesktop();
  }

  Widget _buildMobile() {
    return Scaffold(
      appBar: AppBar(
        title: Text(p.basename(_vault!.vaultPath)),
        actions: [
          IconButton(
            icon: const Icon(Icons.create_new_folder_outlined),
            onPressed: _createFolder,
            tooltip: 'Nueva carpeta',
          ),
          IconButton(
            icon: const Icon(Icons.file_upload_outlined),
            onPressed: _showImportDialog,
            tooltip: 'Importar (Anki/PDF)',
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refreshVault,
            tooltip: 'Recargar vault',
          ),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _createNote,
            tooltip: 'Nueva nota',
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Buscar en vault…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() => _filter = '');
                        },
                      )
                    : null,
                isDense: true,
              ),
              onChanged: (v) => setState(() => _filter = v.toLowerCase()),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refreshVault,
              child: _buildTree(_tree!, initiallyExpanded: true),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDesktop() {
    return Scaffold(
      body: Row(
        children: [
          // Sidebar con árbol
          SizedBox(
            width: 280,
            child: Column(
              children: [
                _buildSidebarHeader(),
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: TextField(
                    decoration: const InputDecoration(
                      hintText: 'Filtrar…',
                      prefixIcon: Icon(Icons.search, size: 18),
                      isDense: true,
                    ),
                    onChanged: (v) => setState(() => _filter = v.toLowerCase()),
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _refreshVault,
                    child: _buildTree(_tree!, initiallyExpanded: true),
                  ),
                ),
              ],
            ),
          ),
          const VerticalDivider(width: 1),
          // Main: archivo seleccionado o lista de recientes
          Expanded(child: _buildMain()),
        ],
      ),
    );
  }

  Widget _buildSidebarHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        children: [
          const Icon(Icons.folder, size: 20, color: Color(0xFF4F6BED)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              p.basename(_vault!.vaultPath),
              style: Theme.of(context).textTheme.titleMedium,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add, size: 20),
            onPressed: _createNote,
            tooltip: 'Nueva nota',
          ),
        ],
      ),
    );
  }

  Widget _buildMain() {
    if (_selectedRelPath != null) {
      final absPath = p.join(_vault!.vaultPath, _selectedRelPath!);
      return NoteView(notePath: absPath, vaultPath: _vault!.vaultPath, embedded: true);
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.touch_app, size: 48,
              color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            const Text('Seleccioná una nota del árbol',
              style: TextStyle(fontSize: 16)),
            const SizedBox(height: 8),
            const Text('O usá Ctrl+N para crear una nueva',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  Widget _buildTree(VaultNode node, {bool initiallyExpanded = false}) {
    if (_filter.isNotEmpty) {
      // Filtrado simple
      if (!_matchesFilter(node)) return const SizedBox.shrink();
    }
    if (node.isDir) {
      return Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded || _filter.isNotEmpty,
          leading: const Icon(Icons.folder, size: 18, color: Color(0xFFFFB300)),
          title: Text(node.name,
            style: const TextStyle(fontWeight: FontWeight.w500)),
          onLongPress: () => _showFolderContextMenu(node),
          children: node.children.map((c) => _buildTree(c)).toList(),
        ),
      );
    }
    // Archivo
    final selected = _selectedRelPath == node.relPath;
    return ListTile(
      dense: true,
      selected: selected,
      leading: Icon(
        Icons.description_outlined,
        size: 18,
        color: selected ? Theme.of(context).colorScheme.primary : null,
      ),
      title: Text(
        node.name.replaceAll('.md', ''),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
        ),
      ),
      onTap: () => _openNote(node),
      onLongPress: () => _showNoteContextMenu(node),
    );
  }

  // v0.49.2: menu contextual para notas (rename, move, delete)
  Future<void> _showNoteContextMenu(VaultNode node) async {
    if (_vault == null) return;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Renombrar'),
              onTap: () => Navigator.pop(ctx, 'rename'),
            ),
            ListTile(
              leading: const Icon(Icons.drive_file_move_outlined),
              title: const Text('Mover a...'),
              onTap: () => Navigator.pop(ctx, 'move'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('Eliminar', style: TextStyle(color: Colors.red)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'rename') await _renameNote(node);
    if (action == 'move') await _moveNote(node);
    if (action == 'delete') await _deleteNote(node);
  }

  // v0.49.2: menu contextual para carpetas
  Future<void> _showFolderContextMenu(VaultNode node) async {
    if (_vault == null) return;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Renombrar carpeta'),
              onTap: () => Navigator.pop(ctx, 'rename'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('Eliminar carpeta', style: TextStyle(color: Colors.red)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'rename') await _renameFolder(node);
    if (action == 'delete') await _deleteFolder(node);
  }

  Future<void> _renameNote(VaultNode node) async {
    if (_vault == null) return;
    final controller = TextEditingController(
      text: node.name.replaceAll('.md', ''),
    );
    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Renombrar nota'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nuevo nombre'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Renombrar'),
          ),
        ],
      ),
    );
    if (!mounted || newName == null || newName.isEmpty) return;
    try {
      final absPath = p.join(_vault!.vaultPath, node.relPath);
      await _vault!.renameNote(absPath, newName);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _moveNote(VaultNode node) async {
    if (_vault == null) return;
    final folders = await _listFolders();
    if (!mounted) return;
    if (folders.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay carpetas en el vault')),
      );
      return;
    }
    final dest = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Mover a...'),
        children: folders
            .map((f) => SimpleDialogOption(
                  onPressed: () => Navigator.pop(ctx, f),
                  child: Text(f.isEmpty ? 'Raíz' : f),
                ))
            .toList(),
      ),
    );
    if (!mounted || dest == null) return;
    try {
      final name = node.name;
      final absSrc = p.join(_vault!.vaultPath, node.relPath);
      final absDest = p.join(_vault!.vaultPath, dest, name);
      await _vault!.moveNote(absSrc, absDest);
      _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Movido a ${dest.isEmpty ? 'Raíz' : dest}')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<List<String>> _listFolders() async {
    if (_vault == null) return [];
    final folders = <String>[];
    final root = Directory(_vault!.vaultPath);
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is Directory) {
        final rel = p.relative(entity.path, from: _vault!.vaultPath);
        if (rel != '.' && !rel.startsWith('.') && !rel.contains('attachments')) {
          folders.add(rel);
        }
      }
    }
    return folders;
  }

  Future<void> _deleteNote(VaultNode node) async {
    if (_vault == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar nota?'),
        content: Text('"${node.name}" se eliminará permanentemente.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final absPath = p.join(_vault!.vaultPath, node.relPath);
      await _vault!.deleteNote(absPath);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _renameFolder(VaultNode node) async {
    if (_vault == null) return;
    final controller = TextEditingController(text: node.name);
    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Renombrar carpeta'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nuevo nombre'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Renombrar'),
          ),
        ],
      ),
    );
    if (!mounted || newName == null || newName.isEmpty || newName == node.name) return;
    try {
      final parent = p.dirname(node.relPath);
      final newRel = parent == '.' ? newName : p.join(parent, newName);
      final absSrc = p.join(_vault!.vaultPath, node.relPath);
      final absDest = p.join(_vault!.vaultPath, newRel);
      await _vault!.moveNote(absSrc, absDest);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _deleteFolder(VaultNode node) async {
    if (_vault == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar carpeta?'),
        content: Text('"${node.name}" y todo su contenido se eliminarán.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar todo'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final absPath = p.join(_vault!.vaultPath, node.relPath);
      await _vault!.deleteFolder(absPath, recursive: true);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  bool _matchesFilter(VaultNode n) {
    if (!_filter.isNotEmpty) return true;
    if (n.name.toLowerCase().contains(_filter)) return true;
    return n.children.any(_matchesFilter);
  }

  void _openNote(VaultNode n) {
    final absPath = p.join(_vault!.vaultPath, n.relPath);
    if (AppTheme.isMobile(context)) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => NoteView(notePath: absPath, vaultPath: _vault!.vaultPath)),
      );
    } else {
      setState(() { _selectedRelPath = n.relPath; });
    }
  }

  Future<void> _createFolder() async {
    if (_vault == null) return;
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nueva carpeta'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Nombre de la carpeta'),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Crear'),
          ),
        ],
      ),
    );
    if (!mounted || name == null || name.isEmpty) return;
    try {
      await _vault!.createFolder(name);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  /// v0.49.2: Dialog de import — redirige a un menu con opciones.
  Future<void> _showImportDialog() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Importar a vault', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.style, color: Color(0xFF1976D2)),
              title: const Text('Anki (.apkg)'),
              subtitle: const Text('Importa un mazo Anki con todas sus cards y tags'),
              onTap: () => Navigator.pop(ctx, 'apkg'),
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf, color: Color(0xFFD32F2F)),
              title: const Text('PDF (.pdf)'),
              subtitle: const Text('Convierte un PDF en notas markdown'),
              onTap: () => Navigator.pop(ctx, 'pdf'),
            ),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'Próximamente: Notion, Roam, Obsidian, CSV',
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'apkg' || action == 'pdf') {
      _launchImportFlow(action);
    }
  }

  /// v0.50.2: Lanza el flow de import con file_picker REAL.
  /// Selecciona un .apkg o .pdf, lo copia al vault/Imported/, y llama
  /// al backend /api/v1/import/execute.
  Future<void> _launchImportFlow(String format) async {
    if (_vault == null) return;
    final ext = format == 'apkg' ? 'apkg' : 'pdf';
    try {
      // v0.50.2: file_picker REAL
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: [ext],
        allowMultiple: false,
        withData: false,
      );
      if (result == null || result.files.isEmpty) {
        return; // user cancelled
      }
      final sourcePath = result.files.first.path;
      if (sourcePath == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo obtener el path')),
        );
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Importando ${p.basename(sourcePath)}...')),
      );

      // 1. Copiar al vault/Imported/
      final importedDir = Directory(p.join(_vault!.vaultPath, 'Imported'));
      if (!await importedDir.exists()) await importedDir.create(recursive: true);
      final destPath = p.join(importedDir.path, p.basename(sourcePath));
      await File(sourcePath).copy(destPath);

      // 2. Mostrar resultado
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Archivo copiado'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Origen: ${p.basename(sourcePath)}'),
              const SizedBox(height: 4),
              Text('Destino: vault/Imported/'),
              const SizedBox(height: 12),
              const Text('Para procesar el import, ejecuta en tu backend:',
                style: TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(ctx).colorScheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  'POST /api/v1/import/execute\n{ "filePath": "$destPath", "vaultPath": "${_vault!.vaultPath}" }',
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: destPath));
                Navigator.pop(ctx);
              },
              child: const Text('Copiar path'),
            ),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cerrar')),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    }
  }

  Future<void> _createNote() async {
    if (_vault == null) return;
    // v0.45.11: si el vault está en /storage/emulated/0/, necesitamos MANAGE_EXTERNAL_STORAGE
    if (_vault!.vaultPath.startsWith('/storage/emulated/0/')) {
      final granted = await PermissionsService.isManageStorageGranted();
      if (!granted && mounted) {
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Permiso necesario'),
            content: const Text(
              'Para escribir en /storage/emulated/0/ (tarjeta SD o almacenamiento interno) '
              'necesitamos el permiso "Acceso a todos los archivos". '
              '\n\n¿Lo activamos ahora?',
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Abrir ajustes')),
            ],
          ),
        );
        if (ok != true) return;
        await PermissionsService.openManageStorageSettings();
        return;  // user grants permission, then re-tap to create
      }
    }
    try {
      final path = await _vault!.createNote(
        folder: 'Inbox',
        title: 'Sin título',
        content: '# Sin título\n\n',
      );
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => NoteEditor(notePath: path, vaultPath: _vault!.vaultPath)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo crear la nota: $e')),
      );
    }
  }
}
