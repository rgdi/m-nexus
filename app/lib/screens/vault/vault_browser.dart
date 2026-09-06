// VaultBrowser: árbol de archivos del vault.
// Sidebar con tree + área principal con notas recientes.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../../core/theme.dart';
import '../../services/vault_detector.dart';
import '../../services/vault_service.dart';
import '../../services/logger.dart';
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
  

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final log = AdvancedLogger.instance;
    try {
      final detector = VaultDetector();
      final vaults = await detector.detectVaults();
      if (!mounted) return;
      if (vaults.isEmpty) {
        setState(() { _loading = false; });
        return;
      }
      _vault = VaultService(vaults.first.path);
      _tree = await _vault!.loadTree();
    } catch (e, s) {
      log.error('vault', 'Load failed', error: e, stack: s);
    }
    if (!mounted) return;
    setState(() { _loading = false; });
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
              decoration: const InputDecoration(
                hintText: 'Buscar en vault…',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _filter = v.toLowerCase()),
            ),
          ),
          const Divider(height: 1),
          Expanded(child: _buildTree(_tree!, initiallyExpanded: true)),
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
                Expanded(child: _buildTree(_tree!, initiallyExpanded: true)),
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
    );
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

  Future<void> _createNote() async {
    if (_vault == null) return;
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
  }
}
